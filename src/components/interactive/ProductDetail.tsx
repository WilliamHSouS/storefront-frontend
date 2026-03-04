import { useStore } from '@nanostores/preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { $selectedProduct } from '@/stores/ui';
import { $cart, $cartLoading, ensureCart, setStoredCartId } from '@/stores/cart';
import { normalizeCart } from '@/lib/normalize';
import { $merchant } from '@/stores/merchant';
import { formatPrice, langToLocale } from '@/lib/currency';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { t } from '@/i18n';
import { getClient } from '@/lib/api';
import QuantitySelector from './QuantitySelector';

interface ModifierOption {
  id: string;
  name: string;
  price: string;
}

interface ModifierGroup {
  id: string;
  name: string;
  type: 'radio' | 'checkbox' | 'quantity';
  required: boolean;
  max_selections?: number;
  options: ModifierOption[];
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
  modifier_groups?: ModifierGroup[];
  attribute_values?: AttributeValue[];
  cross_sells?: Array<{ id: string; name: string; price: string; image?: string | null }>;
}

/** Map API modifier group to the shape this component expects. */
function mapModifierGroup(raw: Record<string, unknown>): ModifierGroup {
  const selectionType = raw.selection_type as string | undefined;
  const modifiers = (raw.modifiers ?? raw.options ?? []) as Array<Record<string, unknown>>;

  return {
    id: String(raw.id),
    name: (raw.title ?? raw.name ?? '') as string,
    type: selectionType === 'multiple' ? 'checkbox' : 'radio',
    required: (raw.required as boolean) ?? (raw.min_selections as number) > 0,
    max_selections: raw.max_selections as number | undefined,
    options: modifiers
      .filter((m) => m.is_available !== false)
      .map((m) => ({
        id: String(m.id),
        name: (m.title ?? m.name ?? '') as string,
        price: (m.price_modifier ?? m.price ?? '0') as string,
      })),
  };
}

/** Normalize raw API product detail to ProductData shape. */
function toProductData(raw: Record<string, unknown>): ProductData {
  const images = raw.images as Array<{ image_url: string }> | undefined;
  const rawGroups = (raw.modifier_groups ?? []) as Array<Record<string, unknown>>;

  return {
    ...raw,
    id: raw.id as string | number,
    name: (raw.title ?? raw.name ?? '') as string,
    description: raw.description as string | undefined,
    price: (raw.price ?? '0') as string,
    image: images?.[0]?.image_url ?? (raw.image as string | null) ?? null,
    modifier_groups: rawGroups.map(mapModifierGroup),
    attribute_values: raw.attribute_values as ProductData['attribute_values'],
  } as ProductData;
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

  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  const close = () => $selectedProduct.set(null);

  useFocusTrap(dialogRef, !!selectedProduct, close);

  // Fetch product detail when selected
  useEffect(() => {
    if (!selectedProduct) {
      setProduct(null);
      setSelections({});
      setQuantities({});
      setQuantity(1);
      setNotes('');
      setShowNotes(false);
      return;
    }

    const fetchProduct = async () => {
      setLoadingProduct(true);
      try {
        const client = getClient();
        const { data } = await client.GET(`/api/v1/products/{id}/`, {
          params: { path: { id: String(selectedProduct.id) } },
        });
        if (data) setProduct(toProductData(data as Record<string, unknown>));
      } finally {
        setLoadingProduct(false);
      }
    };
    fetchProduct();
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

  // Validate required groups
  const getUnfilledGroups = (): string[] => {
    if (!product) return [];
    return (product.modifier_groups ?? [])
      .filter((g) => g.required)
      .filter((g) => {
        if (g.type === 'quantity') {
          const groupQtys = quantities[g.id] ?? {};
          return Object.values(groupQtys).every((q) => q === 0);
        }
        return !selections[g.id] || selections[g.id].length === 0;
      })
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
      const { data } = await client.POST(`/api/v1/cart/{cart_id}/items/`, {
        params: { path: { cart_id: cartId } },
        body: {
          product_id: product.id,
          quantity,
          options: options.length > 0 ? options : undefined,
          notes: notes || undefined,
        },
      });

      if (data) {
        const cartData = normalizeCart(data as Record<string, unknown>);
        $cart.set(cartData);
        if (cartData.id) setStoredCartId(cartData.id);
        close();
      }
    } catch (err) {
      console.error('[ProductDetail] add to cart error:', err);
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
        {loadingProduct || !product ? (
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

            {/* Product image */}
            {product.image && (
              <div class="aspect-video w-full overflow-hidden bg-card-image">
                <img
                  src={product.image}
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
              <h2 class="font-heading text-xl font-bold text-card-foreground">{product.name}</h2>
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
                          (selections[group.id]?.length ?? 0) > 0 ||
                          Object.values(quantities[group.id] ?? {}).some((q) => q > 0)
                            ? 'text-green-600'
                            : 'text-destructive'
                        }`}
                      >
                        {(selections[group.id]?.length ?? 0) > 0 ||
                        Object.values(quantities[group.id] ?? {}).some((q) => q > 0)
                          ? '✓'
                          : t('required', lang)}
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

              {/* Cross-sells */}
              {product.cross_sells && product.cross_sells.length > 0 && (
                <div class="mt-4">
                  <h3 class="text-sm font-semibold text-card-foreground">
                    {t('frequentlyCombined', lang)}
                  </h3>
                  <div class="mt-2 space-y-2">
                    {product.cross_sells.map((cs) => (
                      <div
                        key={cs.id}
                        class="flex items-center gap-3 rounded-lg border border-border p-2"
                      >
                        {cs.image && (
                          <div class="h-10 w-10 shrink-0 overflow-hidden rounded bg-card-image">
                            <img
                              src={cs.image}
                              alt=""
                              class="h-full w-full object-cover"
                              width="40"
                              height="40"
                              loading="lazy"
                            />
                          </div>
                        )}
                        <div class="flex-1">
                          <span class="text-sm text-card-foreground">{cs.name}</span>
                          <span class="ml-1 text-xs text-muted-foreground">
                            {formatPrice(cs.price, currency, locale)}
                          </span>
                        </div>
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

            {/* Sticky bottom CTA */}
            <div
              class="border-t border-border px-4 py-3"
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
            >
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
