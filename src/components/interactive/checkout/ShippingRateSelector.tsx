import { t } from '@/i18n/client';
import { formatPrice, langToLocale } from '@/lib/currency';
import type { ShippingGroup, ShippingRate } from '@/types/checkout';

interface Props {
  lang: 'nl' | 'en' | 'de';
  currency: string;
  groups: ShippingGroup[];
  selectedRateId: string | null;
  onRateSelect: (groupId: string, rateId: string) => void;
  loading: boolean;
}

function expiryMinutes(expiresAt: string): number {
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.floor(diff / 60_000));
}

function RateOption({
  rate,
  groupId,
  selected,
  currency,
  locale,
  lang,
  onSelect,
}: {
  rate: ShippingRate;
  groupId: string;
  selected: boolean;
  currency: string;
  locale: string;
  lang: 'nl' | 'en' | 'de';
  onSelect: (groupId: string, rateId: string) => void;
}) {
  const isDynamic = rate.expires_at != null;
  const minutes = isDynamic ? expiryMinutes(rate.expires_at!) : null;

  return (
    <button
      type="button"
      data-rate-id={rate.id}
      onClick={() => onSelect(groupId, rate.id)}
      class={`w-full flex items-center justify-between rounded-lg border p-3 text-left transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50'
      }`}
    >
      <div>
        <span class="text-sm font-medium text-card-foreground">{rate.name}</span>
        {isDynamic && minutes != null && minutes > 0 && (
          <span class="block text-xs text-muted-foreground mt-0.5">
            {t('shippingRateExpiresSoon', lang, { minutes: String(minutes) })}
          </span>
        )}
      </div>
      <span class="text-sm font-medium text-card-foreground">
        {parseFloat(rate.cost) === 0
          ? t('shippingFree', lang)
          : formatPrice(rate.cost, currency, locale)}
      </span>
    </button>
  );
}

export function ShippingRateSelector({
  lang,
  currency,
  groups,
  selectedRateId,
  onRateSelect,
  loading,
}: Props) {
  if (loading) {
    return (
      <div class="text-sm text-muted-foreground py-2">{t('shippingRateRefreshing', lang)}</div>
    );
  }

  // Collect all rates across groups (most checkouts have one group)
  const allRates: Array<{ rate: ShippingRate; groupId: string }> = [];
  for (const group of groups) {
    for (const rate of group.available_rates) {
      allRates.push({ rate, groupId: group.id });
    }
  }

  // Don't show picker if there's 0 or 1 rate — nothing to choose
  if (allRates.length <= 1) return null;

  const locale = langToLocale(lang);

  return (
    <div>
      <h3 class="text-sm font-medium text-card-foreground mb-2">{t('shippingMethod', lang)}</h3>
      <div class="space-y-2">
        {allRates.map(({ rate, groupId }) => (
          <RateOption
            key={rate.id}
            rate={rate}
            groupId={groupId}
            selected={selectedRateId === rate.id}
            currency={currency}
            locale={locale}
            lang={lang}
            onSelect={onRateSelect}
          />
        ))}
      </div>
    </div>
  );
}
