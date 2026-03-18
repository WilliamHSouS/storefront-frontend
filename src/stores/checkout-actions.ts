import { getClient } from '@/lib/api';
import {
  $checkout,
  $checkoutLoading,
  $checkoutError,
  setStoredCheckoutId,
  clearStoredCheckoutId,
} from '@/stores/checkout';
import type { Checkout, PaymentResult } from '@/types/checkout';
import type { StorefrontClient } from '@/lib/sdk-stub';
import * as log from '@/lib/logger';

// ── Helpers ──────────────────────────────────────────────────────────────────

function errorDetail(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Unknown error';
  const e = error as Record<string, unknown>;
  if (e.body && typeof e.body === 'object') {
    const body = e.body as Record<string, unknown>;
    if (typeof body.detail === 'string') return body.detail;
  }
  if (typeof e.detail === 'string') return e.detail;
  if (e.message && typeof e.message === 'string') return e.message;
  if (typeof e.status === 'number' && typeof e.statusText === 'string') {
    return `${e.status} ${e.statusText}`;
  }
  return 'Unknown error';
}

// ── PATCH queue (debounced delivery updates) ────────────────────────────────

let patchTimer: ReturnType<typeof setTimeout> | null = null;
let patchAbort: AbortController | null = null;
let patchGeneration = 0;

const PATCH_DEBOUNCE_MS = 500;

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

    try {
      const sdk = client ?? getClient();
      const { data: responseData, error } = await sdk.PATCH('/api/v1/checkout/{id}/delivery/', {
        params: { path: { id: checkoutId } },
        body: data,
        signal: controller.signal,
      });

      // Discard stale response
      if (generation !== patchGeneration) return;

      if (error || !responseData) {
        const detail = errorDetail(error);
        $checkoutError.set(detail);
        log.error('checkout', 'patchDelivery failed:', detail);
        return;
      }

      $checkout.set(responseData as Checkout);
      $checkoutError.set(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (generation !== patchGeneration) return;
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
  $checkoutError.set(null);
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

    const checkout = data as Checkout;
    $checkout.set(checkout);
    setStoredCheckoutId(checkout.id);
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
  $checkoutError.set(null);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.GET('/api/v1/checkout/{id}/', {
      params: { path: { id: checkoutId } },
    });

    if (error || !data) {
      throw new Error(`Failed to fetch checkout: ${errorDetail(error)}`);
    }

    const checkout = data as Checkout;
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
  $checkoutError.set(null);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.POST('/api/v1/checkout/{id}/payment/', {
      params: { path: { id: checkoutId } },
      body: { gateway_id: 'stripe' },
    });

    if (error || !data) {
      throw new Error(`Failed to initiate payment: ${errorDetail(error)}`);
    }

    return data as PaymentResult;
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
  $checkoutError.set(null);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.POST('/api/v1/checkout/{id}/complete/', {
      params: { path: { id: checkoutId } },
    });

    if (error || !data) {
      throw new Error(`Failed to complete checkout: ${errorDetail(error)}`);
    }

    const checkout = data as Checkout;
    $checkout.set(checkout);
    clearStoredCheckoutId();
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
      await completeCheckout(checkoutId, client);
      return { status: 'succeeded', redirectUrl: successUrl };
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
