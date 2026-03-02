/**
 * Analytics snapshots — read-only views of nanostores for event enrichment.
 *
 * Cart/fulfilment snapshots are attached to relevant events so PostHog
 * can track conversion funnels without querying separate systems.
 */

import { $cart } from '@/stores/cart';
import { $merchant } from '@/stores/merchant';
import type { CartSnapshot, FulfilmentSnapshot } from './types';

export function getCartSnapshot(): CartSnapshot {
  const cart = $cart.get();
  const merchant = $merchant.get();
  const currency = merchant?.currency ?? 'EUR';

  if (!cart) {
    return { cart_item_count: 0, cart_total: '0.00', currency };
  }

  return {
    cart_item_count: cart.item_count ?? 0,
    cart_total: cart.cart_total ?? '0.00',
    currency,
  };
}

export function getFulfilmentSnapshot(): FulfilmentSnapshot {
  // Fulfilment mode is set during checkout — read from cart if available
  const cart = $cart.get();
  return {
    fulfilment_mode: (cart as any)?.fulfilment_mode,
    postal_code: (cart as any)?.delivery_address?.postal_code,
  };
}
