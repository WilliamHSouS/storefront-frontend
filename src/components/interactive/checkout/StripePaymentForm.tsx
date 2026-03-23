import { useEffect, useRef, useState, memo } from 'preact/compat';
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe, StripeElements, Appearance } from '@stripe/stripe-js';

interface StripePaymentFormProps {
  clientSecret: string;
  publishableKey: string;
  stripeAccount: string;
  billingName?: string;
  merchantTheme?: {
    primary?: string;
    background?: string;
    foreground?: string;
    radius?: string;
  };
  onStripeReady?: (stripe: Stripe, elements: StripeElements) => void;
  onError?: (message: string) => void;
}

function StripePaymentFormInner({
  clientSecret,
  publishableKey,
  stripeAccount,
  billingName,
  merchantTheme,
  onStripeReady,
  onError,
}: StripePaymentFormProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(false);

  useEffect(() => {
    // Prevent double-mount in strict mode
    if (mountedRef.current) return;
    mountedRef.current = true;

    let elements: StripeElements | null = null;

    async function init() {
      try {
        const stripe = await loadStripe(publishableKey, { stripeAccount });

        if (!stripe) {
          onError?.('Failed to load Stripe.js. Please check your network connection.');
          return;
        }

        const appearance: Appearance = {
          theme: 'stripe',
          variables: {
            colorPrimary: merchantTheme?.primary ?? 'hsl(240 100% 50%)',
            colorBackground: merchantTheme?.background ?? 'hsl(0 0% 100%)',
            colorText: merchantTheme?.foreground ?? 'hsl(0 0% 5%)',
            borderRadius: merchantTheme?.radius ?? '0.5rem',
            fontFamily: 'Inter, system-ui, sans-serif',
          },
        };

        elements = stripe.elements({ clientSecret, appearance });

        /* eslint-disable @typescript-eslint/no-explicit-any -- paymentMethodOrder + accordion layout not yet in @stripe/stripe-js types; remove after stripe-js update */
        const paymentElement = elements.create('payment', {
          defaultValues: {
            billingDetails: {
              name: billingName || '',
            },
          },
          paymentMethodOrder: ['ideal', 'card'],
          layout: {
            type: 'accordion',
            defaultCollapsed: false,
            radios: true,
            spacedAccordionItems: true,
          },
        } as any);
        /* eslint-enable @typescript-eslint/no-explicit-any -- end stripe-js type workaround */

        if (!containerRef.current) {
          onError?.('Payment form container not found.');
          return;
        }

        paymentElement.mount(containerRef.current);

        paymentElement.on('ready', () => {
          setLoading(false);
          onStripeReady?.(stripe, elements!);
        });

        paymentElement.on('loaderror', (event) => {
          const message = event.error?.message ?? 'Payment form failed to load. Please try again.';
          onError?.(message);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
        onError?.(message);
      }
    }

    init();

    return () => {
      mountedRef.current = false;
      // Stripe Elements clean up their own DOM on unmount, but we destroy
      // the Elements instance to release resources.
      if (elements) {
        // getElement returns the mounted element so we can unmount it
        const pe = elements.getElement('payment');
        if (pe) pe.destroy();
      }
    };
  }, [clientSecret, publishableKey, stripeAccount]);

  return (
    <div class="relative min-h-[200px]">
      {loading && <div class="absolute inset-0 animate-pulse rounded-lg bg-muted h-[200px]" />}
      <div ref={containerRef} class={loading ? 'invisible' : ''} />
    </div>
  );
}

export const StripePaymentForm = memo(StripePaymentFormInner);
