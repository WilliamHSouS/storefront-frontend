import { t } from '@/i18n';
import type { CheckoutFormState } from '@/types/checkout';
import type { FormAction } from '../CheckoutPage';

interface ContactFormProps {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  onBlur: () => void;
  errors: Record<string, string>;
}

const inputClass =
  'border border-input rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-ring';

const fields = [
  { key: 'email', type: 'email' },
  { key: 'phone', type: 'tel' },
  { key: 'firstName', type: 'text' },
  { key: 'lastName', type: 'text' },
] as const;

export function ContactForm({ lang, form, dispatch, onBlur, errors }: ContactFormProps) {
  return (
    <fieldset>
      <legend class="text-lg font-semibold mb-4">{t('contactInfo', lang)}</legend>
      <div class="grid gap-4 sm:grid-cols-2">
        {fields.map(({ key, type }) => (
          <label key={key} class="block">
            <span class="text-sm font-medium mb-1 block">{t(key, lang)}</span>
            <input
              type={type}
              name={key}
              value={form[key]}
              class={inputClass}
              onInput={(e) =>
                dispatch({ type: 'SET_FIELD', field: key, value: e.currentTarget.value })
              }
              onBlur={onBlur}
            />
            {errors[key] && (
              <p role="alert" class="text-sm text-destructive mt-1">
                {errors[key]}
              </p>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
