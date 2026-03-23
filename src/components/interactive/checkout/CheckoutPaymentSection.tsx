import { useEffect, useRef, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { useStore } from '@nanostores/preact';
import { $checkout, $checkoutError } from '@/stores/checkout';
import { initiatePayment } from '@/stores/checkout-actions';
import { $stripePayment } from '@/stores/checkout-payment';
import { toCents } from '@/lib/currency';
import { t } from '@/i18n';
import { loadStripe } from '@stripe/stripe-js';
import * as log from '@/lib/logger';
import type { Stripe, StripeElements } from '@stripe/stripe-js';
import type { CheckoutFormState } from '@/types/checkout';
import { FormDivider } from './FormDivider';
import ExpressCheckout from './ExpressCheckout';

const StripePaymentForm = lazy(() =>
  import('./StripePaymentForm').then((m) => ({ default: m.StripePaymentForm })),
);

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface CheckoutPaymentSectionProps {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  currency: string;
  cartId: string;
  cartTotal: string;
  merchantName: string;
  merchantTheme?: { primary?: string; background?: string; foreground?: string; radius?: string };
  onError?: (msg: string) => void;
}

/* ------------------------------------------------------------------ */
/*  CheckoutPaymentSection                                             */
/* ------------------------------------------------------------------ */

export default function CheckoutPaymentSection({
  lang,
  form,
  currency,
  cartId,
  cartTotal,
  merchantName,
  merchantTheme,
  onError,
}: CheckoutPaymentSectionProps) {
  const checkout = useStore($checkout);

  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const mountedRef = useRef(false);

  const [expressAvailable, setExpressAvailable] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [stripeConfig, setStripeConfig] = useState<{
    clientSecret: string;
    publishableKey: string;
    stripeAccount: string;
  } | null>(null);

  // ── Strict-mode guard ────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── Clean up $stripePayment atom on unmount ──────────────────────
  useEffect(() => {
    return () => {
      $stripePayment.set(null);
    };
  }, []);

  // ── Preload Stripe.js as soon as gateway config is available ─────
  // This fires even before delivery_set — just caches the Stripe.js bundle.
  useEffect(() => {
    if (!checkout?.available_payment_gateways) return;
    const stripeGateway = checkout.available_payment_gateways.find((g) => g.id === 'stripe');
    if (!stripeGateway) return;
    const pk = stripeGateway.config.publishable_key ?? '';
    const acct = stripeGateway.config.stripe_account ?? '';
    if (pk) {
      loadStripe(pk, { stripeAccount: acct }); // Preload — result cached by Stripe.js
    }
  }, [checkout?.available_payment_gateways]);

  // ── Initiate payment when gateway config is available ────────────
  // Gateway config comes from the checkout response (after delivery_set).
  // We only need to initiate payment to get a client_secret for the Stripe Element.
  useEffect(() => {
    if (!mountedRef.current) return;
    if (!checkout?.id) return;
    if (stripeConfig) return;

    const gateways = checkout.available_payment_gateways;
    if (!gateways) return;

    const stripeGateway = gateways.find((g) => g.id === 'stripe');
    if (!stripeGateway) return;

    const pk = stripeGateway.config.publishable_key ?? '';
    const acct = stripeGateway.config.stripe_account ?? '';
    if (!pk) return;

    initiatePayment(checkout.id)
      .then((paymentResult) => {
        if (!mountedRef.current) return;
        if (paymentResult?.client_secret) {
          setStripeConfig({
            clientSecret: paymentResult.client_secret,
            publishableKey: pk,
            stripeAccount: acct,
          });
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        $checkoutError.set(`Payment initialization failed: ${msg}`);
        log.error('checkout', 'Failed to initiate payment:', err);
        if (mountedRef.current) {
          setPaymentError(t('paymentRetry', lang));
          onError?.(`Payment initialization failed: ${msg}`);
        }
      });
  }, [checkout?.id, checkout?.available_payment_gateways, stripeConfig]);

  // ── Retry: clear error + stripeConfig so the initiation effect re-runs ──
  const retryPayment = () => {
    setPaymentError(null);
    setStripeConfig(null);
  };

  return (
    <>
      {/* Express checkout (Apple Pay / Google Pay) — only when Stripe is configured */}
      {stripeConfig?.publishableKey && (
        <ExpressCheckout
          lang={lang}
          publishableKey={stripeConfig.publishableKey}
          stripeAccount={stripeConfig.stripeAccount}
          merchantName={merchantName}
          currency={currency}
          totalInCents={toCents(cartTotal)}
          cartId={cartId}
          onSuccess={(orderNumber) => {
            window.location.href = `/${lang}/checkout/success?order=${orderNumber}`;
          }}
          onError={(msg) => {
            log.error('checkout', 'Express checkout error:', msg);
            onError?.(msg);
          }}
          onAvailable={setExpressAvailable}
        />
      )}

      <FormDivider lang={lang} visible={expressAvailable} />

      {/* Payment init / Stripe load error with retry */}
      {paymentError && (
        <div class="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive flex items-center justify-between">
          <span>{paymentError}</span>
          <button
            type="button"
            onClick={retryPayment}
            class="ml-3 text-xs font-medium underline hover:no-underline"
          >
            {t('retry', lang)}
          </button>
        </div>
      )}

      {/* Stripe Payment Element */}
      {!paymentError && stripeConfig?.clientSecret && (
        <div class="px-4 py-4">
          <h2 class="text-base font-semibold mb-3">{t('payment', lang)}</h2>
          <Suspense fallback={<div class="animate-pulse rounded-lg bg-muted h-[200px]" />}>
            <StripePaymentForm
              clientSecret={stripeConfig.clientSecret}
              publishableKey={stripeConfig.publishableKey}
              stripeAccount={stripeConfig.stripeAccount}
              billingName={`${form.firstName} ${form.lastName}`.trim()}
              merchantTheme={merchantTheme}
              onStripeReady={(stripe, elements) => {
                stripeRef.current = stripe;
                elementsRef.current = elements;
                $stripePayment.set({
                  stripe,
                  elements,
                  clientSecret: stripeConfig.clientSecret,
                });
              }}
              onError={(msg) => {
                log.error('checkout', 'Stripe payment form error:', msg);
                setPaymentError(t('paymentRetry', lang));
                onError?.(msg);
              }}
            />
          </Suspense>
        </div>
      )}
    </>
  );
}
