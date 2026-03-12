import { useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $addressCoords } from '@/stores/address';
import type { ShippingEstimate as ShippingEstimateType } from '@/stores/cart';
import { formatPrice, langToLocale } from '@/lib/currency';
import { t } from '@/i18n';

interface Props {
  lang: string;
  currency: string;
  shippingEstimate: ShippingEstimateType | null | undefined;
}

function formatShippingCost(cost: string, currency: string, locale: string, lang: string): string {
  return parseFloat(cost) === 0 ? t('shippingFree', lang) : formatPrice(cost, currency, locale);
}

export function ShippingEstimate({ lang, currency, shippingEstimate }: Props) {
  const coords = useStore($addressCoords);
  const locale = langToLocale(lang);
  const [expanded, setExpanded] = useState(false);

  // No address: show prompt to add postcode
  if (!coords) {
    return (
      <div class="mb-1 flex items-center justify-between text-sm">
        <span class="text-muted-foreground">{t('shippingEstimate', lang)}</span>
        <button
          type="button"
          onClick={() => document.dispatchEvent(new CustomEvent('address-bar:expand'))}
          class="text-xs text-primary hover:underline"
        >
          {t('addPostcodeForShipping', lang)}
        </button>
      </div>
    );
  }

  // No estimate data yet
  if (!shippingEstimate) {
    return (
      <div class="mb-1 flex items-center justify-between text-sm">
        <span class="text-muted-foreground">{t('shippingEstimate', lang)}</span>
        <span class="text-muted-foreground">{t('shippingAtCheckout', lang)}</span>
      </div>
    );
  }

  const { groups, total_shipping, ships_in_parts } = shippingEstimate;
  const isExpanded = expanded || ships_in_parts;
  const allPending = groups.every((g) => g.status === 'pending');

  // Single group or all pending: simple one-line display
  if (groups.length <= 1 && !ships_in_parts) {
    const group = groups[0];
    return (
      <div class="mb-1 flex items-center justify-between text-sm">
        <span class="text-muted-foreground">{t('shippingEstimate', lang)}</span>
        <span class="text-card-foreground">
          {!group || group.status === 'pending' || group.estimated_cost === null
            ? t('shippingAtCheckout', lang)
            : group.status === 'unavailable'
              ? t('shippingUnavailable', lang)
              : formatShippingCost(group.estimated_cost, currency, locale, lang)}
        </span>
      </div>
    );
  }

  // Multiple groups: collapsible breakdown
  return (
    <div class="mb-1 text-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        class="flex w-full items-center justify-between"
        aria-expanded={isExpanded}
      >
        <span class="text-muted-foreground">{t('shippingEstimate', lang)}</span>
        <span class="flex items-center gap-1 text-card-foreground">
          {allPending || total_shipping == null
            ? t('shippingAtCheckout', lang)
            : formatShippingCost(total_shipping, currency, locale, lang)}
          {!ships_in_parts && (
            <svg
              class={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          )}
        </span>
      </button>
      {isExpanded && (
        <div class="mt-1 space-y-0.5 pl-2 border-l-2 border-border">
          {groups.map((group, i) => (
            <div
              key={`${group.provider_name}-${group.fulfillment_type}-${i}`}
              class="flex items-center justify-between text-xs text-muted-foreground"
            >
              <span>{group.provider_name}</span>
              <span>
                {group.status === 'pending' || group.estimated_cost === null
                  ? t('shippingAtCheckout', lang)
                  : group.status === 'unavailable'
                    ? t('shippingUnavailable', lang)
                    : formatShippingCost(group.estimated_cost, currency, locale, lang)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
