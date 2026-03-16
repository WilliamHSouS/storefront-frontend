import { useStore } from '@nanostores/preact';
import { useEffect } from 'preact/hooks';
import { $cart, $itemCount, $cartTotal, getStoredCartId, cartCoordsQuery } from '@/stores/cart';
import { $addressCoords } from '@/stores/address';
import { $isCartOpen, $isCategoryDrawerOpen } from '@/stores/ui';
import { $merchant } from '@/stores/merchant';
import { t } from '@/i18n';
import { formatPrice, langToLocale } from '@/lib/currency';
import { getClient } from '@/lib/api';
import { normalizeCart } from '@/lib/normalize';
import { CartIcon } from './icons';

interface Props {
  lang: string;
}

export default function CartBar({ lang }: Props) {
  // Initialize cart from API on first mount.
  // Skip if address hydration will re-fetch the cart with coordinates (prevents double GET).
  useEffect(() => {
    if ($cart.get()) return; // already initialized
    const cartId = getStoredCartId();
    if (!cartId) return; // no stored cart
    // If an address is stored, hydrateAddressFromStorage() will call refreshCartWithCoords
    // which fetches the cart with coordinates. Avoid a redundant fetch here.
    if ($addressCoords.get()) return;
    const client = getClient();
    client
      .GET(`/api/v1/cart/{id}/`, {
        params: { path: { id: cartId }, query: cartCoordsQuery() },
      })
      .then(({ data }) => {
        if (data) $cart.set(normalizeCart(data as Record<string, unknown>));
      })
      .catch(() => {
        /* cart may have expired */
      });
  }, []);
  const itemCount = useStore($itemCount);
  const cartTotal = useStore($cartTotal);
  const isCartOpen = useStore($isCartOpen);
  const isCategoryDrawerOpen = useStore($isCategoryDrawerOpen);
  const merchant = useStore($merchant);

  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  // Hide when: no items, cart drawer open, or category drawer open
  if (itemCount === 0 || isCartOpen || isCategoryDrawerOpen) {
    return null;
  }

  const itemLabel =
    itemCount === 1
      ? t('items_one', lang, { count: itemCount })
      : t('items_other', lang, { count: itemCount });

  return (
    <div
      class="fixed bottom-0 left-0 right-0 z-40 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <button
        type="button"
        onClick={() => $isCartOpen.set(true)}
        class="flex w-full items-center justify-between bg-[#1C1C1E] px-4 py-3 text-white"
        data-cart-trigger
        aria-label={`${t('cart', lang)}: ${itemLabel}, ${formatPrice(cartTotal, currency, locale)}`}
      >
        <div class="flex items-center gap-2">
          <CartIcon />
          <span class="text-sm font-medium">
            {t('cart', lang)} &middot; {itemLabel}
          </span>
        </div>
        <span class="text-sm font-semibold">{formatPrice(cartTotal, currency, locale)}</span>
      </button>
    </div>
  );
}
