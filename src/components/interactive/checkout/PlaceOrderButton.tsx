import { useEffect, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $checkoutLoading, $checkoutTotals } from '@/stores/checkout';
import { formatPrice, langToLocale } from '@/lib/currency';
import { t } from '@/i18n/client';

interface Props {
  lang: 'nl' | 'en' | 'de';
  currency: string;
  onPlace: () => void;
  disabled?: boolean;
}

export function PlaceOrderButton({ lang, currency, onPlace, disabled: externalDisabled }: Props) {
  const loading = useStore($checkoutLoading);
  const isDisabled = loading || externalDisabled;
  const totals = useStore($checkoutTotals);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const locale = langToLocale(lang);

  // Hide when virtual keyboard is open (mobile)
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLInputElement | null;
      if (!target) return;
      // Only hide for inputs that open the virtual keyboard
      const isTextInput =
        target.tagName === 'TEXTAREA' ||
        (target.tagName === 'INPUT' &&
          !['radio', 'checkbox', 'button', 'submit', 'reset', 'range'].includes(target.type));
      if (isTextInput) {
        setKeyboardOpen(true);
      }
    };
    const onFocusOut = () => {
      setKeyboardOpen(false);
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  if (keyboardOpen) return <div class="md:hidden" />;

  return (
    <div
      class="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-card border-t border-border px-4 py-3"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      <button
        type="button"
        onClick={onPlace}
        disabled={isDisabled}
        class={`flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 ${isDisabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        {isDisabled ? (
          <>
            <svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            {t('processing', lang)}
          </>
        ) : (
          <>
            {t('placeOrder', lang)} — {formatPrice(totals.total, currency, locale)}
          </>
        )}
      </button>
    </div>
  );
}
