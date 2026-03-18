import { useEffect, useState } from 'preact/hooks';
import { t } from '@/i18n';

interface Props {
  lang: 'nl' | 'en' | 'de';
}

export default function CheckoutSuccess({ lang }: Props) {
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const order = params.get('order');
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
      setOrderNumber(order);
      setLoading(false);
    } else if (checkoutId && paymentIntent) {
      // Bank redirect return — completion handled by webhook or ensurePaymentAndComplete (wired in Task 19)
      setLoading(false);
      setOrderNumber(null);
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
        <h1 class="text-2xl font-heading font-bold">{t('orderConfirmed', lang)}</h1>
        <p class="text-muted-foreground mt-2">{t('thankYou', lang)}</p>
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
