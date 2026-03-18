import { t } from '@/i18n';
import type { FormAction } from '../CheckoutPage';
import type { CheckoutFormState } from '@/types/checkout';

interface PickupLocationPickerProps {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  locations: Array<{ id: number; name: string; distance_km?: number }>;
  visible: boolean;
}

export function PickupLocationPicker({
  lang,
  form,
  dispatch,
  locations,
  visible,
}: PickupLocationPickerProps) {
  if (!visible) return <></>;

  return (
    <div class="space-y-2">
      <label class="text-sm font-medium">{t('pickupLocation', lang)}</label>
      <select
        class="border border-input rounded-lg px-3 py-2 text-sm w-full bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        value={form.pickupLocationId ?? ''}
        onChange={(e) =>
          dispatch({
            type: 'SET_FIELD',
            field: 'pickupLocationId',
            value: Number((e.target as HTMLSelectElement).value),
          })
        }
      >
        <option value="" disabled>
          {t('selectLocation', lang)}
        </option>
        {locations.map((loc) => (
          <option key={loc.id} value={loc.id}>
            {loc.name}
            {loc.distance_km != null ? ` (${loc.distance_km} km)` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
