import { useStore } from '@nanostores/preact';
import { useEffect } from 'preact/hooks';
import { $cart, $itemCount, $cartTotal, getStoredCartId, cartCoordsQuery } from '@/stores/cart';
import { $isCartOpen, $isCategoryDrawerOpen } from '@/stores/ui';
import { $merchant } from '@/stores/merchant';
import { t } from '@/i18n';
import { formatPrice, langToLocale } from '@/lib/currency';
import { getClient } from '@/lib/api';
import { normalizeCart } from '@/lib/normalize';

interface Props {
  lang: string;
}

export default function CartBar({ lang }: Props) {
  // Initialize cart from API on first mount
  useEffect(() => {
    if ($cart.get()) return; // already initialized
    const cartId = getStoredCartId();
    if (!cartId) return; // no stored cart
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
        aria-label={`${t('cart', lang)}: ${itemLabel}, ${formatPrice(cartTotal, currency, locale)}`}
      >
        <div class="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="8" cy="21" r="1" />
            <circle cx="19" cy="21" r="1" />
            <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
          </svg>
          <span class="text-sm font-medium">
            {t('cart', lang)} &middot; {itemLabel}
          </span>
        </div>
        <span class="text-sm font-semibold">{formatPrice(cartTotal, currency, locale)}</span>
      </button>
    </div>
  );
}
