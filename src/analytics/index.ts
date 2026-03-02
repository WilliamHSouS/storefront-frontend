/**
 * Analytics public API.
 *
 * Usage:
 *   import { capture, identify, initAnalytics } from '@/analytics';
 *
 *   // Initialize once on page load
 *   initAnalytics();
 *
 *   // Track events — PII is stripped, core props are merged automatically
 *   capture('item_added', { product_id: '123', price: '10.00' });
 *
 *   // Identify authenticated users (PostHog distinct_id)
 *   identify(customerId);
 */

import { getCoreProperties, getUTMProperties } from './context';
import { stripPII } from './pii-guard';
import { getCartSnapshot } from './snapshots';
import { initPostHog, getPostHog } from './posthog';
import type { EventName, EventProperties } from './types';

// Events that should include cart snapshot
const CART_EVENTS = new Set([
  'item_added',
  'item_removed',
  'item_quantity_changed',
  'cart_viewed',
  'checkout_started',
  'order_placed',
]);

export async function initAnalytics(): Promise<void> {
  await initPostHog();
}

export function capture(
  event: EventName,
  properties?: EventProperties,
): void {
  const posthog = getPostHog();
  if (!posthog) return;

  const core = getCoreProperties();
  const utm = getUTMProperties();
  const cart = CART_EVENTS.has(event) ? getCartSnapshot() : {};

  const merged = {
    ...core,
    ...utm,
    ...cart,
    ...properties,
  };

  // Strip PII as the final step before sending
  const safe = stripPII(merged);

  posthog.capture(event, safe);
}

export function identify(customerId: string): void {
  const posthog = getPostHog();
  if (!posthog) return;

  posthog.identify(customerId);
}

export function reset(): void {
  const posthog = getPostHog();
  if (!posthog) return;

  posthog.reset();
}

export { EVENTS } from './types';
export type { EventName, EventProperties } from './types';
