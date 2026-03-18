import { useEffect, useRef, useState } from 'preact/hooks';
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe, PaymentRequest, PaymentRequestPaymentMethodEvent } from '@stripe/stripe-js';
import { t } from '@/i18n';
import { createCheckout, initiatePayment } from '@/stores/checkout-actions';
import { $checkout } from '@/stores/checkout';
import { getClient } from '@/lib/api';
import type { Checkout, PaymentResult } from '@/types/checkout';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExpressCheckoutProps {
  lang: 'nl' | 'en' | 'de';
  publishableKey: string;
  stripeAccount: string;
  merchantName: string;
  currency: string;
  totalInCents: number;
  cartId: string;
  onSuccess: (orderNumber: string) => void;
  onError: (message: string) => void;
  onAvailable?: (available: boolean) => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Awaitable PATCH to set delivery details on a checkout.
 * Unlike the debounced `patchDelivery` from checkout-actions, this returns
 * a Promise so the express checkout flow can sequence steps reliably.
 */
async function patchDeliveryImmediate(
  checkoutId: string,
  data: Record<string, unknown>,
): Promise<Checkout> {
  const sdk = getClient();
  const { data: responseData, error } = await sdk.PATCH('/api/v1/checkout/{id}/delivery/', {
    params: { path: { id: checkoutId } },
    body: data,
  });

  if (error || !responseData) {
    const detail =
      error && typeof error === 'object' && 'message' in error
        ? (error as { message: string }).message
        : 'Failed to set delivery details';
    throw new Error(detail);
  }

  return responseData as Checkout;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ExpressCheckout({
  lang,
  publishableKey,
  stripeAccount,
  merchantName,
  currency,
  totalInCents,
  cartId,
  onSuccess,
  onError,
  onAvailable,
}: ExpressCheckoutProps) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const stripeRef = useRef<Stripe | null>(null);
  const prRef = useRef<PaymentRequest | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    let buttonElement: ReturnType<Stripe['elements']> extends infer E
      ? E extends { create: (...args: unknown[]) => infer R }
        ? R
        : never
      : never;

    async function init() {
      const stripe = await loadStripe(publishableKey, {
        stripeAccount,
      });
      if (!stripe || !mountedRef.current) return;
      stripeRef.current = stripe;

      const paymentRequest = stripe.paymentRequest({
        country: 'NL',
        currency: currency.toLowerCase(),
        total: { label: merchantName, amount: totalInCents },
        requestPayerName: true,
        requestPayerEmail: true,
        requestPayerPhone: true,
      });
      prRef.current = paymentRequest;

      const result = await paymentRequest.canMakePayment();
      if (!mountedRef.current) return;

      if (!result) {
        setAvailable(false);
        onAvailable?.(false);
        return;
      }

      setAvailable(true);
      onAvailable?.(true);

      // Mount the Payment Request Button
      const elements = stripe.elements();
      const prButton = elements.create('paymentRequestButton', {
        paymentRequest,
      });
      buttonElement = prButton as unknown as typeof buttonElement;

      if (buttonRef.current) {
        prButton.mount(buttonRef.current);
      }

      // Handle payment
      paymentRequest.on('paymentmethod', async (ev: PaymentRequestPaymentMethodEvent) => {
        setInlineError(null);

        try {
          // Step 1: Re-use existing checkout or create from cart
          let checkout: Checkout;
          const existing = $checkout.get();
          if (existing?.id) {
            checkout = existing;
          } else {
            try {
              checkout = await createCheckout(cartId);
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Failed to create checkout';
              ev.complete('fail');
              onError(msg);
              return;
            }
          }

          // Step 2: Set delivery details from payment method
          const { payerName, payerEmail, payerPhone } = ev;
          const billing = ev.paymentMethod.billing_details;
          const shipping = ev.shippingAddress;

          const deliveryData: Record<string, unknown> = {
            email: payerEmail ?? billing?.email ?? '',
            phone_number: payerPhone ?? billing?.phone ?? '',
          };

          // Parse name into first/last
          const fullName = payerName ?? billing?.name ?? '';
          const nameParts = fullName.trim().split(/\s+/);
          const firstName = nameParts[0] ?? '';
          const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

          // Use shipping address if available, otherwise billing
          const address = shipping ?? billing?.address;
          if (address) {
            deliveryData.shipping_address = {
              first_name: firstName,
              last_name: lastName,
              street_address_1:
                'addressLine' in address
                  ? ((address as { addressLine?: string[] }).addressLine?.[0] ?? '')
                  : ((address as { line1?: string | null }).line1 ?? ''),
              city: 'city' in address ? ((address as { city?: string }).city ?? '') : '',
              postal_code:
                'postalCode' in address
                  ? ((address as { postalCode?: string }).postalCode ?? '')
                  : ((address as { postal_code?: string | null }).postal_code ?? ''),
              country_code:
                'country' in address ? ((address as { country?: string }).country ?? 'NL') : 'NL',
            };
          }

          try {
            await patchDeliveryImmediate(checkout.id, deliveryData);
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Delivery unavailable';
            ev.complete('fail');
            setInlineError(msg);
            return;
          }

          // Step 3: Initiate payment
          let paymentResult: PaymentResult;
          try {
            paymentResult = await initiatePayment(checkout.id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Payment failed';
            ev.complete('fail');
            onError(msg);
            return;
          }

          // All steps succeeded
          ev.complete('success');
          onSuccess(paymentResult.order_number ?? checkout.order_number ?? checkout.id);
        } catch (err) {
          ev.complete('fail');
          onError(err instanceof Error ? err.message : 'Unexpected error');
        }
      });
    }

    init();

    return () => {
      mountedRef.current = false;
      if (
        buttonElement &&
        typeof (buttonElement as { destroy?: () => void }).destroy === 'function'
      ) {
        (buttonElement as { destroy: () => void }).destroy();
      }
    };
  }, [publishableKey, stripeAccount, currency, cartId]);

  // Update total when it changes
  useEffect(() => {
    if (prRef.current) {
      prRef.current.update({
        total: { label: merchantName, amount: totalInCents },
      });
    }
  }, [totalInCents, merchantName]);

  // Not yet checked or not available — render nothing
  if (available !== true) return null;

  return (
    <div class="px-4 py-3">
      <h2 class="text-sm font-medium text-gray-700 mb-2">{t('expressCheckout', lang)}</h2>
      <div ref={buttonRef} />
      {inlineError && (
        <p class="mt-2 text-sm text-red-600" role="alert">
          {inlineError}
        </p>
      )}
    </div>
  );
}

export { toCents } from '@/lib/currency';
