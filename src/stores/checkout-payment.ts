import { atom } from 'nanostores';
import type { Stripe, StripeElements } from '@stripe/stripe-js';
import * as log from '@/lib/logger';

// ── Stripe payment state (shared between CheckoutPaymentSection and CheckoutPlaceOrder) ──

export interface StripePaymentState {
  stripe: Stripe;
  elements: StripeElements;
  clientSecret: string;
}

export const $stripePayment = atom<StripePaymentState | null>(null);

// ── SessionStorage availability ──────────────────────────────────────────────

export const $storageAvailable = atom<boolean>(true);

export function checkStorageAvailable(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const key = '__sous_storage_test__';
    sessionStorage.setItem(key, '1');
    sessionStorage.removeItem(key);
    $storageAvailable.set(true);
    return true;
  } catch {
    log.warn('checkout', 'sessionStorage unavailable — form state will not persist');
    $storageAvailable.set(false);
    return false;
  }
}
