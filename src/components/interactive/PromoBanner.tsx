import { t } from '@/i18n';
import type { EligiblePromotion } from '@/stores/cart';

interface Props {
  promotions: EligiblePromotion[];
  lang: string;
}

export default function PromoBanner({ promotions, lang }: Props) {
  if (promotions.length === 0) return null;

  const best = promotions.find((p) => p.is_best_deal) ?? promotions[0];

  return (
    <div class="mx-4 mb-2 rounded-md bg-accent/50 px-3 py-2" role="status">
      <p class="text-xs font-medium text-card-foreground">{t('promoEligible', lang)}</p>
      <p class="text-xs text-muted-foreground">{best.name}</p>
    </div>
  );
}
