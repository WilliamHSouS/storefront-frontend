import { useStore } from '@nanostores/preact';
import { useRef, useEffect, useCallback } from 'preact/hooks';
import { $cart, $cartTotal, $cartLoading, $eligiblePromotions } from '@/stores/cart';
import type { CartLineItem as CartLineItemType, Cart } from '@/stores/cart';
import { $isCartOpen } from '@/stores/ui';
import { $merchant } from '@/stores/merchant';
import { formatPrice, langToLocale } from '@/lib/currency';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { t } from '@/i18n/client';
import { optimizedImageUrl } from '@/lib/image';
import * as log from '@/lib/logger';
import QuantitySelector from './QuantitySelector';
import CartSuggestions from './CartSuggestions';
import { setCartItemQuantity, checkPromotionEligibility } from '@/stores/cart-actions';
import { backgroundRefreshShipping } from '@/stores/cart';
import { $addressCoords } from '@/stores/address';
import { showToast } from '@/stores/toast';
import PromoBanner from './PromoBanner';
import DiscountCodeInput from './DiscountCodeInput';
import { ShippingEstimate } from './ShippingEstimate';
import { PricingBreakdown } from './cart/PricingBreakdown';
import { CloseIcon } from './icons';

/* ------------------------------------------------------------------ */
/*  Shared sub-components (used by both inline and drawer modes)      */
/* ------------------------------------------------------------------ */

interface CartLineItemProps {
  item: CartLineItemType;
  currency: string;
  locale: string;
  lang: string;
  onUpdateQuantity: (itemId: string, newQuantity: number) => void;
  onRemove: (itemId: string) => void;
}

function CartLineItem({
  item,
  currency,
  locale,
  lang,
  onUpdateQuantity,
  onRemove,
}: CartLineItemProps) {
  return (
    <li class="flex gap-3 py-3">
      {item.product_image && (
        <div class="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-card-image">
          <img
            src={optimizedImageUrl(item.product_image, { width: 128 })}
            alt=""
            class="h-full w-full object-cover"
            width="64"
            height="64"
            loading="lazy"
          />
        </div>
      )}
      <div class="flex flex-1 flex-col justify-between">
        <div>
          <h3 class="text-sm font-medium text-card-foreground">{item.product_title}</h3>
          {item.selected_options && item.selected_options.length > 0 && (
            <div class="mt-0.5 space-y-0.5">
              {item.selected_options.map((opt) => (
                <p key={String(opt.id)} class="text-xs text-muted-foreground">
                  {opt.group_name ? `${opt.group_name}: ` : ''}
                  {opt.name}
                  {opt.quantity > 1 ? ` x${opt.quantity}` : ''}
                  {parseFloat(opt.price) > 0
                    ? ` (+${formatPrice(opt.price, currency, locale)})`
                    : ''}
                </p>
              ))}
            </div>
          )}
        </div>
        <div class="mt-1 flex items-center justify-between">
          <QuantitySelector
            quantity={item.quantity}
            onIncrement={() => onUpdateQuantity(item.id, item.quantity + 1)}
            onDecrement={() => onUpdateQuantity(item.id, item.quantity - 1)}
            onRemove={() => onRemove(item.id)}
            lang={lang}
          />
          <div class="text-right">
            <span class="text-sm font-semibold text-card-foreground">
              {formatPrice(item.line_total, currency, locale)}
            </span>
            {item.discount && (
              <span class="block text-xs text-destructive">{item.discount.label}</span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

interface CartFooterProps {
  cart: Cart;
  cartTotal: string;
  currency: string;
  locale: string;
  lang: string;
  loading: boolean;
  style?: Record<string, string>;
}

function CartFooter({ cart, cartTotal, currency, locale, lang, loading, style }: CartFooterProps) {
  const taxIncluded = cart.tax_included ?? true;
  const discountNum = cart.discount_amount ? parseFloat(cart.discount_amount) : 0;
  const promoNum = cart.promotion_discount_amount ? parseFloat(cart.promotion_discount_amount) : 0;

  // "You save" only for product-level savings (not code/promo discounts)
  const hasDiscounts = discountNum > 0 || promoNum > 0;
  const savings =
    !hasDiscounts && cart.cart_savings && parseFloat(cart.cart_savings) > 0
      ? cart.cart_savings
      : null;

  // Shipping: only use legacy fallback when no rich shipping_estimate exists.
  // Only show "Free" when we have address data confirming free shipping —
  // otherwise "0.00" just means "not calculated yet" and would mislead the user.
  const hasAddress = !!$addressCoords.get();
  const legacyShipping = !cart.shipping_estimate && cart.shipping_cost ? cart.shipping_cost : null;

  return (
    <div
      class="max-h-[50vh] shrink-0 overflow-y-auto border-t border-border px-4 py-3"
      style={style}
    >
      <DiscountCodeInput cart={cart} lang={lang} />
      <CartSuggestions lang={lang} />

      <PricingBreakdown
        lang={lang as 'nl' | 'en' | 'de'}
        currency={currency}
        locale={locale}
        subtotal={cart.subtotal ?? '0.00'}
        shipping={legacyShipping}
        tax={cart.tax_total ?? '0.00'}
        discount={discountNum > 0 ? cart.discount_amount! : null}
        total={cartTotal}
        surchargeTotal={cart.surcharge_total}
        promotionDiscount={cart.promotion_discount_amount}
        productSavings={savings ?? undefined}
        taxIncluded={taxIncluded}
        showShippingFree={hasAddress}
        shippingSlot={
          <ShippingEstimate
            lang={lang}
            currency={currency}
            shippingEstimate={cart.shipping_estimate}
          />
        }
      />

      <a
        href={`/${lang}/checkout`}
        class={`flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 ${loading ? 'pointer-events-none opacity-50' : ''}`}
        aria-disabled={loading}
      >
        {t('nextCheckout', lang)}
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main CartDrawer component                                         */
/* ------------------------------------------------------------------ */

interface Props {
  lang: string;
  /** When true, renders inline (no overlay/close button) — used on the cart page */
  inline?: boolean;
}

export default function CartDrawer({ lang, inline = false }: Props) {
  const cart = useStore($cart);
  const cartTotal = useStore($cartTotal);
  const isOpen = useStore($isCartOpen);
  const merchant = useStore($merchant);
  const drawerRef = useRef<HTMLDivElement>(null);

  const loading = useStore($cartLoading);
  const eligiblePromotions = useStore($eligiblePromotions);

  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  // Stable fingerprint of cart contents — catches product swaps at same price/count
  const cartFingerprint =
    cart?.line_items.map((li) => `${li.product_id}:${li.quantity}`).join(',') ?? '';

  // Check promotion eligibility when cart changes (debounced + cancellable)
  useEffect(() => {
    if (!cart || cart.line_items.length === 0) {
      $eligiblePromotions.set([]);
      return;
    }

    // Backend already applied a promotion — no need to check eligibility
    if (cart.promotion) {
      $eligiblePromotions.set([]);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      checkPromotionEligibility(cart, undefined, controller.signal).catch(() => {});
    }, 300);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [cartFingerprint, cart?.promotion?.id]);

  // Refresh shipping estimate when drawer opens without one
  const hasShippingEstimate = !!cart?.shipping_estimate;
  useEffect(() => {
    if (isOpen && cart?.id && !hasShippingEstimate && $addressCoords.get()) {
      backgroundRefreshShipping(cart.id);
    }
  }, [isOpen, cart?.id, hasShippingEstimate]);

  const close = useCallback(() => $isCartOpen.set(false), []);

  // Skip focus trap when inline — the page itself handles focus
  useFocusTrap(drawerRef, !inline && isOpen, close);

  const handleUpdateQuantity = async (itemId: string, newQuantity: number) => {
    const cartId = cart?.id;
    if (!cartId) {
      showToast(t('toastCartUpdateFailed', lang));
      return;
    }
    try {
      await setCartItemQuantity(cartId, itemId, newQuantity);
    } catch (err) {
      log.error('cart', 'Failed to update quantity:', err);
      showToast(t('toastCartUpdateFailed', lang));
    }
  };

  const handleRemove = async (itemId: string) => {
    const cartId = cart?.id;
    if (!cartId) {
      showToast(t('toastCartUpdateFailed', lang));
      return;
    }
    try {
      await setCartItemQuantity(cartId, itemId, 0);
    } catch (err) {
      log.error('cart', 'Failed to remove item:', err);
      showToast(t('toastCartUpdateFailed', lang));
    }
  };

  // Inline mode always renders; drawer mode only renders when open
  if (!inline && !isOpen) return null;

  const lineItems = cart?.line_items ?? [];

  // Inline mode: render directly without overlay/modal chrome
  if (inline) {
    return (
      <div ref={drawerRef}>
        <div
          class={`px-4 py-3 transition-opacity duration-150 ${loading ? 'pointer-events-none opacity-50' : ''}`}
        >
          {lineItems.length === 0 ? (
            <div class="py-8 text-center">
              <p class="text-sm text-muted-foreground">{t('emptyCart', lang)}</p>
              <a
                href={`/${lang}/`}
                class="mt-3 inline-block text-sm font-medium text-primary hover:underline"
              >
                {t('continueShopping', lang)}
              </a>
            </div>
          ) : (
            <>
              {lineItems.length > 0 && (
                <PromoBanner
                  promotion={cart?.promotion}
                  eligiblePromotions={eligiblePromotions}
                  lang={lang}
                />
              )}
              <ul class="divide-y divide-border">
                {lineItems.map((item) => (
                  <CartLineItem
                    key={item.id}
                    item={item}
                    currency={currency}
                    locale={locale}
                    lang={lang}
                    onUpdateQuantity={handleUpdateQuantity}
                    onRemove={handleRemove}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
        {lineItems.length > 0 && (
          <CartFooter
            cart={cart!}
            cartTotal={cartTotal}
            currency={currency}
            locale={locale}
            lang={lang}
            loading={loading}
          />
        )}
      </div>
    );
  }

  return (
    <div class="fixed inset-0 z-50">
      {/* Backdrop */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div class="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={close} />

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('cart', lang)}
        class="absolute bottom-0 left-0 right-0 flex max-h-[85vh] flex-col overflow-hidden rounded-t-xl bg-card shadow-xl md:bottom-auto md:left-auto md:right-4 md:top-16 md:w-96 md:rounded-lg"
      >
        {/* Header */}
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 class="font-heading text-base font-semibold text-card-foreground">
            {t('cart', lang)}
          </h2>
          <button
            type="button"
            onClick={close}
            class="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent before:absolute before:inset-[-6px]"
            aria-label={t('close', lang)}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div
          class={`shrink overflow-y-auto px-4 py-3 transition-opacity duration-150 ${loading ? 'pointer-events-none opacity-50' : ''}`}
        >
          {lineItems.length === 0 ? (
            <div class="py-8 text-center">
              <p class="text-sm text-muted-foreground">{t('emptyCart', lang)}</p>
              <button
                type="button"
                onClick={close}
                class="mt-3 text-sm font-medium text-primary hover:underline"
              >
                {t('continueShopping', lang)}
              </button>
            </div>
          ) : (
            <>
              {lineItems.length > 0 && (
                <PromoBanner
                  promotion={cart?.promotion}
                  eligiblePromotions={eligiblePromotions}
                  lang={lang}
                />
              )}
              <ul class="divide-y divide-border">
                {lineItems.map((item) => (
                  <CartLineItem
                    key={item.id}
                    item={item}
                    currency={currency}
                    locale={locale}
                    lang={lang}
                    onUpdateQuantity={handleUpdateQuantity}
                    onRemove={handleRemove}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Footer */}
        {lineItems.length > 0 && (
          <CartFooter
            cart={cart!}
            cartTotal={cartTotal}
            currency={currency}
            locale={locale}
            lang={lang}
            loading={loading}
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
          />
        )}
      </div>
    </div>
  );
}
