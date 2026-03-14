import { useStore } from '@nanostores/preact';
import { $itemCount, $cartTotal } from '@/stores/cart';
import { $isCartOpen } from '@/stores/ui';
import { $merchant } from '@/stores/merchant';
import { t } from '@/i18n';
import { formatPrice, langToLocale } from '@/lib/currency';

interface Props {
  lang: string;
}

export default function CartBadge({ lang }: Props) {
  const count = useStore($itemCount);
  const cartTotal = useStore($cartTotal);
  const merchant = useStore($merchant);

  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  const itemLabel =
    count === 1 ? t('items_one', lang, { count }) : t('items_other', lang, { count });

  // Empty cart: icon-only button
  if (count === 0) {
    return (
      <button
        type="button"
        data-cart-trigger
        onClick={() => $isCartOpen.set(true)}
        class="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-card text-foreground transition-all duration-300 hover:bg-card/80"
        aria-label={t('cart', lang)}
      >
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
          <path d="M16 10a4 4 0 0 1-8 0" />
          <path d="M3.103 6.034h17.794" />
          <path d="M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z" />
        </svg>
      </button>
    );
  }

  // Items in cart: dark pill
  return (
    <button
      type="button"
      data-cart-trigger
      onClick={() => $isCartOpen.set(true)}
      class="hidden items-center gap-1.5 rounded-full bg-[#1C1C1E] px-4 py-2 text-white transition-all duration-300 hover:bg-[#2C2C2E] md:inline-flex"
      aria-label={`${t('cart', lang)}: ${itemLabel}, ${formatPrice(cartTotal, currency, locale)}`}
    >
      <span class="text-sm font-medium">{t('cart', lang)}</span>
      <span class="text-sm text-white/60">&middot;</span>
      <span class="text-sm text-white/60">{itemLabel}</span>
      <span class="text-sm font-semibold">{formatPrice(cartTotal, currency, locale)}</span>
    </button>
  );
}
