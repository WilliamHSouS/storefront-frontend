import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '@/i18n';
import { getClient } from '@/lib/api';
import { clearCart } from '@/stores/cart';
import { clearStoredCheckoutId } from '@/stores/checkout';
import * as log from '@/lib/logger';

interface Props {
  lang: 'nl' | 'en' | 'de';
}

export default function CheckoutSuccess({ lang }: Props) {
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const pollCleanupRef = useRef<(() => void) | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      pollCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawOrder = params.get('order');
    const order = rawOrder && /^[a-zA-Z0-9_-]{1,50}$/.test(rawOrder) ? rawOrder : null;
    const checkoutId = params.get('checkout_id');
    const paymentIntent = params.get('payment_intent');

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
    } else if (checkoutId && paymentIntent) {
      // Bank redirect return — the webhook handles payment completion server-side.
      // We poll the checkout status until it's completed or we time out.
      setLoading(true);

      const sdk = getClient();
      const pollInterval = setInterval(async () => {
        try {
          const { data } = await sdk.GET('/api/v1/checkout/{checkout_id}/', {
            params: { path: { checkout_id: checkoutId } },
          });
          const checkout = data as { status?: string; order_number?: string | null } | null;
          log.warn('checkout-success', 'Polling checkout status', {
            checkoutId,
            status: checkout?.status,
          });
          if (checkout?.status === 'completed' && checkout.order_number) {
            clearInterval(pollInterval);
            clearCart();
            clearStoredCheckoutId();
            setOrderNumber(checkout.order_number);
            setLoading(false);
          }
        } catch (err) {
          log.error('checkout-success', 'Failed to poll checkout status:', err);
        }
      }, 2000);

      // Stop polling after 30s — payment is committed but backend hasn't confirmed yet.
      // Clear cart (the order is paid, this cart is dead) and show a softer message.
      const timeoutId = setTimeout(() => {
        clearInterval(pollInterval);
        log.warn('checkout-success', 'Polling timed out — showing fallback', {
          checkoutId,
        });
        clearCart();
        clearStoredCheckoutId();
        setTimedOut(true);
        setLoading(false);
      }, 30_000);

      // Clean up on unmount
      pollCleanupRef.current = () => {
        clearInterval(pollInterval);
        clearTimeout(timeoutId);
      };
    } else {
      // No valid params — redirect to menu
      window.location.href = `/${lang}/`;
    }
  }, [lang]);

  if (loading) {
    return (
      <div class="flex items-center justify-center min-h-[60vh]">
        <p class="text-muted-foreground">{t('confirmingOrder', lang)}</p>
      </div>
    );
  }

  const heading = timedOut ? t('paymentReceived', lang) : t('orderConfirmed', lang);
  const message = timedOut ? t('orderProcessing', lang) : t('thankYou', lang);

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
