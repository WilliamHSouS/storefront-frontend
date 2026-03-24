import { useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $cart, $cartTotal } from '@/stores/cart';
import type { CartLineItem } from '@/stores/cart';
import { $checkout, $checkoutTotals } from '@/stores/checkout';
import { formatPrice, langToLocale } from '@/lib/currency';
import { optimizedImageUrl } from '@/lib/image';
import { t } from '@/i18n/client';
import { PricingBreakdown } from '../cart/PricingBreakdown';

interface Props {
  lang: 'nl' | 'en' | 'de';
  currency: string;
}

const COLLAPSE_THRESHOLD = 4;

function LineItem({
  item,
  currency,
  locale,
  lang,
}: {
  item: CartLineItem;
  currency: string;
  locale: string;
  lang: 'nl' | 'en' | 'de';
}) {
  return (
    <li class="flex items-center gap-3 py-2">
      {item.product_image && (
        <div class="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-card-image">
          <img
            src={optimizedImageUrl(item.product_image, { width: 80 })}
            alt=""
            class="h-full w-full object-cover"
            width="40"
            height="40"
            loading="lazy"
          />
        </div>
      )}
      <div class="flex flex-1 items-center justify-between min-w-0">
        <div class="min-w-0 mr-2">
          <p class="text-sm text-card-foreground truncate">{item.product_title}</p>
          <p class="text-xs text-muted-foreground">
            {t('itemCount_one', lang).replace('{count}', String(item.quantity))}
          </p>
        </div>
        <span class="text-sm font-medium text-card-foreground shrink-0">
          {formatPrice(item.line_total, currency, locale)}
        </span>
      </div>
    </li>
  );
}

export function OrderSummary({ lang, currency }: Props) {
  const cart = useStore($cart);
  const cartTotal = useStore($cartTotal);
  const checkout = useStore($checkout);
  const totals = useStore($checkoutTotals);
  const [expanded, setExpanded] = useState(false);

  const locale = langToLocale(lang);
  const lineItems = cart?.line_items ?? [];
  const itemCount = lineItems.length;

  // Use checkout totals if available, fall back to cart
  const subtotal = checkout ? totals.subtotal : cart?.subtotal;
  const tax = checkout ? totals.tax : cart?.tax_total;
  const discount = checkout ? totals.discount : cart?.discount_amount;
  const surchargeTotal = checkout ? checkout.surcharge_total : cart?.surcharge_total;

  // Shipping: use checkout's shipping after delivery_set (authoritative), otherwise cart estimate.
  // Before delivery_set, checkout.display_shipping_cost is "0.00" which means "not calculated",
  // not "free" — so we only trust it after the status advances.
  const checkoutShippingKnown = checkout && checkout.status !== 'created' ? totals.shipping : null;
  const cartShipping = cart?.shipping_estimate?.total_shipping ?? null;
  const shipping = checkoutShippingKnown ?? cartShipping;

  // Total: use cartTotal (which prefers estimated_total including shipping)
  const total = checkout ? totals.total : cartTotal;

  const discountNum = discount ? parseFloat(discount) : 0;

  const shouldCollapse = itemCount >= COLLAPSE_THRESHOLD && !expanded;
  const visibleItems = shouldCollapse ? lineItems.slice(0, 2) : lineItems;

  return (
    <div class="bg-card rounded-lg border border-border p-4">
      {/* Line items */}
      <ul class="divide-y divide-border">
        {visibleItems.map((item) => (
          <LineItem key={item.id} item={item} currency={currency} locale={locale} lang={lang} />
        ))}
      </ul>

      {/* Expand toggle */}
      {itemCount >= COLLAPSE_THRESHOLD && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          class="mt-1 w-full text-center text-sm text-primary hover:underline"
        >
          {expanded
            ? t('close', lang)
            : t('itemCount_other', lang, { count: itemCount - 2 }).replace(
                String(itemCount - 2),
                `+${itemCount - 2}`,
              )}
        </button>
      )}

      {/* Price breakdown — always visible */}
      <div class="mt-3 pt-3 border-t border-border">
        <PricingBreakdown
          lang={lang}
          currency={currency}
          locale={locale}
          subtotal={subtotal ?? '0.00'}
          shipping={shipping ?? null}
          tax={tax ?? '0.00'}
          discount={discountNum > 0 ? discount! : null}
          surchargeTotal={surchargeTotal}
          total={total ?? '0.00'}
          taxIncluded={true}
          showShippingFree={shipping != null}
        />
      </div>
    </div>
  );
}
