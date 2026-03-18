import { t } from '@/i18n';
import type { CheckoutFormState } from '@/types/checkout';
import type { FormAction } from '../CheckoutPage';

interface DeliveryAddressFormProps {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  onBlur: () => void;
  errors: Record<string, string>;
  visible: boolean;
}

const inputClass =
  'border border-input rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-ring';

export default function DeliveryAddressForm({
  lang,
  form,
  dispatch,
  onBlur,
  errors,
  visible,
}: DeliveryAddressFormProps) {
  if (!visible) return <></>;

  return (
    <fieldset class="space-y-4">
      <legend class="text-base font-semibold">{t('deliveryAddress', lang)}</legend>

      {/* Street and number */}
      <div>
        <label for="checkout-street" class="block text-sm font-medium mb-1">
          {t('street', lang)}
        </label>
        <input
          id="checkout-street"
          type="text"
          required
          autocomplete="street-address"
          class={inputClass}
          value={form.street}
          onInput={(e) =>
            dispatch({
              type: 'SET_FIELD',
              field: 'street',
              value: (e.target as HTMLInputElement).value,
            })
          }
          onBlur={onBlur}
        />
        {errors.street && (
          <p role="alert" class="text-sm text-destructive mt-1">
            {errors.street}
          </p>
        )}
      </div>

      {/* City */}
      <div>
        <label for="checkout-city" class="block text-sm font-medium mb-1">
          {t('city', lang)}
        </label>
        <input
          id="checkout-city"
          type="text"
          required
          autocomplete="address-level2"
          class={inputClass}
          value={form.city}
          onInput={(e) =>
            dispatch({
              type: 'SET_FIELD',
              field: 'city',
              value: (e.target as HTMLInputElement).value,
            })
          }
          onBlur={onBlur}
        />
        {errors.city && (
          <p role="alert" class="text-sm text-destructive mt-1">
            {errors.city}
          </p>
        )}
      </div>

      {/* Postal code */}
      <div>
        <label for="checkout-postalCode" class="block text-sm font-medium mb-1">
          {t('postalCode', lang)}
        </label>
        <input
          id="checkout-postalCode"
          type="text"
          inputMode="numeric"
          required
          autocomplete="postal-code"
          class={inputClass}
          value={form.postalCode}
          onInput={(e) =>
            dispatch({
              type: 'SET_FIELD',
              field: 'postalCode',
              value: (e.target as HTMLInputElement).value,
            })
          }
          onBlur={onBlur}
        />
        {errors.postalCode && (
          <p role="alert" class="text-sm text-destructive mt-1">
            {errors.postalCode}
          </p>
        )}
      </div>
    </fieldset>
  );
}
