import { getClient } from '@/lib/api';
import { errorDetail } from '@/lib/errors';
import { $cart, clearStoredCartId } from '@/stores/cart';
import {
  $checkout,
  $checkoutLoading,
  $checkoutError,
  $shippingGroups,
  $shippingGroupsLoading,
  setStoredCheckoutId,
  clearStoredCheckoutId,
} from '@/stores/checkout';
import type { Checkout, PaymentResult, ShippingGroup } from '@/types/checkout';
import type { StorefrontClient } from '@/lib/sdk-stub';
import * as log from '@/lib/logger';

// ── PATCH queue (debounced delivery updates) ────────────────────────────────

let patchTimer: ReturnType<typeof setTimeout> | null = null;
let patchAbort: AbortController | null = null;
let patchGeneration = 0;

const PATCH_DEBOUNCE_MS = 500;

/**
 * Cancel any pending debounced PATCH and abort any in-flight request.
 * Call this in component cleanup effects to prevent detached timers.
 */
export function cancelPendingPatch(): void {
  if (patchTimer != null) {
    clearTimeout(patchTimer);
    patchTimer = null;
  }
  if (patchAbort) {
    patchAbort.abort();
    patchAbort = null;
  }
}

/**
 * Debounced PATCH to update checkout delivery details.
 * Rapid calls within 500ms are collapsed — only the last executes.
 * Uses a generation counter to discard stale responses.
 */
export function patchDelivery(
  checkoutId: string,
  data: Record<string, unknown>,
  client?: StorefrontClient,
): void {
  // Cancel any pending debounce
  if (patchTimer != null) {
    clearTimeout(patchTimer);
  }
  // Abort any in-flight request
  if (patchAbort) {
    patchAbort.abort();
  }

  const generation = ++patchGeneration;

  patchTimer = setTimeout(async () => {
    patchTimer = null;
    const controller = new AbortController();
    patchAbort = controller;

    const sdk = client ?? getClient();
    try {
      const { data: responseData, error } = await sdk.PATCH(
        '/api/v1/checkout/{checkout_id}/delivery/',

        {
          params: { path: { checkout_id: checkoutId } },
          body: data,
          signal: controller.signal,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opts shape bridges local RequestOptions to SDK per-path type
        } as any,
      );

      // Discard stale response
      if (generation !== patchGeneration) return;

      if (error || !responseData) {
        const detail = errorDetail(error);
        $checkoutError.set(detail);
        log.error('checkout', 'patchDelivery failed:', detail);
        return;
      }

      $checkout.set(responseData as unknown as Checkout);
      log.warn('checkout', 'Delivery details set', {
        checkoutId,
        fulfillmentType: data.fulfillment_type,
      });
      $checkoutError.set(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (generation !== patchGeneration) return;

      // Auto-retry once for network errors (TypeError = fetch failed)
      if (err instanceof TypeError) {
        log.warn('checkout', 'patchDelivery network error, retrying once');
        try {
          const retryResult = await sdk.PATCH('/api/v1/checkout/{checkout_id}/delivery/', {
            params: { path: { checkout_id: checkoutId } },
            body: data,
            signal: controller.signal,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opts shape bridges local RequestOptions to SDK per-path type
          } as any);
          if (generation !== patchGeneration) return;
          if (retryResult.error || !retryResult.data) {
            const detail = errorDetail(retryResult.error);
            $checkoutError.set(detail);
            log.error('checkout', 'patchDelivery retry failed:', detail);
            return;
          }
          $checkout.set(retryResult.data as unknown as Checkout);
          $checkoutError.set(null);
          return;
        } catch (retryErr) {
          if ((retryErr as Error).name === 'AbortError') return;
          if (generation !== patchGeneration) return;
          // Fall through to set error
        }
      }

      const detail = errorDetail(err);
      $checkoutError.set(detail);
      log.error('checkout', 'patchDelivery failed:', detail);
    } finally {
      if (patchAbort === controller) {
        patchAbort = null;
      }
    }
  }, PATCH_DEBOUNCE_MS);
}

// ── createCheckout ──────────────────────────────────────────────────────────

/**
 * Create a new checkout from a cart ID.
 * Stores the checkout ID in sessionStorage and updates the $checkout store.
 */
export async function createCheckout(cartId: string, client?: StorefrontClient): Promise<Checkout> {
  $checkoutLoading.set(true);
  try {
    const sdk = client ?? getClient();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    const { data, error } = await sdk.POST('/api/v1/checkout/', {
      body: { cart_id: cartId },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (error || !data) {
      throw new Error(`Failed to create checkout: ${errorDetail(error)}`);
    }

    const checkout = data as unknown as Checkout;
    $checkout.set(checkout);
    setStoredCheckoutId(checkout.id);
    log.warn('checkout', 'Checkout created', {
      checkoutId: checkout.id,
      cartId,
      lineItemCount: checkout.line_items?.length,
    });
    return checkout;
  } finally {
    $checkoutLoading.set(false);
  }
}

// ── fetchCheckout ───────────────────────────────────────────────────────────

/**
 * Fetch an existing checkout by ID and update the $checkout store.
 */
export async function fetchCheckout(
  checkoutId: string,
  client?: StorefrontClient,
): Promise<Checkout> {
  $checkoutLoading.set(true);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.GET('/api/v1/checkout/{checkout_id}/', {
      params: { path: { checkout_id: checkoutId } },
    });

    if (error || !data) {
      throw new Error(`Failed to fetch checkout: ${errorDetail(error)}`);
    }

    const checkout = data as unknown as Checkout;
    $checkout.set(checkout);
    return checkout;
  } finally {
    $checkoutLoading.set(false);
  }
}

// ── initiatePayment ─────────────────────────────────────────────────────────

/**
 * Initiate payment for a checkout via Stripe gateway.
 */
export async function initiatePayment(
  checkoutId: string,
  client?: StorefrontClient,
): Promise<PaymentResult> {
  $checkoutLoading.set(true);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.POST('/api/v1/checkout/{checkout_id}/payment/', {
      params: { path: { checkout_id: checkoutId } },
      body: { gateway_id: 'stripe' },
    });

    if (error || !data) {
      throw new Error(`Failed to initiate payment: ${errorDetail(error)}`);
    }

    log.warn('checkout', 'Payment initiated', {
      checkoutId,
      gateway: 'stripe',
    });
    return data as unknown as PaymentResult;
  } finally {
    $checkoutLoading.set(false);
  }
}

// ── completeCheckout ────────────────────────────────────────────────────────

/**
 * Complete a checkout and clear the stored checkout ID.
 */
export async function completeCheckout(
  checkoutId: string,
  client?: StorefrontClient,
): Promise<Checkout> {
  $checkoutLoading.set(true);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.POST('/api/v1/checkout/{checkout_id}/complete/', {
      params: { path: { checkout_id: checkoutId } },
    });

    if (error || !data) {
      throw new Error(`Failed to complete checkout: ${errorDetail(error)}`);
    }

    const checkout = data as unknown as Checkout;
    $checkout.set(checkout);
    log.warn('checkout', 'Checkout completed', {
      checkoutId,
      orderNumber: checkout.order_number,
    });
    clearStoredCheckoutId();
    // Clear cart after successful order completion
    $cart.set(null);
    clearStoredCartId();
    return checkout;
  } finally {
    $checkoutLoading.set(false);
  }
}

// ── ensurePaymentAndComplete ────────────────────────────────────────────────

export interface PaymentCompletionResult {
  status: 'succeeded' | 'processing' | 'requires_action' | 'error';
  redirectUrl?: string;
  message?: string;
}

interface StripeInstance {
  retrievePaymentIntent(clientSecret: string): Promise<{
    paymentIntent?: { status: string };
    error?: { message: string };
  }>;
}

/**
 * Shared completion logic: fetch checkout status, check Stripe payment intent,
 * and either complete or return appropriate status.
 */
export async function ensurePaymentAndComplete(
  checkoutId: string,
  clientSecret: string,
  stripe: StripeInstance,
  lang: string,
  client?: StorefrontClient,
): Promise<PaymentCompletionResult> {
  const successUrl = `/${lang}/checkout/success`;

  // 1. Fetch current checkout state
  const checkout = await fetchCheckout(checkoutId, client);

  // 2. If already completed, redirect to success
  if (checkout.status === 'completed') {
    clearStoredCheckoutId();
    return { status: 'succeeded', redirectUrl: successUrl };
  }

  // 3. Retrieve payment intent from Stripe
  const { paymentIntent, error: stripeError } = await stripe.retrievePaymentIntent(clientSecret);

  if (stripeError || !paymentIntent) {
    return {
      status: 'error',
      message: stripeError?.message ?? 'Failed to retrieve payment status',
    };
  }

  // 4. Handle payment intent status
  switch (paymentIntent.status) {
    case 'succeeded': {
      const completed = await completeCheckout(checkoutId, client);
      const orderParam = completed.order_number ? `?order=${completed.order_number}` : '';
      return { status: 'succeeded', redirectUrl: `${successUrl}${orderParam}` };
    }
    case 'processing': {
      return {
        status: 'processing',
        message: 'Your payment is processing. You will be notified when it completes.',
      };
    }
    case 'requires_action': {
      return {
        status: 'requires_action',
        message: 'Additional authentication is required to complete your payment.',
      };
    }
    default: {
      return {
        status: 'error',
        message: `Unexpected payment status: ${paymentIntent.status}`,
      };
    }
  }
}

// ── fetchShippingGroups ────────────────────────────────────────────────

/**
 * Fetch shipping groups (with rates) for a checkout.
 * Uber Direct rates will have populated `rate_id` and `expires_at`.
 */
export async function fetchShippingGroups(
  checkoutId: string,
  client?: StorefrontClient,
): Promise<ShippingGroup[]> {
  $shippingGroupsLoading.set(true);
  try {
    const sdk = client ?? getClient();
    /* eslint-disable @typescript-eslint/no-explicit-any -- shipping-groups endpoint not yet in SDK types; remove after SDK regeneration */
    const { data, error } = await sdk.GET(
      '/api/v1/checkout/{checkout_id}/shipping-groups/' as any,
      { params: { path: { checkout_id: checkoutId } } },
    );
    /* eslint-enable @typescript-eslint/no-explicit-any -- end shipping-groups SDK workaround */

    if (error || !data) {
      log.error('checkout', 'fetchShippingGroups failed:', error);
      $shippingGroups.set([]);
      return [];
    }

    const groups = data as unknown as ShippingGroup[];
    $shippingGroups.set(groups);
    return groups;
  } finally {
    $shippingGroupsLoading.set(false);
  }
}

// ── selectShippingRate ─────────────────────────────────────────────────

export interface SelectRateResult {
  ok: boolean;
  expired: boolean;
}

/**
 * Select a shipping rate for a checkout.
 * Returns `{ ok: true }` on success, `{ expired: true }` on HTTP 410
 * (caller should re-fetch shipping groups for fresh quotes).
 */
export async function selectShippingRate(
  checkoutId: string,
  groupId: string,
  rateId: string,
  client?: StorefrontClient,
): Promise<SelectRateResult> {
  const sdk = client ?? getClient();
  /* eslint-disable @typescript-eslint/no-explicit-any -- select-rate endpoint not yet in SDK types; remove after SDK regeneration */
  const { data: _data, error } = await sdk.POST(
    '/api/v1/checkout/{checkout_id}/shipping-groups/select-rate/' as any,
    {
      params: { path: { checkout_id: checkoutId } },
      body: { group_id: groupId, rate_id: rateId },
    },
  );
  /* eslint-enable @typescript-eslint/no-explicit-any -- end select-rate SDK workaround */

  if (error) {
    const apiError = error as { status?: number };
    if (apiError.status === 410) {
      log.warn('checkout', 'Shipping rate expired, need to re-fetch groups');
      return { ok: false, expired: true };
    }
    log.error('checkout', 'selectShippingRate failed:', error);
    return { ok: false, expired: false };
  }

  return { ok: true, expired: false };
}
