import { t } from '@/i18n/client';
import type { Cart, EligiblePromotion } from '@/stores/cart';

interface Props {
  promotion?: Cart['promotion'];
  eligiblePromotions: EligiblePromotion[];
  lang: string;
}

export default function PromoBanner({ promotion, eligiblePromotions, lang }: Props) {
  // Applied promotion from the cart response takes priority
  if (promotion) {
    return (
      <div class="mx-4 mb-2 rounded-md bg-accent/50 px-3 py-2" role="status">
        <p class="text-xs font-medium text-card-foreground">{t('promoApplied', lang)}</p>
        <p class="text-xs text-muted-foreground">{promotion.name}</p>
      </div>
    );
  }

  // Fallback: eligible promotions from the separate eligibility check
  if (eligiblePromotions.length === 0) return null;

  const best = eligiblePromotions.find((p) => p.is_best_deal) ?? eligiblePromotions[0];

  return (
    <div class="mx-4 mb-2 rounded-md bg-accent/50 px-3 py-2" role="status">
      <p class="text-xs font-medium text-card-foreground">{t('promoEligible', lang)}</p>
      <p class="text-xs text-muted-foreground">{best.name}</p>
    </div>
  );
}
