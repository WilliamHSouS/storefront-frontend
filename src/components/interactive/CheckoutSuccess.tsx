import { useEffect, useState } from 'preact/hooks';
import { t } from '@/i18n/client';
import { getClient } from '@/lib/api';
import { clearCart } from '@/stores/cart';
import { clearStoredCheckoutId } from '@/stores/checkout';
import * as log from '@/lib/logger';

interface Props {
  lang: 'nl' | 'en' | 'de';
}

interface ConfirmPaymentError {
  error_code: string;
  message: string;
  details?: { psp_status?: string };
}

export default function CheckoutSuccess({ lang }: Props) {
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fallback, setFallback] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawOrder = params.get('order');
    const order = rawOrder && /^[a-zA-Z0-9_-]{1,50}$/.test(rawOrder) ? rawOrder : null;
    const checkoutId = params.get('checkout_id');
    const paymentIntent = params.get('payment_intent');
    const clientSecret = params.get('payment_intent_client_secret');

    // Clean sensitive params from URL immediately
    if (paymentIntent) {
      const cleanUrl = order
        ? `/${lang}/checkout/success?order=${order}`
        : `/${lang}/checkout/success`;
      history.replaceState({}, '', cleanUrl);
    }

    if (order && !paymentIntent) {
      // Direct redirect from inline payment — order already completed
      clearCart();
      clearStoredCheckoutId();
      setOrderNumber(order);
      setLoading(false);
    } else if (checkoutId && paymentIntent && clientSecret) {
      // Bank redirect return — confirm payment synchronously
      confirmPayment(checkoutId, paymentIntent, clientSecret);
    } else {
      // No valid params — redirect to menu
      window.location.href = `/${lang}/`;
    }
  }, [lang]);

  async function confirmPayment(
    checkoutId: string,
    paymentIntent: string,
    clientSecret: string,
    isRetry = false,
  ) {
    try {
      const sdk = getClient();
      const confirmUrl = `/api/v1/checkout/${checkoutId}/confirm-payment/`;

      /* eslint-disable @typescript-eslint/no-explicit-any -- confirm-payment endpoint not yet in SDK types; remove after SDK regeneration */
      const { data, error } = await sdk.POST(
        confirmUrl as any,
        {
          body: {
            gateway_id: 'stripe',
            payment_intent: paymentIntent,
            payment_intent_client_secret: clientSecret,
          },
        } as any,
      );
      /* eslint-enable @typescript-eslint/no-explicit-any -- end confirm-payment SDK workaround */

      if (error) {
        const err = error as unknown as ConfirmPaymentError;
        switch (err.error_code) {
          case 'PAYMENT_NOT_CONFIRMED':
            if (err.details?.psp_status === 'requires_action') {
              // 3DS incomplete — re-trigger via Stripe SDK
              // For now, show fallback since we don't have Stripe instance here
              log.warn('checkout-success', '3DS required but Stripe not available on success page');
              showFallback();
            } else {
              // Card declined
              setErrorMessage(err.message || t('paymentDeclined', lang));
              setLoading(false);
            }
            break;
          case 'GATEWAY_UNAVAILABLE':
            if (!isRetry) {
              // Auto-retry once
              log.warn('checkout-success', 'Gateway unavailable, retrying...');
              await confirmPayment(checkoutId, paymentIntent, clientSecret, true);
            } else {
              showFallback();
            }
            break;
          default:
            setErrorMessage(err.message || t('paymentDeclined', lang));
            setLoading(false);
        }
        return;
      }

      // Success
      const checkout = data as { order_number?: string; status?: string } | null;
      clearCart();
      clearStoredCheckoutId();
      setOrderNumber(checkout?.order_number ?? null);
      setLoading(false);
    } catch (err) {
      // Network error — same as 502
      log.error('checkout-success', 'confirm-payment network error:', err);
      if (!isRetry) {
        await confirmPayment(checkoutId, paymentIntent, clientSecret, true);
      } else {
        showFallback();
      }
    }
  }

  function showFallback() {
    clearCart();
    clearStoredCheckoutId();
    setFallback(true);
    setLoading(false);
  }

  if (loading) {
    return (
      <div class="flex items-center justify-center min-h-[60vh]">
        <p class="text-muted-foreground">{t('confirmingOrder', lang)}</p>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div class="max-w-lg mx-auto px-4 py-12 text-center">
        <div class="mb-6">
          <h1 class="text-2xl font-heading font-bold">{t('paymentDeclined', lang)}</h1>
          <p class="text-muted-foreground mt-2">{errorMessage}</p>
        </div>
        <a
          href={`/${lang}/checkout`}
          class="inline-block mt-8 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          {t('backToCart', lang)}
        </a>
      </div>
    );
  }

  const heading = fallback ? t('paymentReceived', lang) : t('orderConfirmed', lang);
  const message = fallback ? t('orderProcessing', lang) : t('thankYou', lang);

  return (
    <div class="max-w-lg mx-auto px-4 py-12 text-center">
      <div class="mb-6">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
          <svg
            class="w-8 h-8 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width={2}
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 class="text-2xl font-heading font-bold">{heading}</h1>
        <p class="text-muted-foreground mt-2">{message}</p>
      </div>

      {orderNumber && (
        <p class="text-sm text-muted-foreground">
          {t('orderNumber', lang)}:{' '}
          <span class="font-mono font-medium text-foreground">{orderNumber}</span>
        </p>
      )}

      <a
        href={`/${lang}/`}
        class="inline-block mt-8 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
      >
        {t('backToMenu', lang)}
      </a>
    </div>
  );
}
