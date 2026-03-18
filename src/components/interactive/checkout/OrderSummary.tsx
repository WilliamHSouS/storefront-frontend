import { useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $cart, $cartTotal } from '@/stores/cart';
import type { CartLineItem } from '@/stores/cart';
import { $checkout, $checkoutTotals } from '@/stores/checkout';
import { formatPrice, langToLocale } from '@/lib/currency';
import { optimizedImageUrl } from '@/lib/image';
import { t } from '@/i18n';

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
  const shipping = checkout ? totals.shipping : cart?.shipping_cost;
  const tax = checkout ? totals.tax : cart?.tax_total;
  const discount = checkout ? totals.discount : cart?.discount_amount;
  const total = checkout ? totals.total : cartTotal;

  const shippingNum = shipping ? parseFloat(shipping) : 0;
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
      <div class="mt-3 pt-3 border-t border-border space-y-1">
        {/* Subtotal */}
        {subtotal && (
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">{t('subtotal', lang)}</span>
            <span class="text-card-foreground">{formatPrice(subtotal, currency, locale)}</span>
          </div>
        )}

        {/* Shipping */}
        {shipping != null && (
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">{t('shipping', lang)}</span>
            <span class="text-card-foreground">
              {shippingNum === 0
                ? t('shippingFree', lang)
                : formatPrice(shipping, currency, locale)}
            </span>
          </div>
        )}

        {/* Discount */}
        {discountNum > 0 && (
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted-foreground">{t('discount', lang)}</span>
            <span class="font-medium text-destructive">
              -{formatPrice(discount!, currency, locale)}
            </span>
          </div>
        )}

        {/* Tax */}
        {tax && (
          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t('taxIncluded', lang)}</span>
            <span>{formatPrice(tax, currency, locale)}</span>
          </div>
        )}

        {/* Total */}
        <div class="flex items-center justify-between border-t border-border pt-2 mt-2">
          <span class="text-sm font-medium text-card-foreground">{t('orderTotal', lang)}</span>
          <span class="text-lg font-bold text-card-foreground">
            {formatPrice(total, currency, locale)}
          </span>
        </div>
      </div>
    </div>
  );
}
