import { t } from '@/i18n';
import type { FormAction } from '../CheckoutPage';
import type { CheckoutFormState } from '@/types/checkout';

interface FulfillmentToggleProps {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  availableMethods: ('delivery' | 'pickup')[];
  deliveryEligible: boolean | null;
}

export default function FulfillmentToggle({
  lang,
  form,
  dispatch,
  availableMethods,
  deliveryEligible,
}: FulfillmentToggleProps) {
  if (availableMethods.length <= 1) {
    return null;
  }

  return (
    <fieldset>
      <legend class="text-sm font-medium mb-2">{t('fulfillmentMethod', lang)}</legend>
      <div role="radiogroup" class="inline-flex gap-2">
        {availableMethods.map((method) => {
          const selected = form.fulfillmentMethod === method;
          const disabled = method === 'delivery' && deliveryEligible === false;
          return (
            <label
              key={method}
              class={`flex items-center justify-center min-h-[44px] px-6 rounded-md cursor-pointer text-sm font-medium transition-colors select-none ${
                selected ? 'bg-primary text-primary-foreground' : 'bg-card border border-input'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <input
                type="radio"
                name="fulfillmentMethod"
                value={method}
                checked={selected}
                disabled={disabled}
                class="sr-only"
                onChange={() => dispatch({ type: 'SET_FULFILLMENT', method })}
              />
              {t(method, lang)}
            </label>
          );
        })}
      </div>
      {deliveryEligible === false && (
        <p class="text-sm text-destructive mt-2">{t('deliveryUnavailable', lang)}</p>
      )}
      {deliveryEligible === null && (
        <p class="text-sm text-muted-foreground mt-2">{t('confirmDeliveryAvailability', lang)}</p>
      )}
    </fieldset>
  );
}
