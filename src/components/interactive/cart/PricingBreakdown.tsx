import type { ComponentChildren } from 'preact';
import { formatPrice } from '@/lib/currency';
import { t } from '@/i18n';

export interface PricingBreakdownProps {
  lang: 'nl' | 'en' | 'de';
  currency: string;
  locale: string;
  // Price values as strings (decimal format)
  subtotal: string;
  shipping: string | null; // null = not yet calculated
  tax: string;
  discount: string | null; // null = no discount
  total: string;
  // Optional extra lines from cart
  surchargeTotal?: string;
  promotionDiscount?: string;
  productSavings?: string; // "You save" amount
  taxIncluded?: boolean;
  // Display options
  showShippingFree?: boolean; // whether to show "Free" or hide when 0
  // Optional slot rendered between surcharges and the legacy shipping line
  // (used by CartFooter to inject the rich ShippingEstimate component)
  shippingSlot?: ComponentChildren;
}

export function PricingBreakdown({
  lang,
  currency,
  locale,
  subtotal,
  shipping,
  tax,
  discount,
  total,
  surchargeTotal,
  promotionDiscount,
  productSavings,
  taxIncluded = true,
  showShippingFree = false,
  shippingSlot,
}: PricingBreakdownProps) {
  const shippingNum = shipping ? parseFloat(shipping) : 0;
  const discountNum = discount ? parseFloat(discount) : 0;
  const surchargeNum = surchargeTotal ? parseFloat(surchargeTotal) : 0;
  const promoNum = promotionDiscount ? parseFloat(promotionDiscount) : 0;
  const savingsNum = productSavings ? parseFloat(productSavings) : 0;

  return (
    <>
      {/* Subtotal */}
      {subtotal && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <div>
            <span class="text-muted-foreground">{t('subtotal', lang)}</span>
            {taxIncluded && tax && (
              <span class="block text-xs text-muted-foreground/70">
                {t('taxIncluded', lang)} {formatPrice(tax, currency, locale)}
              </span>
            )}
          </div>
          <span class="text-card-foreground">{formatPrice(subtotal, currency, locale)}</span>
        </div>
      )}

      {/* Surcharges */}
      {surchargeNum > 0 && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('surcharges', lang)}</span>
          <span class="text-card-foreground">{formatPrice(surchargeTotal!, currency, locale)}</span>
        </div>
      )}

      {/* Shipping slot (e.g. rich ShippingEstimate component) */}
      {shippingSlot}

      {/* Shipping (simple line — used as legacy fallback or by checkout) */}
      {shipping != null && (shippingNum > 0 || showShippingFree) && (
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
            -{formatPrice(discount!, currency, locale)}
          </span>
        </div>
      )}

      {/* Promotion savings */}
      {promoNum > 0 && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('promotion', lang)}</span>
          <span class="font-medium text-destructive">
            -{formatPrice(promotionDiscount!, currency, locale)}
          </span>
        </div>
      )}

      {/* You save (product-level only) */}
      {savingsNum > 0 && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('youSave', lang)}</span>
          <span class="font-medium text-destructive">
            {formatPrice(productSavings!, currency, locale)}
          </span>
        </div>
      )}

      {/* Tax — when included, show as a note under subtotal; when excluded, show as a separate line */}
      {tax && !taxIncluded && (
        <div class="mb-2 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('tax', lang)}</span>
          <span>{formatPrice(tax, currency, locale)}</span>
        </div>
      )}

      {/* Total */}
      <div class="mb-3 flex items-center justify-between border-t border-border pt-2">
        <span class="text-sm font-medium text-card-foreground">{t('orderTotal', lang)}</span>
        <span class="text-lg font-bold text-card-foreground">
          {formatPrice(total, currency, locale)}
        </span>
      </div>
    </>
  );
}
