import { useStore } from '@nanostores/preact';
import { $addressCoords, $addressEligibility } from '@/stores/address';
import { t } from '@/i18n';

interface Props {
  lang: string;
}

export function DeliveryBanner({ lang }: Props) {
  const coords = useStore($addressCoords);
  const eligibility = useStore($addressEligibility);

  if (!coords || !eligibility) return null;

  const dispatchExpand = () => {
    window.dispatchEvent(new CustomEvent('address-bar:expand'));
  };

  // Delivery unavailable
  if (eligibility.deliveryUnavailable) {
    const message = eligibility.nearDeliveryZone
      ? t('nearDeliveryZone', lang)
      : t('deliveryUnavailable', lang);

    const pickup = eligibility.nearestPickupLocation;
    const pickupMessage = pickup
      ? t('pickupAvailableAt', lang, {
          name: pickup.name,
          distance: pickup.distance_km,
        })
      : null;

    return (
      <div
        class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
        role="status"
      >
        <p>{message}</p>
        {pickupMessage && <p class="mt-0.5 opacity-80">{pickupMessage}</p>}
        <button type="button" class="mt-1 text-xs underline" onClick={dispatchExpand}>
          {t('changeAddress', lang)}
        </button>
      </div>
    );
  }

  // Delivery available
  const deliveringMessage = t('deliveringTo', lang, {
    postalCode: coords.postalCode,
  });

  return (
    <div
      class="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
      role="status"
    >
      <p>{deliveringMessage}</p>
      <button type="button" class="mt-1 text-xs underline" onClick={dispatchExpand}>
        {t('changeAddress', lang)}
      </button>
    </div>
  );
}
