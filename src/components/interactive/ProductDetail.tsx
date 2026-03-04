import { useStore } from '@nanostores/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { $selectedProduct } from '@/stores/ui';
import {
  $cart,
  $cartLoading,
  ensureCart,
  setStoredCartId,
  addSuggestionToCart,
  type Cart,
  type Suggestion,
} from '@/stores/cart';
import { $isCartOpen } from '@/stores/ui';
import { $merchant } from '@/stores/merchant';
import { formatPrice, langToLocale } from '@/lib/currency';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { t } from '@/i18n';
import { getClient } from '@/lib/api';
import type { ModifierGroup as RawModifierGroup } from '@/lib/normalize';
import { optimizedImageUrl } from '@/lib/image';
import { showToast } from '@/stores/toast';
import QuantitySelector from './QuantitySelector';

/** Mapped modifier option ready for UI rendering. */
interface MappedModifierOption {
  id: string;
  name: string;
  price: string;
}

/** Mapped modifier group ready for UI rendering. */
interface MappedModifierGroup {
  id: string;
  name: string;
  type: 'radio' | 'checkbox' | 'quantity';
  required: boolean;
  max_selections?: number;
  options: MappedModifierOption[];
}

interface AttributeValue {
  attribute_name: string;
  attribute_slug: string;
  input_type: string;
  value_text: string;
  value_numeric: string | null;
  value_boolean: boolean | null;
  selected_choices: Array<{ value: string }>;
}

interface ProductData {
  id: string | number;
  name: string;
  description?: string;
  price: string;
  image?: string | null;
  modifier_groups?: MappedModifierGroup[];
  attribute_values?: AttributeValue[];
}

/** Map an API modifier group to the shape this component expects for rendering. */
function mapModifierGroup(raw: RawModifierGroup): MappedModifierGroup {
  const selectionType = raw.selection_type;
  const modifiers = raw.modifiers ?? raw.options ?? [];

  return {
    id: String(raw.id),
    name: raw.title ?? raw.name ?? '',
    type: selectionType === 'multiple' ? 'checkbox' : 'radio',
    required: raw.required ?? (raw.min_selections ?? 0) > 0,
    max_selections: raw.max_selections,
    options: modifiers
      .filter((m) => m.is_available !== false)
      .map((m) => ({
        id: String(m.id),
        name: m.title ?? m.name ?? '',
        price: m.price_modifier ?? m.price ?? '0',
      })),
  };
}

/** Normalize raw API product detail to ProductData shape. */
function toProductData(raw: Record<string, unknown>): ProductData {
  const images = raw.images as Array<{ image_url: string }> | undefined;
  const rawGroups = (raw.modifier_groups ?? []) as RawModifierGroup[];

  return {
    id: raw.id as string | number,
    name: ((raw.title ?? raw.name) as string | undefined) ?? '',
    description: raw.description as string | undefined,
    price: (raw.price as string | undefined) ?? '0',
    image: images?.[0]?.image_url ?? (raw.image as string | null) ?? null,
    modifier_groups: rawGroups.map(mapModifierGroup),
    attribute_values: raw.attribute_values as ProductData['attribute_values'],
  };
}

interface Props {
  lang: string;
}

export default function ProductDetail({ lang }: Props) {
  const selectedProduct = useStore($selectedProduct);
  const merchant = useStore($merchant);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [product, setProduct] = useState<ProductData | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [quantities, setQuantities] = useState<Record<string, Record<string, number>>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [shakeGroup, setShakeGroup] = useState<string | null>(null);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [step, setStep] = useState<'detail' | 'upsell'>('detail');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [addedSuggestions, setAddedSuggestions] = useState<Set<number>>(new Set());

  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  const close = () => $selectedProduct.set(null);

  useFocusTrap(dialogRef, !!selectedProduct, close);

  const fetchProductById = async (productId: string) => {
    setLoadingProduct(true);
    setFetchError(false);
    try {
      const client = getClient();
      const [productRes, suggestionsRes] = await Promise.all([
        client.GET(`/api/v1/products/{id}/`, {
          params: { path: { id: productId } },
        }),
        client.GET(`/api/v1/products/{id}/suggestions/`, {
          params: { path: { id: productId } },
        }),
      ]);
      if (!productRes.data) {
        if (productRes.error)
          console.error('[ProductDetail] SDK error loading product:', productRes.error);
        setFetchError(true);
        return;
      }
      setProduct(toProductData(productRes.data as Record<string, unknown>));
      if (suggestionsRes.data) setSuggestions(suggestionsRes.data as Suggestion[]);
    } catch (err) {
      console.error('[ProductDetail] failed to load product:', err);
      setFetchError(true);
    } finally {
      setLoadingProduct(false);
    }
  };

  // Fetch product detail + suggestions when selected
  useEffect(() => {
    // Always reset state (handles both null and product-to-product transitions)
    setProduct(null);
    setSelections({});
    setQuantities({});
    setQuantity(1);
    setNotes('');
    setShowNotes(false);
    setFetchError(false);
    setStep('detail');
    setSuggestions([]);
    setAddedSuggestions(new Set());

    if (!selectedProduct) return;

    if (selectedProduct.skipToUpsell) {
      // Product already added — only fetch suggestions for the upsell step
      const fetchSuggestionsOnly = async () => {
        setLoadingProduct(true);
        try {
          const client = getClient();
          const { data } = await client.GET(`/api/v1/products/{id}/suggestions/`, {
            params: { path: { id: String(selectedProduct.id) } },
          });
          const items = (data as Suggestion[] | null) ?? [];
          if (items.length > 0) {
            setProduct({
              id: selectedProduct.id,
              name: selectedProduct.name,
              price: '0',
            });
            setSuggestions(items);
            setStep('upsell');
          } else {
            showToast(t('toastAddedToCart', lang), 'success');
            close();
          }
        } catch {
          showToast(t('toastAddedToCart', lang), 'success');
          close();
        } finally {
          setLoadingProduct(false);
        }
      };
      fetchSuggestionsOnly();
      return;
    }

    fetchProductById(String(selectedProduct.id));
  }, [selectedProduct]);

  const handleRadioSelect = (groupId: string, optionId: string) => {
    setSelections((prev) => ({ ...prev, [groupId]: [optionId] }));
  };

  const handleCheckboxToggle = (groupId: string, optionId: string, maxSelections?: number) => {
    setSelections((prev) => {
      const current = prev[groupId] ?? [];
      if (current.includes(optionId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== optionId) };
      }
      if (maxSelections && current.length >= maxSelections) return prev;
      return { ...prev, [groupId]: [...current, optionId] };
    });
  };

  const handleQuantityChange = (groupId: string, optionId: string, delta: number) => {
    setQuantities((prev) => {
      const groupQtys = { ...prev[groupId] };
      const current = groupQtys[optionId] ?? 0;
      const next = Math.max(0, current + delta);
      groupQtys[optionId] = next;
      return { ...prev, [groupId]: groupQtys };
    });
  };

  // Calculate total price
  const calculateTotal = (): number => {
    if (!product) return 0;
    let total = Number(product.price);

    for (const group of product.modifier_groups ?? []) {
      const selected = selections[group.id] ?? [];
      const groupQuantities = quantities[group.id] ?? {};

      for (const opt of group.options) {
        if (group.type === 'quantity') {
          total += Number(opt.price) * (groupQuantities[opt.id] ?? 0);
        } else if (selected.includes(opt.id)) {
          total += Number(opt.price);
        }
      }
    }

    return Math.round(total * quantity * 100) / 100;
  };

  /** Check whether a modifier group has at least one selection/quantity chosen. */
  const isGroupFilled = (groupId: string): boolean => {
    const group = (product?.modifier_groups ?? []).find((g) => g.id === groupId);
    if (!group) return false;
    if (group.type === 'quantity') {
      const groupQtys = quantities[groupId] ?? {};
      return Object.values(groupQtys).some((q) => (q as number) > 0);
    }
    return (selections[groupId]?.length ?? 0) > 0;
  };

  // Validate required groups
  const getUnfilledGroups = (): string[] => {
    if (!product) return [];
    return (product.modifier_groups ?? [])
      .filter((g) => g.required && !isGroupFilled(g.id))
      .map((g) => g.id);
  };

  const handleSubmit = async () => {
    const unfilled = getUnfilledGroups();
    if (unfilled.length > 0) {
      // Shake first unfilled group and scroll to it
      setShakeGroup(unfilled[0]);
      const el = document.getElementById(`modifier-group-${unfilled[0]}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => setShakeGroup(null), 600);
      return;
    }

    if (!product) return;

    $cartLoading.set(true);
    try {
      const options: Array<{ option_id: number; option_group_id: number; quantity: number }> = [];

      for (const group of product.modifier_groups ?? []) {
        const selected = selections[group.id] ?? [];
        const groupQtys = quantities[group.id] ?? {};

        for (const opt of group.options) {
          if (group.type === 'quantity' && (groupQtys[opt.id] ?? 0) > 0) {
            options.push({
              option_id: Number(opt.id),
              option_group_id: Number(group.id),
              quantity: groupQtys[opt.id],
            });
          } else if (selected.includes(opt.id)) {
            options.push({
              option_id: Number(opt.id),
              option_group_id: Number(group.id),
              quantity: 1,
            });
          }
        }
      }

      const client = getClient();
      const cartId = await ensureCart(client);
      const { data, error } = await client.POST(`/api/v1/cart/{cart_id}/items/`, {
        params: { path: { cart_id: cartId } },
        body: {
          product_id: product.id,
          quantity,
          options: options.length > 0 ? options : undefined,
          notes: notes || undefined,
        },
      });

      if (error) {
        // Handle structured API errors (e.g. REQUIRED_OPTIONS_MISSING)
        const apiBody = 'body' in error ? (error.body as Record<string, unknown>) : null;
        const apiError = apiBody?.error as
          | {
              code?: string;
              message?: string;
              details?: { missing_groups?: Array<{ group_id: number }> };
            }
          | undefined;

        if (apiError?.code === 'REQUIRED_OPTIONS_MISSING' && apiError.details?.missing_groups) {
          const missingIds = apiError.details.missing_groups.map((g) => String(g.group_id));
          if (missingIds.length > 0) {
            setShakeGroup(missingIds[0]);
            const el = document.getElementById(`modifier-group-${missingIds[0]}`);
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => setShakeGroup(null), 600);
          }
          showToast(apiError.message ?? t('toastAddToCartFailed', lang));
          return;
        }

        console.error('[ProductDetail] SDK error adding to cart:', error);
        showToast(apiError?.message ?? t('toastAddToCartFailed', lang));
        return;
      }

      if (data) {
        const cartData = data as Cart;
        $cart.set(cartData);
        if (cartData.id) setStoredCartId(cartData.id);
        if (suggestions.length > 0) {
          setStep('upsell');
        } else {
          showToast(t('toastAddedToCart', lang), 'success');
          close();
        }
      }
    } catch (err) {
      console.error('[ProductDetail] add to cart error:', err);
      showToast(t('toastAddToCartFailed', lang));
    } finally {
      $cartLoading.set(false);
    }
  };

  if (!selectedProduct) return null;

  const total = calculateTotal();

  return (
    <div class="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        class="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      {/* Dialog — bottom sheet on mobile, centered on desktop */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={product?.name ?? ''}
        class="absolute bottom-0 left-0 right-0 max-h-[90vh] overflow-hidden rounded-t-xl bg-card shadow-xl md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg"
      >
        {loadingProduct ? (
          <div
            class="flex h-64 items-center justify-center"
            role="status"
            aria-label={t('loading', lang)}
          >
            <div class="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : !product && fetchError ? (
          <div class="relative flex h-64 flex-col items-center justify-center gap-3 px-4">
            <button
              type="button"
              onClick={close}
              class="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-card/80 text-muted-foreground backdrop-blur-sm hover:bg-accent before:absolute before:inset-[-6px]"
              aria-label={t('close', lang)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
            <p class="text-sm text-destructive">{t('productLoadFailed', lang)}</p>
            <button
              type="button"
              onClick={() => {
                if (!selectedProduct) return;
                fetchProductById(String(selectedProduct.id));
              }}
              class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t('tryAgain', lang)}
            </button>
          </div>
        ) : !product ? (
          <div
            class="flex h-64 items-center justify-center"
            role="status"
            aria-label={t('loading', lang)}
          >
            <div class="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : (
          <>
            {/* Close button */}
            <button
              type="button"
              onClick={close}
              class="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full bg-card/80 text-muted-foreground backdrop-blur-sm hover:bg-accent before:absolute before:inset-[-6px]"
              aria-label={t('close', lang)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>

            {/* Product image (hidden during upsell step) */}
            {step === 'detail' && product.image && (
              <div class="aspect-video w-full overflow-hidden bg-card-image">
                <img
                  src={optimizedImageUrl(product.image, { width: 900 })}
                  alt={product.name}
                  class="h-full w-full object-cover"
                  width="512"
                  height="288"
                />
              </div>
            )}

            {/* Scrollable content */}
            <div
              class="overflow-y-auto px-4 py-4"
              style={{ maxHeight: product.image ? 'calc(90vh - 340px)' : 'calc(90vh - 160px)' }}
            >
              {step === 'upsell' ? (
                /* ── Upsell step: shown after successful add ── */
                <div>
                  <div class="flex items-center gap-2 text-card-foreground">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="text-green-600"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    <h2 class="font-heading text-lg font-bold">{t('addedToCart', lang)}</h2>
                  </div>
                  <p class="mt-1 text-sm text-muted-foreground">{product.name}</p>

                  {suggestions.length > 0 && (
                    <div class="mt-4">
                      <h3 class="text-sm font-semibold text-card-foreground">
                        {t('frequentlyCombined', lang)}
                      </h3>
                      <div class="mt-2 space-y-2">
                        {suggestions
                          .filter((s) => !addedSuggestions.has(s.id))
                          .map((s) => (
                            <div
                              key={s.id}
                              class="flex items-center gap-3 rounded-lg border border-border p-2"
                            >
                              {s.image_url && (
                                <div class="h-10 w-10 shrink-0 overflow-hidden rounded bg-card-image">
                                  <img
                                    src={s.image_url}
                                    alt=""
                                    class="h-full w-full object-cover"
                                    width="40"
                                    height="40"
                                    loading="lazy"
                                  />
                                </div>
                              )}
                              <div class="min-w-0 flex-1">
                                <span class="text-sm text-card-foreground">{s.title}</span>
                                <span class="ml-1 text-xs text-muted-foreground">
                                  {formatPrice(s.price, currency, locale)}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={async () => {
                                  const result = await addSuggestionToCart(s.id);
                                  if (result === 'added') {
                                    setAddedSuggestions((prev) => new Set([...prev, s.id]));
                                  } else if (result === 'requires_options') {
                                    $selectedProduct.set({ id: String(s.id), name: s.title });
                                  }
                                }}
                                class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 before:absolute before:inset-[-4px]"
                                aria-label={`${t('addToCart', lang)} ${s.title}`}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2.5"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                >
                                  <path d="M12 5v14" />
                                  <path d="M5 12h14" />
                                </svg>
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Detail step: normal product view ── */
                <div>
                  <h2 class="font-heading text-xl font-bold text-card-foreground">
                    {product.name}
                  </h2>
                  {product.description && (
                    <p class="mt-1 text-sm text-muted-foreground">{product.description}</p>
                  )}
                  <p class="mt-2 text-lg font-semibold text-card-foreground">
                    {formatPrice(product.price, currency, locale)}
                  </p>

                  {/* Attributes */}
                  {product.attribute_values && product.attribute_values.length > 0 && (
                    <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                      {product.attribute_values.map((attr) => {
                        let display: string | null = null;
                        if (attr.input_type === 'multiselect' && attr.selected_choices.length > 0) {
                          display = attr.selected_choices.map((c) => c.value).join(', ');
                        } else if (attr.input_type === 'boolean' && attr.value_boolean != null) {
                          display = attr.value_boolean ? t('yes', lang) : t('no', lang);
                        } else if (attr.input_type === 'numeric' && attr.value_numeric != null) {
                          display = String(Math.round(Number(attr.value_numeric)));
                        } else if (attr.value_text) {
                          display = attr.value_text;
                        }
                        if (!display) return null;
                        return (
                          <span key={attr.attribute_slug} class="text-xs text-muted-foreground">
                            <span class="font-medium">{attr.attribute_name}:</span> {display}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Modifier groups */}
                  {(product.modifier_groups ?? []).map((group) => (
                    <div
                      key={group.id}
                      id={`modifier-group-${group.id}`}
                      class={`mt-4 rounded-lg border border-border p-3 ${shakeGroup === group.id ? 'animate-shake' : ''}`}
                    >
                      <div class="flex items-center justify-between">
                        <h3 class="text-sm font-semibold text-card-foreground">{group.name}</h3>
                        {group.required && (
                          <span
                            class={`text-xs font-medium ${
                              isGroupFilled(group.id) ? 'text-green-600' : 'text-destructive'
                            }`}
                          >
                            {isGroupFilled(group.id) ? '✓' : t('required', lang)}
                          </span>
                        )}
                      </div>

                      <div class="mt-2 space-y-2">
                        {group.options.map((opt) => {
                          const isSelected = (selections[group.id] ?? []).includes(opt.id);
                          const optQty = quantities[group.id]?.[opt.id] ?? 0;
                          const optPrice = Number(opt.price);

                          return (
                            <div key={opt.id} class="flex items-center justify-between">
                              {group.type === 'radio' || group.type === 'checkbox' ? (
                                <label class="flex flex-1 cursor-pointer items-center gap-2">
                                  {group.type === 'radio' ? (
                                    <input
                                      type="radio"
                                      name={group.id}
                                      checked={isSelected}
                                      onChange={() => handleRadioSelect(group.id, opt.id)}
                                      class="h-4 w-4 accent-primary"
                                    />
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() =>
                                        handleCheckboxToggle(group.id, opt.id, group.max_selections)
                                      }
                                      class="h-4 w-4 accent-primary"
                                    />
                                  )}
                                  <span class="text-sm text-card-foreground">{opt.name}</span>
                                  {optPrice > 0 && (
                                    <span class="ml-auto text-xs text-muted-foreground">
                                      +{formatPrice(opt.price, currency, locale)}
                                    </span>
                                  )}
                                </label>
                              ) : (
                                <>
                                  <span class="text-sm text-card-foreground">{opt.name}</span>
                                  <div class="flex items-center gap-2">
                                    {optPrice > 0 && (
                                      <span class="text-xs text-muted-foreground">
                                        +{formatPrice(opt.price, currency, locale)}
                                      </span>
                                    )}
                                    <div
                                      class="inline-flex items-center gap-1"
                                      role="group"
                                      aria-label={opt.name}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => handleQuantityChange(group.id, opt.id, -1)}
                                        disabled={optQty === 0}
                                        aria-label={`${t('remove', lang)} ${opt.name}`}
                                        class="relative inline-flex h-8 w-8 items-center justify-center rounded border border-border text-sm disabled:opacity-30 before:absolute before:inset-[-4px]"
                                      >
                                        −
                                      </button>
                                      <span class="w-6 text-center text-sm" aria-live="polite">
                                        {optQty}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleQuantityChange(group.id, opt.id, 1)}
                                        aria-label={`${t('addToCart', lang)} ${opt.name}`}
                                        class="relative inline-flex h-8 w-8 items-center justify-center rounded border border-border text-sm before:absolute before:inset-[-4px]"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Suggestions (PDP surface) */}
                  {suggestions.length > 0 && (
                    <div class="mt-4">
                      <h3 class="text-sm font-semibold text-card-foreground">
                        {t('frequentlyCombined', lang)}
                      </h3>
                      <div class="mt-2 space-y-2">
                        {suggestions.map((s) => (
                          <div
                            key={s.id}
                            class="flex items-center gap-3 rounded-lg border border-border p-2"
                          >
                            {s.image_url && (
                              <div class="h-10 w-10 shrink-0 overflow-hidden rounded bg-card-image">
                                <img
                                  src={s.image_url}
                                  alt=""
                                  class="h-full w-full object-cover"
                                  width="40"
                                  height="40"
                                  loading="lazy"
                                />
                              </div>
                            )}
                            <div class="min-w-0 flex-1">
                              <span class="text-sm text-card-foreground">{s.title}</span>
                              <span class="ml-1 text-xs text-muted-foreground">
                                {formatPrice(s.price, currency, locale)}
                              </span>
                            </div>
                            <button
                              type="button"
                              disabled={addedSuggestions.has(s.id)}
                              onClick={async () => {
                                const result = await addSuggestionToCart(s.id);
                                if (result === 'added') {
                                  setAddedSuggestions((prev) => new Set([...prev, s.id]));
                                } else if (result === 'requires_options') {
                                  $selectedProduct.set({ id: String(s.id), name: s.title });
                                }
                              }}
                              class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground before:absolute before:inset-[-4px]"
                              aria-label={`${t('addToCart', lang)} ${s.title}`}
                            >
                              {addedSuggestions.has(s.id) ? (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2.5"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                >
                                  <path d="M20 6 9 17l-5-5" />
                                </svg>
                              ) : (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2.5"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                >
                                  <path d="M12 5v14" />
                                  <path d="M5 12h14" />
                                </svg>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Notes */}
                  <div class="mt-4">
                    {!showNotes ? (
                      <button
                        type="button"
                        onClick={() => setShowNotes(true)}
                        class="text-sm text-primary hover:underline"
                      >
                        {t('addNotes', lang)}
                      </button>
                    ) : (
                      <textarea
                        value={notes}
                        onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
                        placeholder={t('addNotes', lang)}
                        class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        rows={2}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sticky bottom CTA */}
            <div
              class="border-t border-border px-4 py-3"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
            >
              {step === 'upsell' ? (
                <div class="space-y-2">
                  <button
                    type="button"
                    onClick={close}
                    class="flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {t('done', lang)}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      $isCartOpen.set(true);
                    }}
                    class="flex h-10 w-full items-center justify-center text-sm font-medium text-primary hover:underline"
                  >
                    {t('viewCart', lang)}
                  </button>
                </div>
              ) : (
                <div class="flex items-center gap-3">
                  <QuantitySelector
                    quantity={quantity}
                    onIncrement={() => setQuantity((q) => q + 1)}
                    onDecrement={() => setQuantity((q) => Math.max(1, q - 1))}
                    onRemove={close}
                    lang={lang}
                    min={1}
                  />
                  <button
                    type="button"
                    onClick={handleSubmit}
                    class="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <span>{t('addToOrder', lang)}</span>
                    <span>&middot;</span>
                    <span>{formatPrice(String(total), currency, locale)}</span>
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
