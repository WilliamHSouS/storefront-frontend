import { useStore } from '@nanostores/preact';
import { useRef } from 'preact/hooks';
import { $cart, $cartTotal, $cartLoading } from '@/stores/cart';
import { normalizeCart } from '@/lib/normalize';
import { $isCartOpen } from '@/stores/ui';
import { $merchant } from '@/stores/merchant';
import { formatPrice, langToLocale } from '@/lib/currency';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { t } from '@/i18n';
import QuantitySelector from './QuantitySelector';
import { getClient } from '@/lib/api';

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

  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  const close = () => $isCartOpen.set(false);

  // Skip focus trap when inline — the page itself handles focus
  useFocusTrap(drawerRef, !inline && isOpen, close);

  const handleUpdateQuantity = async (itemId: string, newQuantity: number) => {
    const cartId = cart?.id;
    if (!cartId) return;
    $cartLoading.set(true);
    try {
      const client = getClient();
      const { data } = await client.PATCH(`/api/v1/cart/{cart_id}/items/{id}/`, {
        params: { path: { cart_id: cartId, id: itemId } },
        body: { quantity: newQuantity },
      });
      if (data) $cart.set(normalizeCart(data as Record<string, unknown>));
    } catch (err) {
      console.error('[cart] failed to update quantity:', err);
    } finally {
      $cartLoading.set(false);
    }
  };

  const handleRemove = async (itemId: string) => {
    const cartId = cart?.id;
    if (!cartId) return;
    $cartLoading.set(true);
    try {
      const client = getClient();
      const { data } = await client.DELETE(`/api/v1/cart/{cart_id}/items/{id}/`, {
        params: { path: { cart_id: cartId, id: itemId } },
      });
      if (data) $cart.set(normalizeCart(data as Record<string, unknown>));
    } catch (err) {
      console.error('[cart] failed to remove item:', err);
    } finally {
      $cartLoading.set(false);
    }
  };

  // Inline mode always renders; drawer mode only renders when open
  if (!inline && !isOpen) return null;

  const lineItems = cart?.line_items ?? [];
  const savings =
    cart?.cart_savings && parseFloat(cart.cart_savings) > 0 ? cart.cart_savings : null;

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
            <ul class="divide-y divide-border">
              {lineItems.map((item) => (
                <li key={item.id} class="flex gap-3 py-3">
                  {item.product_image && (
                    <div class="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-card-image">
                      <img
                        src={item.product_image}
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
                        <p class="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {item.selected_options.map((m) => m.name).join(', ')}
                        </p>
                      )}
                    </div>
                    <div class="mt-1 flex items-center justify-between">
                      <QuantitySelector
                        quantity={item.quantity}
                        onIncrement={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                        onDecrement={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                        onRemove={() => handleRemove(item.id)}
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
              ))}
            </ul>
          )}
        </div>
        {lineItems.length > 0 && (
          <div class="border-t border-border px-4 py-3">
            {savings && (
              <div class="mb-2 flex items-center justify-between text-sm">
                <span class="text-muted-foreground">{t('youSave', lang)}</span>
                <span class="font-medium text-destructive">
                  {formatPrice(savings, currency, locale)}
                </span>
              </div>
            )}
            <div class="mb-3 flex items-center justify-between">
              <span class="text-sm font-medium text-card-foreground">{t('orderTotal', lang)}</span>
              <span class="text-lg font-bold text-card-foreground">
                {formatPrice(cartTotal, currency, locale)}
              </span>
            </div>
            <a
              href={`/${lang}/checkout`}
              class="flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t('nextCheckout', lang)}
            </a>
          </div>
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
            <ul class="divide-y divide-border">
              {lineItems.map((item) => (
                <li key={item.id} class="flex gap-3 py-3">
                  {/* Item image */}
                  {item.product_image && (
                    <div class="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-card-image">
                      <img
                        src={item.product_image}
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
                        <p class="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {item.selected_options.map((m) => m.name).join(', ')}
                        </p>
                      )}
                    </div>
                    <div class="mt-1 flex items-center justify-between">
                      <QuantitySelector
                        quantity={item.quantity}
                        onIncrement={() => handleUpdateQuantity(item.id, item.quantity + 1)}
                        onDecrement={() => handleUpdateQuantity(item.id, item.quantity - 1)}
                        onRemove={() => handleRemove(item.id)}
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
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        {lineItems.length > 0 && (
          <div
            class="border-t border-border px-4 py-3"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
          >
            {savings && (
              <div class="mb-2 flex items-center justify-between text-sm">
                <span class="text-muted-foreground">{t('youSave', lang)}</span>
                <span class="font-medium text-destructive">
                  {formatPrice(savings, currency, locale)}
                </span>
              </div>
            )}
            <div class="mb-3 flex items-center justify-between">
              <span class="text-sm font-medium text-card-foreground">{t('orderTotal', lang)}</span>
              <span class="text-lg font-bold text-card-foreground">
                {formatPrice(cartTotal, currency, locale)}
              </span>
            </div>
            <a
              href={`/${lang}/checkout`}
              class="flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t('nextCheckout', lang)}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
