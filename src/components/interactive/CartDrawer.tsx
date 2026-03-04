import { useStore } from '@nanostores/preact';
import { useRef, useEffect } from 'preact/hooks';
import { $cart, $cartTotal, $cartLoading, $eligiblePromotions } from '@/stores/cart';
import type { CartLineItem as CartLineItemType, Cart } from '@/stores/cart';
import { $isCartOpen } from '@/stores/ui';
import { $merchant } from '@/stores/merchant';
import { formatPrice, langToLocale } from '@/lib/currency';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { t } from '@/i18n';
import { optimizedImageUrl } from '@/lib/image';
import QuantitySelector from './QuantitySelector';
import { setCartItemQuantity, checkPromotionEligibility } from '@/stores/cart-actions';
import { showToast } from '@/stores/toast';
import PromoBanner from './PromoBanner';
import DiscountCodeInput from './DiscountCodeInput';

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
  style?: Record<string, string>;
}

function CartFooter({ cart, cartTotal, currency, locale, lang, style }: CartFooterProps) {
  const loading = useStore($cartLoading);
  const subtotal = cart.subtotal;
  const shipping = cart.shipping_cost;
  const taxTotal = cart.tax_total;
  const taxIncluded = cart.tax_included ?? true;
  const discountNum = cart.discount_amount ? parseFloat(cart.discount_amount) : 0;
  const promoNum = cart.promotion_discount_amount ? parseFloat(cart.promotion_discount_amount) : 0;
  const shippingNum = shipping ? parseFloat(shipping) : 0;

  // "You save" only for product-level savings (not code/promo discounts)
  const hasCodeOrPromo = discountNum > 0 || promoNum > 0;
  const savings =
    !hasCodeOrPromo && cart.cart_savings && parseFloat(cart.cart_savings) > 0
      ? cart.cart_savings
      : null;

  return (
    <div class="border-t border-border px-4 py-3" style={style}>
      <DiscountCodeInput cart={cart} lang={lang} />

      {/* Subtotal */}
      {subtotal && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('subtotal', lang)}</span>
          <span class="text-card-foreground">{formatPrice(subtotal, currency, locale)}</span>
        </div>
      )}

      {/* Shipping */}
      {shipping && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('shipping', lang)}</span>
          <span class="text-card-foreground">
            {shippingNum === 0 ? t('shippingFree', lang) : formatPrice(shipping, currency, locale)}
          </span>
        </div>
      )}

      {/* Discount code savings */}
      {discountNum > 0 && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('discount', lang)}</span>
          <span class="font-medium text-destructive">
            -{formatPrice(cart.discount_amount!, currency, locale)}
          </span>
        </div>
      )}

      {/* Promotion savings */}
      {promoNum > 0 && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('promotion', lang)}</span>
          <span class="font-medium text-destructive">
            -{formatPrice(cart.promotion_discount_amount!, currency, locale)}
          </span>
        </div>
      )}

      {/* You save (product-level only -- hidden when code/promo discounts are active) */}
      {savings && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('youSave', lang)}</span>
          <span class="font-medium text-destructive">{formatPrice(savings, currency, locale)}</span>
        </div>
      )}

      {/* Tax */}
      {taxTotal && (
        <div class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{taxIncluded ? t('taxIncluded', lang) : t('tax', lang)}</span>
          <span>{formatPrice(taxTotal, currency, locale)}</span>
        </div>
      )}

      {/* Total */}
      <div class="mb-3 flex items-center justify-between border-t border-border pt-2">
        <span class="text-sm font-medium text-card-foreground">{t('orderTotal', lang)}</span>
        <span class="text-lg font-bold text-card-foreground">
          {formatPrice(cartTotal, currency, locale)}
        </span>
      </div>

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

  const eligiblePromotions = useStore($eligiblePromotions);

  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  // Check promotion eligibility when cart changes (debounced + cancellable)
  useEffect(() => {
    if (!cart || cart.line_items.length === 0) {
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
  }, [cart?.line_items.length, cart?.cart_total]);

  const close = () => $isCartOpen.set(false);

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
      console.error('[cart] failed to update quantity:', err);
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
      console.error('[cart] failed to remove item:', err);
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
        <div class="px-4 py-3">
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
              {lineItems.length > 0 && <PromoBanner promotions={eligiblePromotions} lang={lang} />}
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
        class="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-hidden rounded-t-xl bg-card shadow-xl md:bottom-auto md:left-auto md:right-4 md:top-16 md:w-96 md:rounded-lg"
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
        </div>

        {/* Body */}
        <div class="overflow-y-auto px-4 py-3" style={{ maxHeight: 'calc(85vh - 140px)' }}>
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
              {lineItems.length > 0 && <PromoBanner promotions={eligiblePromotions} lang={lang} />}
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
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
          />
        )}
      </div>
    </div>
  );
}
