/**
 * Lightweight Stripe.js loader — replaces the bundled @stripe/stripe-js loadStripe.
 *
 * The official @stripe/stripe-js package adds ~3 kB to the client bundle just for
 * its loader logic. This module does the same thing in ~40 lines: injects the
 * Stripe.js script tag and resolves the window.Stripe constructor.
 *
 * Type-only imports from @stripe/stripe-js are still used for TypeScript types
 * (Stripe, StripeElements, etc.) — those are erased at compile time.
 */

import type { Stripe, StripeConstructorOptions } from '@stripe/stripe-js';

const STRIPE_JS_URL = 'https://js.stripe.com/v3/';

let scriptPromise: Promise<void> | null = null;

function ensureScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    // Already loaded
    if (typeof window !== 'undefined' && (window as { Stripe?: unknown }).Stripe) {
      resolve();
      return;
    }

    // Already injected but not yet loaded
    const existing = document.querySelector(`script[src="${STRIPE_JS_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Stripe.js')));
      return;
    }

    const script = document.createElement('script');
    script.src = STRIPE_JS_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Stripe.js'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/**
 * Load Stripe.js from CDN and return a Stripe instance.
 * Compatible with the @stripe/stripe-js loadStripe() API.
 */
export function loadStripe(
  publishableKey: string,
  options?: StripeConstructorOptions,
): Promise<Stripe | null> {
  return ensureScript()
    .then(() => {
      const StripeFactory = (
        window as { Stripe?: (key: string, opts?: StripeConstructorOptions) => Stripe }
      ).Stripe;
      if (!StripeFactory) return null;
      return StripeFactory(publishableKey, options);
    })
    .catch(() => null);
}
