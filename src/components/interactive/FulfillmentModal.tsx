import { useEffect, useState, useRef, useCallback } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $showFulfillmentModal, setFulfillmentChoice, initFulfillment } from '@/stores/fulfillment';
import { onAddressChange } from '@/stores/address-actions';
import { $merchant } from '@/stores/merchant';
import { t } from '@/i18n/client';
import { useFocusTrap } from '@/hooks/use-focus-trap';
import { withErrorBoundary } from './ErrorBoundary';

interface Props {
  lang: string;
}

type Step = 'choose' | 'delivery-postcode';

const LANG_TO_COUNTRY: Record<string, string> = {
  nl: 'NL',
  de: 'DE',
  en: 'NL',
};

function FulfillmentModal({ lang }: Props) {
  const show = useStore($showFulfillmentModal);
  const merchant = useStore($merchant);
  const [step, setStep] = useState<Step>('choose');
  const [postcode, setPostcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setVisible(false);
    setTimeout(() => {
      $showFulfillmentModal.set(false);
      setStep('choose');
      setPostcode('');
      setError(null);
    }, 200);
  }, []);

  useFocusTrap(dialogRef, show, close);

  // Initialize on mount
  useEffect(() => {
    initFulfillment();
  }, []);

  // Animate in
  useEffect(() => {
    if (show) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [show]);

  // Focus input when showing postcode step
  useEffect(() => {
    if (step === 'delivery-postcode' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [step]);

  if (!show) return <div data-fulfillment-modal />;

  const country = LANG_TO_COUNTRY[lang] ?? 'NL';

  const handleDeliverySelect = () => {
    setStep('delivery-postcode');
  };

  const handlePickupSelect = () => {
    setFulfillmentChoice('pickup');
    close();
  };

  const handlePostcodeSubmit = async (e: Event) => {
    e.preventDefault();
    const trimmed = postcode.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    const result = await onAddressChange({ postalCode: trimmed, country });

    setLoading(false);

    if (!result.success) {
      setError(
        result.error === 'network' ? t('connectionProblem', lang) : t('postcodeNotFound', lang),
      );
      return;
    }

    setFulfillmentChoice('delivery');
    close();
  };

  return (
    <div data-fulfillment-modal>
      {/* Backdrop */}
      <div
        class={`fixed inset-0 z-50 flex items-end justify-center sm:items-center transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- backdrop dismiss, keyboard handled by useFocusTrap onEscape */}
        <div class="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={close} />

        {/* Modal card */}
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('fulfillmentMethod', lang)}
          class={`relative z-10 w-full max-w-md overflow-hidden rounded-t-2xl bg-card shadow-2xl transition-transform duration-200 sm:rounded-2xl ${
            visible ? 'translate-y-0' : 'translate-y-8'
          }`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {/* Header */}
          <div class="px-6 pt-6 pb-2">
            {merchant?.logo && (
              <div class="mx-auto mb-4 h-14 w-14 overflow-hidden rounded-xl">
                <img
                  src={merchant.logo}
                  alt=""
                  class="h-full w-full object-contain"
                  width="56"
                  height="56"
                />
              </div>
            )}
            <h2 class="text-center text-lg font-semibold text-foreground">
              {t('fulfillmentMethod', lang)}
            </h2>
          </div>

          {/* Step: Choose delivery or pickup */}
          {step === 'choose' && (
            <div class="space-y-3 px-6 pb-6 pt-4">
              <button
                type="button"
                onClick={handleDeliverySelect}
                class="group flex w-full items-center gap-4 rounded-xl border border-border bg-background p-4 text-left transition-all hover:border-primary/30 hover:shadow-sm active:scale-[0.98]"
              >
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" />
                    <path d="m3 9 2.45-4.9A2 2 0 0 1 7.24 3h9.52a2 2 0 0 1 1.8 1.1L21 9" />
                    <path d="M12 3v6" />
                  </svg>
                </div>
                <div class="flex-1">
                  <span class="block text-base font-medium text-foreground">
                    {t('delivery', lang)}
                  </span>
                  <span class="block text-sm text-muted-foreground">
                    {t('deliveryDescription', lang)}
                  </span>
                </div>
                <svg
                  class="h-5 w-5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>

              <button
                type="button"
                onClick={handlePickupSelect}
                class="group flex w-full items-center gap-4 rounded-xl border border-border bg-background p-4 text-left transition-all hover:border-primary/30 hover:shadow-sm active:scale-[0.98]"
              >
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
                    <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
                    <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
                    <path d="M10 6h4" />
                    <path d="M10 10h4" />
                    <path d="M10 14h4" />
                    <path d="M10 18h4" />
                  </svg>
                </div>
                <div class="flex-1">
                  <span class="block text-base font-medium text-foreground">
                    {t('pickup', lang)}
                  </span>
                  <span class="block text-sm text-muted-foreground">
                    {t('pickupDescription', lang)}
                  </span>
                </div>
                <svg
                  class="h-5 w-5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          )}

          {/* Step: Delivery postcode */}
          {step === 'delivery-postcode' && (
            <div class="px-6 pb-6 pt-4">
              <button
                type="button"
                onClick={() => {
                  setStep('choose');
                  setError(null);
                }}
                class="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="m15 18-6-6 6-6" />
                </svg>
                {t('delivery', lang)}
              </button>

              <form onSubmit={handlePostcodeSubmit} class="space-y-4">
                <div>
                  <label
                    class="mb-1.5 block text-sm font-medium text-foreground"
                    htmlFor="fulfillment-postcode"
                  >
                    {t('enterPostcode', lang)}
                  </label>
                  <input
                    ref={inputRef}
                    id="fulfillment-postcode"
                    type="text"
                    value={postcode}
                    onInput={(e) => setPostcode((e.target as HTMLInputElement).value)}
                    placeholder="1012 AB"
                    autoComplete="postal-code"
                    maxLength={10}
                    class="w-full rounded-xl border border-input bg-background px-4 py-3 text-base text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    disabled={loading}
                  />
                  {error && <p class="mt-2 text-sm text-destructive">{error}</p>}
                </div>

                <button
                  type="submit"
                  disabled={loading || !postcode.trim()}
                  class="flex w-full items-center justify-center rounded-xl bg-primary px-4 py-3 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {loading ? (
                    <div class="h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                  ) : (
                    t('checkAddress', lang)
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default withErrorBoundary(FulfillmentModal, 'FulfillmentModal');
