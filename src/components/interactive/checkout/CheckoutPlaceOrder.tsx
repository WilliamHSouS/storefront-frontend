import { useCallback, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $cartTotal } from '@/stores/cart';
import { $checkout, $checkoutLoading, $checkoutError, persistFormState } from '@/stores/checkout';
import { completeCheckout, ensurePaymentAndComplete } from '@/stores/checkout-actions';
import { $stripePayment } from '@/stores/checkout-payment';
import { formatPrice, langToLocale } from '@/lib/currency';
import { t } from '@/i18n';
import * as log from '@/lib/logger';
import type { CheckoutFormState } from '@/types/checkout';
import { PlaceOrderButton } from './PlaceOrderButton';

interface CheckoutPlaceOrderProps {
  lang: 'nl' | 'en' | 'de';
  currency: string;
  form: CheckoutFormState;
  setFormErrors: (errors: Record<string, string>) => void;
}

const shakeStyles = `
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-4px); }
  75% { transform: translateX(4px); }
}
.animate-shake { animation: shake 0.3s ease-in-out; }
`;

function shakeButton() {
  const btn = document.querySelector('[data-place-order]');
  if (btn) {
    btn.classList.add('animate-shake');
    setTimeout(() => btn.classList.remove('animate-shake'), 300);
  }
}

export default function CheckoutPlaceOrder({
  lang,
  currency,
  form,
  setFormErrors,
}: CheckoutPlaceOrderProps) {
  const checkout = useStore($checkout);
  const loading = useStore($checkoutLoading);
  const cartTotal = useStore($cartTotal);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const locale = langToLocale(lang);

  // ── Form validation ─────────────────────────────────────────────
  function validateForm(): boolean {
    const errors: Record<string, string> = {};

    if (!form.email) {
      errors.email = t('fieldRequired', lang, { field: t('email', lang) });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = t('emailInvalid', lang);
    }
    if (!form.phone) {
      errors.phone = t('fieldRequired', lang, { field: t('phone', lang) });
    }
    if (!form.firstName) {
      errors.firstName = t('fieldRequired', lang, { field: t('firstName', lang) });
    }
    if (!form.lastName) {
      errors.lastName = t('fieldRequired', lang, { field: t('lastName', lang) });
    }
    if (form.fulfillmentMethod === 'delivery') {
      if (!form.street) errors.street = t('fieldRequired', lang, { field: t('street', lang) });
      if (!form.city) errors.city = t('fieldRequired', lang, { field: t('city', lang) });
      if (!form.postalCode)
        errors.postalCode = t('fieldRequired', lang, { field: t('postalCode', lang) });
    }

    setFormErrors(errors);

    if (Object.keys(errors).length > 0) {
      // Scroll to first error
      const firstErrorField = document.querySelector('[role="alert"]');
      firstErrorField?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  }

  // ── Place order handler ─────────────────────────────────────────
  // PaymentIntent is already created (when Payment Element mounted).
  // Flow: validate → confirm with Stripe → complete checkout
  const handlePlaceOrder = useCallback(async () => {
    if (isSubmitting) return;
    if (!validateForm()) {
      const errorEl = document.querySelector('[role="alert"]');
      errorEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      shakeButton();
      return;
    }
    if (!checkout) return;

    setIsSubmitting(true);
    persistFormState(form);

    try {
      // If Stripe Payment Element is mounted, confirm the existing PaymentIntent
      const payment = $stripePayment.get();
      if (payment) {
        const { error } = await payment.stripe.confirmPayment({
          elements: payment.elements,
          confirmParams: {
            return_url: `${window.location.origin}/${lang}/checkout/success?checkout_id=${checkout.id}`,
          },
          redirect: 'if_required',
        });

        if (error) {
          $checkoutError.set(error.message ?? t('paymentDeclined', lang));
          const errorEl = document.querySelector('[role="alert"]');
          errorEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          shakeButton();
          return;
        }

        // Card/wallet payment succeeded inline — complete checkout
        const result = await ensurePaymentAndComplete(
          checkout.id,
          payment.clientSecret,
          payment.stripe as unknown as Parameters<typeof ensurePaymentAndComplete>[2],
          lang,
        );

        if (result.status === 'succeeded' && result.redirectUrl) {
          window.location.href = result.redirectUrl;
        }
      } else {
        // Stripe not loaded — complete via backend (webhook will handle)
        const completed = await completeCheckout(checkout.id);
        window.location.href = `/${lang}/checkout/success?order=${completed.order_number ?? ''}`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      $checkoutError.set(msg);
      log.error('checkout', 'Place order error:', msg);
      const errorEl = document.querySelector('[role="alert"]');
      errorEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      shakeButton();
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, form, checkout, lang]);

  return (
    <>
      <style>{shakeStyles}</style>
      {/* Desktop place order button */}
      <div class="hidden md:block px-4 py-6">
        <button
          type="button"
          data-place-order
          onClick={handlePlaceOrder}
          disabled={loading || isSubmitting}
          class={`flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 ${loading || isSubmitting ? 'pointer-events-none opacity-50' : ''}`}
        >
          {loading ? (
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
              {t('placeOrder', lang)} — {formatPrice(cartTotal, currency, locale)}
            </>
          )}
        </button>
      </div>

      {/* Bottom spacer for mobile sticky CTA */}
      <div class="h-24 md:hidden" />

      {/* Mobile sticky CTA */}
      <div data-place-order>
        <PlaceOrderButton
          lang={lang}
          currency={currency}
          onPlace={handlePlaceOrder}
          disabled={isSubmitting}
        />
      </div>
    </>
  );
}
