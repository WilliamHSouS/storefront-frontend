import { useStore } from '@nanostores/preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { $selectedProduct } from '@/stores/ui';
import { $cartLoading, ensureCart, cartCoordsQuery, type Suggestion } from '@/stores/cart';
import { commitCartResponse, addSuggestionToCart } from '@/stores/cart-actions';
import { $isCartOpen } from '@/stores/ui';
import { $merchant } from '@/stores/merchant';
import { formatPrice, langToLocale } from '@/lib/currency';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { t } from '@/i18n/client';
import { getClient } from '@/lib/api';
import { fetchProduct as fetchProductCached, getCached } from '@/lib/product-cache';
import { normalizeProduct, type ModifierGroup as RawModifierGroup } from '@/lib/normalize';
import { optimizedImageUrl, responsiveImage } from '@/lib/image';
import { showToast } from '@/stores/toast';
import * as log from '@/lib/logger';
import QuantitySelector from './QuantitySelector';
import { withErrorBoundary } from './ErrorBoundary';

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
  selected_choices: Array<{ value: string; slug?: string }>;
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
  const normalized = normalizeProduct(raw);
  const rawGroups = (raw.modifier_groups ?? []) as RawModifierGroup[];

  return {
    id: normalized.id,
    name: normalized.name,
    description: normalized.description ?? undefined,
    price: normalized.price,
    image: normalized.image,
    modifier_groups: rawGroups.map(mapModifierGroup),
    attribute_values: raw.attribute_values as ProductData['attribute_values'],
  };
}

/** Shared suggestion list item used in both detail and upsell steps. */
function SuggestionItem({
  suggestion: s,
  added,
  currency,
  locale,
  lang,
  onAdd,
}: {
  suggestion: Suggestion;
  added: boolean;
  currency: string;
  locale: string;
  lang: string;
  onAdd: () => void;
}) {
  return (
    <div class="flex items-center gap-3 rounded-lg border border-border p-2">
      {s.image_url && (
        <div class="h-10 w-10 shrink-0 overflow-hidden rounded bg-card-image">
          <img
            src={optimizedImageUrl(s.image_url, { width: 80 })}
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
        disabled={added}
        onClick={onAdd}
        class="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground before:absolute before:inset-[-4px]"
        aria-label={`${t('addToCart', lang)} ${s.title}`}
      >
        {added ? (
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
  );
}

interface Props {
  lang: string;
}

function ProductDetail({ lang }: Props) {
  const selectedProduct = useStore($selectedProduct);
  const merchant = useStore($merchant);
  const dialogRef = useRef<HTMLDivElement>(null);
  const didPushState = useRef(false);
  const [product, setProduct] = useState<ProductData | null>(null);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [quantities, setQuantities] = useState<Record<string, Record<string, number>>>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [shakeGroup, setShakeGroup] = useState<string | null>(null);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [step, setStep] = useState<'detail' | 'upsell'>('detail');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [addedSuggestions, setAddedSuggestions] = useState<Set<number>>(new Set());

  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  const close = () => {
    if (didPushState.current) {
      history.back();
      // popstate handler will clear didPushState and set $selectedProduct to null
    } else {
      $selectedProduct.set(null);
    }
  };

  useFocusTrap(dialogRef, !!selectedProduct, close);

  const fetchProductById = async (productId: string, signal?: AbortSignal) => {
    // Check cache first — if hit, skip loading state entirely (instant open)
    const cached = getCached(productId);
    if (cached) {
      setProduct(toProductData(cached.product));
      setSuggestions(cached.suggestions as Suggestion[]);
      setLoadingProduct(false);
      return;
    }

    setLoadingProduct(true);
    setFetchError(false);
    try {
      const result = await fetchProductCached(productId, signal);
      if (signal?.aborted) return;
      if (!result) {
        setFetchError(true);
        return;
      }
      setProduct(toProductData(result.product));
      setSuggestions(result.suggestions as Suggestion[]);
    } catch (err) {
      if (signal?.aborted) return;
      log.error('ProductDetail', 'Failed to load product:', err);
      setFetchError(true);
    } finally {
      if (!signal?.aborted) setLoadingProduct(false);
    }
  };

  // Fetch product detail + suggestions when selected
  const selectedProductId = selectedProduct?.id;
  useEffect(() => {
    // Always reset state (handles both null and product-to-product transitions)
    setProduct(null);
    setSelections({});
    setQuantities({});
    setQuantity(1);
    setNotes('');
    setShowNotes(false);
    setFetchError(false);
    setTriedSubmit(false);
    setStep('detail');
    setSuggestions([]);
    setAddedSuggestions(new Set());

    if (!selectedProduct) return;

    const controller = new AbortController();
    const { signal } = controller;

    if (selectedProduct.skipToUpsell) {
      // Product already added — only fetch suggestions for the upsell step
      const fetchSuggestionsOnly = async () => {
        setLoadingProduct(true);
        try {
          const client = getClient();
          const { data } = await client.GET(`/api/v1/products/{id}/suggestions/`, {
            params: { path: { id: String(selectedProduct.id) } },
            signal,
          });
          if (signal.aborted) return;
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
        } catch (err) {
          if (signal.aborted) return;
          log.error('ProductDetail', 'Failed to fetch suggestions for upsell:', err);
          showToast(t('toastAddedToCart', lang), 'success');
          close();
        } finally {
          if (!signal.aborted) setLoadingProduct(false);
        }
      };
      fetchSuggestionsOnly();
      return () => controller.abort();
    }

    fetchProductById(String(selectedProduct.id), signal);
    return () => controller.abort();
  }, [selectedProductId]);

  // Listen for product card click events (dispatched from inline script)
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, name, slug } = (e as CustomEvent).detail;
      $selectedProduct.set({ id, name, slug });
    };
    window.addEventListener('open-product', handler);
    return () => window.removeEventListener('open-product', handler);
  }, []);

  // Open modal from ?product= query param (direct product URL → menu redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('product');
    const productName = params.get('name');
    const productSlug = params.get('slug');
    if (productId) {
      $selectedProduct.set({
        id: productId,
        name: productName ?? '',
        slug: productSlug ?? undefined,
      });
      // Clean up the query params from the URL
      const clean = new URL(window.location.href);
      clean.searchParams.delete('product');
      clean.searchParams.delete('name');
      clean.searchParams.delete('slug');
      history.replaceState(null, '', clean.pathname + clean.search);
    }
  }, []);

  // Shallow routing: sync URL with modal state
  useEffect(() => {
    if (selectedProduct?.slug && !selectedProduct.skipToUpsell) {
      const langPrefix = (window as { __LANG__?: string }).__LANG__ || 'en';
      const productUrl = `/${langPrefix}/product/${selectedProduct.slug}`;
      try {
        if (window.location.pathname.includes('/product/')) {
          // Product-to-product: replace URL to avoid stale entries in history stack
          history.replaceState({ productModal: true }, '', productUrl);
        } else {
          // Menu → product: push so back button returns to menu
          history.pushState({ productModal: true }, '', productUrl);
          didPushState.current = true;
        }
      } catch (err) {
        // Shallow routing unavailable (e.g. iframe sandbox) — modal still works
        log.warn('ProductDetail', 'Shallow routing unavailable:', err);
      }
    }
  }, [selectedProduct]);

  // Handle browser back button
  useEffect(() => {
    const onPopState = () => {
      if (didPushState.current) {
        didPushState.current = false;
        $selectedProduct.set(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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
  const total = useMemo((): number => {
    if (!product) return 0;
    let sum = Number(product.price);

    for (const group of product.modifier_groups ?? []) {
      const selected = selections[group.id] ?? [];
      const groupQuantities = quantities[group.id] ?? {};

      for (const opt of group.options) {
        if (group.type === 'quantity') {
          sum += Number(opt.price) * (groupQuantities[opt.id] ?? 0);
        } else if (selected.includes(opt.id)) {
          sum += Number(opt.price);
        }
      }
    }

    return Math.round(sum * quantity * 100) / 100;
  }, [product, selections, quantities, quantity]);

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
      setTriedSubmit(true);
      // Scroll to first unfilled group, then shake after scroll completes
      const el = document.getElementById(`modifier-group-${unfilled[0]}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => setShakeGroup(unfilled[0]), 350);
        setTimeout(() => setShakeGroup(null), 750);
      }
      return;
    }

    if (!product) return;

    $cartLoading.set(true);
    try {
      const options: Array<{
        option_id: string | number;
        option_group_id: string | number;
        quantity: number;
      }> = [];

      for (const group of product.modifier_groups ?? []) {
        const selected = selections[group.id] ?? [];
        const groupQtys = quantities[group.id] ?? {};

        for (const opt of group.options) {
          // Preserve original ID types — the backend may use numeric or string IDs
          const optId = /^\d+$/.test(opt.id) ? Number(opt.id) : opt.id;
          const grpId = /^\d+$/.test(group.id) ? Number(group.id) : group.id;

          if (group.type === 'quantity' && (groupQtys[opt.id] ?? 0) > 0) {
            options.push({
              option_id: optId,
              option_group_id: grpId,
              quantity: groupQtys[opt.id],
            });
          } else if (selected.includes(opt.id)) {
            options.push({
              option_id: optId,
              option_group_id: grpId,
              quantity: 1,
            });
          }
        }
      }

      const client = getClient();
      const cartId = await ensureCart(client);
      const { data, error } = await client.POST(`/api/v1/cart/{cart_id}/items/`, {
        params: { path: { cart_id: cartId }, query: cartCoordsQuery() },
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

        log.error('ProductDetail', 'SDK error adding to cart:', error);
        showToast(apiError?.message ?? t('toastAddToCartFailed', lang));
        return;
      }

      if (data) {
        commitCartResponse(data);
        if (suggestions.length > 0) {
          setStep('upsell');
        } else {
          showToast(t('toastAddedToCart', lang), 'success');
          close();
        }
      }
    } catch (err) {
      log.error('ProductDetail', 'Add to cart error:', err);
      showToast(t('toastAddToCartFailed', lang));
    } finally {
      $cartLoading.set(false);
    }
  };

  if (!selectedProduct) return <div />;

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
        class="absolute bottom-0 left-0 right-0 flex max-h-[95vh] flex-col overflow-hidden rounded-t-2xl bg-card shadow-xl md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl"
      >
        {loadingProduct ? (
          <div role="status" aria-label={t('loading', lang)} class="animate-pulse">
            {/* Skeleton: image */}
            <div class="mx-3 mt-3 aspect-[4/3] rounded-xl bg-muted sm:mx-4 sm:mt-4" />
            {/* Skeleton: text lines */}
            <div class="space-y-3 px-4 pt-4">
              <div class="h-6 w-3/4 rounded bg-muted" />
              <div class="h-4 w-full rounded bg-muted" />
              <div class="h-4 w-1/2 rounded bg-muted" />
              <div class="h-5 w-1/4 rounded bg-muted" />
            </div>
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
          <div role="status" aria-label={t('loading', lang)} class="animate-pulse">
            <div class="mx-3 mt-3 aspect-[4/3] rounded-xl bg-muted sm:mx-4 sm:mt-4" />
            <div class="space-y-3 px-4 pt-4">
              <div class="h-6 w-3/4 rounded bg-muted" />
              <div class="h-4 w-full rounded bg-muted" />
              <div class="h-4 w-1/2 rounded bg-muted" />
            </div>
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

            {/* Scrollable content (image scrolls with content per Sil's feedback) */}
            <div class="min-h-0 flex-1 overflow-y-auto">
              {/* Product image (hidden during upsell step) */}
              {step === 'detail' && product.image && (
                <div class="mx-3 mt-3 overflow-hidden rounded-xl bg-card-image sm:mx-4 sm:mt-4">
                  <div class="aspect-[4/3] w-full">
                    {(() => {
                      const img = responsiveImage(
                        product.image,
                        [300, 450, 600],
                        '(min-width: 768px) 512px, 100vw',
                      );
                      return (
                        <img
                          src={img.src}
                          srcset={img.srcset || undefined}
                          sizes={img.sizes || undefined}
                          alt={product.name}
                          class="h-full w-full object-cover"
                          width="512"
                          height="384"
                        />
                      );
                    })()}
                  </div>
                </div>
              )}

              <div class="px-4 pt-4 pb-8">
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

                    {/* Attributes */}
                    {product.attribute_values && product.attribute_values.length > 0 && (
                      <div class="mt-3 grid grid-cols-2 gap-2">
                        {product.attribute_values.map((attr) => {
                          let display: string | null = null;
                          if (
                            attr.input_type === 'multiselect' &&
                            attr.selected_choices.length > 0
                          ) {
                            const labels = attr.selected_choices
                              .map((c) => c.value || c.slug?.replace(/_/g, ' ') || '')
                              .filter(Boolean);
                            display = labels.length > 0 ? labels.join(', ') : null;
                          } else if (attr.input_type === 'boolean' && attr.value_boolean != null) {
                            display = attr.value_boolean ? t('yes', lang) : t('no', lang);
                          } else if (attr.input_type === 'numeric' && attr.value_numeric != null) {
                            display = String(Math.round(Number(attr.value_numeric)));
                          } else if (attr.value_text) {
                            display = attr.value_text;
                          }
                          if (!display) return null;
                          return (
                            <div
                              key={attr.attribute_slug}
                              class="rounded-md bg-muted px-2.5 py-1.5"
                            >
                              <p class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {attr.attribute_name}
                              </p>
                              <p class="text-xs text-card-foreground">{display}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {suggestions.length > 0 && (
                      <div class="mt-4">
                        <h3 class="text-sm font-semibold text-card-foreground">
                          {t('frequentlyCombined', lang)}
                        </h3>
                        <div class="mt-2 space-y-2">
                          {suggestions
                            .filter((s) => !addedSuggestions.has(s.id))
                            .map((s) => (
                              <SuggestionItem
                                key={s.id}
                                suggestion={s}
                                added={false}
                                currency={currency}
                                locale={locale}
                                lang={lang}
                                onAdd={async () => {
                                  const result = await addSuggestionToCart(s.id);
                                  if (result === 'added') {
                                    setAddedSuggestions((prev) => new Set([...prev, s.id]));
                                  } else if (result === 'requires_options') {
                                    $selectedProduct.set({ id: String(s.id), name: s.title });
                                  } else {
                                    showToast(t('toastAddToCartFailed', lang));
                                  }
                                }}
                              />
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
                      <div class="mt-3 grid grid-cols-2 gap-2">
                        {product.attribute_values.map((attr) => {
                          let display: string | null = null;
                          if (
                            attr.input_type === 'multiselect' &&
                            attr.selected_choices.length > 0
                          ) {
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
                            <div
                              key={attr.attribute_slug}
                              class="rounded-md bg-muted px-2.5 py-1.5"
                            >
                              <p class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                {attr.attribute_name}
                              </p>
                              <p class="text-xs text-card-foreground">{display}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Modifier groups */}
                    {(product.modifier_groups ?? []).map((group) => (
                      <div
                        key={group.id}
                        id={`modifier-group-${group.id}`}
                        class={`mt-4 rounded-2xl bg-muted/50 p-4 ${shakeGroup === group.id ? 'animate-shake' : ''}`}
                      >
                        <div class="flex items-center justify-between">
                          <h3 class="text-sm font-semibold text-card-foreground">{group.name}</h3>
                          {group.required && (
                            <span
                              class={`inline-flex items-center gap-1 text-xs font-medium transition-colors duration-300 ${
                                isGroupFilled(group.id)
                                  ? 'text-emerald-600'
                                  : triedSubmit
                                    ? 'text-destructive'
                                    : 'text-muted-foreground'
                              }`}
                            >
                              {isGroupFilled(group.id) && (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2.5"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                >
                                  <path d="M20 6 9 17l-5-5" />
                                </svg>
                              )}
                              {isGroupFilled(group.id) ? t('done', lang) : t('required', lang)}
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
                                          handleCheckboxToggle(
                                            group.id,
                                            opt.id,
                                            group.max_selections,
                                          )
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
                                          class="relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-sm disabled:opacity-30 before:absolute before:inset-[-4px]"
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
                                          class="relative inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-sm before:absolute before:inset-[-4px]"
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
                            <SuggestionItem
                              key={s.id}
                              suggestion={s}
                              added={addedSuggestions.has(s.id)}
                              currency={currency}
                              locale={locale}
                              lang={lang}
                              onAdd={async () => {
                                const result = await addSuggestionToCart(s.id);
                                if (result === 'added') {
                                  setAddedSuggestions((prev) => new Set([...prev, s.id]));
                                } else if (result === 'requires_options') {
                                  $selectedProduct.set({ id: String(s.id), name: s.title });
                                } else {
                                  showToast(t('toastAddToCartFailed', lang));
                                }
                              }}
                            />
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
            </div>

            {/* Sticky bottom CTA */}
            <div
              class="shrink-0 px-4 pt-3 pb-6"
              style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
            >
              {step === 'upsell' ? (
                <div class="space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      $isCartOpen.set(true);
                    }}
                    class="flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {t('done', lang)}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (didPushState.current) {
                        didPushState.current = false;
                        $selectedProduct.set(null);
                        history.back();
                      } else {
                        $selectedProduct.set(null);
                      }
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

export default withErrorBoundary(ProductDetail, 'ProductDetail');
