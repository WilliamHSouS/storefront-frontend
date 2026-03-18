import { useState } from 'preact/hooks';
import { t } from '@/i18n';
import type { FormAction } from '../CheckoutPage';
import type { CheckoutFormState } from '@/types/checkout';

interface PickupLocation {
  id: number;
  name: string;
  distance_km?: number;
  address?: { street?: string; city?: string; postal_code?: string };
  pickup_instructions?: string;
}

interface PickupLocationPickerProps {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  locations: PickupLocation[];
  visible: boolean;
}

export function PickupLocationPicker({
  lang,
  form,
  dispatch,
  locations,
  visible,
}: PickupLocationPickerProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (!visible) return <></>;

  const selectedLocation = locations.find((l) => l.id === form.pickupLocationId);
  const hasDetails =
    selectedLocation && (selectedLocation.address?.street || selectedLocation.pickup_instructions);

  return (
    <div class="space-y-2">
      <label class="text-sm font-medium">{t('pickupLocation', lang)}</label>
      <select
        class="border border-input rounded-lg px-3 py-2 text-sm w-full bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        value={form.pickupLocationId ?? ''}
        onChange={(e) => {
          dispatch({
            type: 'SET_FIELD',
            field: 'pickupLocationId',
            value: Number((e.target as HTMLSelectElement).value),
          });
          setShowDetails(false);
        }}
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

      {/* Details toggle + expandable info */}
      {hasDetails && (
        <div>
          <button
            type="button"
            class="text-sm text-primary underline hover:text-primary/80 transition-colors py-1"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? t('close', lang) : t('viewDetails', lang)}
          </button>

          {showDetails && (
            <div class="mt-2 rounded-lg border border-border bg-card p-3 text-sm space-y-1">
              {selectedLocation.address?.street &&
                (() => {
                  const addr = [
                    selectedLocation.address!.street,
                    selectedLocation.address!.city,
                    selectedLocation.address!.postal_code,
                  ]
                    .filter(Boolean)
                    .join(', ');
                  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(addr)}`;
                  return (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="flex items-start gap-1.5 text-primary hover:text-primary/80 transition-colors"
                    >
                      <svg
                        class="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width={2}
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                        />
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      <span class="underline">{addr}</span>
                    </a>
                  );
                })()}
              {selectedLocation.pickup_instructions && (
                <p class="text-muted-foreground">
                  <svg
                    class="inline-block w-3.5 h-3.5 mr-1 -mt-0.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width={2}
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  {selectedLocation.pickup_instructions}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
