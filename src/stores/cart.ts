import { atom, computed } from 'nanostores';
import type { StorefrontClient } from '@/lib/sdk-stub';
import { normalizeCart } from '@/lib/normalize';
import { getClient } from '@/lib/api';
import { $addressCoords } from '@/stores/address';
import * as log from '@/lib/logger';

export interface Suggestion {
  id: number;
  title: string;
  price: string;
  currency: string;
  image_url: string;
  reason: 'product_rule' | 'category_rule' | 'global_rule' | 'co_purchase';
}

export interface CartLineItem {
  id: string;
  product_id: number | string;
  product_title: string;
  product_image?: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  selected_options?: Array<{
    id: number | string;
    name: string;
    group_name?: string;
    price: string;
    quantity: number;
  }>;
  discount?: {
    type: string;
    label: string;
    savings: string;
  };
  notes?: string;
}

export interface Cart {
  id: string;
  line_items: CartLineItem[];
  cart_total: string;
  cart_savings?: string;
  item_count: number;
  subtotal?: string;
  tax_total?: string;
  tax_included?: boolean;
  surcharge_total?: string;
  shipping_cost?: string;
  shipping_estimate?: ShippingEstimate;
  discount_amount?: string;
  promotion_discount_amount?: string;
  applied_discount?: {
    id: string;
    code: string;
    name: string;
    discount_amount: string;
  };
  promotion?: {
    id: number;
    name: string;
    discount_amount: string;
  } | null;
}

export interface ShippingEstimateGroup {
  provider_name: string;
  fulfillment_type: string;
  status: 'quoted' | 'calculated' | 'pending' | 'unavailable';
  estimated_cost: string | null;
  items: string[];
}

export interface ShippingEstimate {
  groups: ShippingEstimateGroup[];
  total_shipping: string | null;
  ships_in_parts: boolean;
}

export const $cart = atom<Cart | null>(null);
export const $cartLoading = atom(false);

export const $itemCount = computed($cart, (cart) => cart?.item_count ?? 0);

export const $cartTotal = computed($cart, (cart) => cart?.cart_total ?? '0.00');

export interface EligiblePromotion {
  id: number;
  name: string;
  promotion_type: string;
  benefit_type: string;
  benefit_product_ids?: string[];
  benefit_quantity: number;
  discount_amount: string;
  is_best_deal: boolean;
}

export const $eligiblePromotions = atom<EligiblePromotion[]>([]);

/** Extract a human-readable detail string from an SDK error (ApiError or Error). */
export function errorDetail(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Unknown error';
  const e = error as Record<string, unknown>;
  // SDK ApiError wraps the response body: { status, statusText, body: { detail: "..." } }
  if (e.body && typeof e.body === 'object') {
    const body = e.body as Record<string, unknown>;
    if (typeof body.detail === 'string') return body.detail;
  }
  // Raw DRF-style response body: { detail: "..." }
  if (typeof e.detail === 'string') return e.detail;
  if ('message' in error && typeof (error as Error).message === 'string')
    return (error as Error).message;
  if ('statusText' in error) {
    const err = error as { status: number; statusText: string };
    return `${err.status} ${err.statusText}`;
  }
  return 'Unknown error';
}

/** Carry forward the previous shipping_estimate when a mutation response lacks one. */
export function mergeShippingEstimate(newCart: Cart, prevCart: Cart | null): Cart {
  if (newCart.shipping_estimate !== undefined || !prevCart?.shipping_estimate) return newCart;
  return { ...newCart, shipping_estimate: prevCart.shipping_estimate };
}

/** Build query params for cart GET requests, including coords if available. */
export function cartCoordsQuery(): Record<string, string | number> | undefined {
  const coords = $addressCoords.get();
  if (!coords) return undefined;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    postal_code: coords.postalCode,
  };
}

const CART_ID_KEY = 'sous_cart_id';
/** Cart IDs must be alphanumeric, hyphens, or underscores — prevents path traversal. */
const CART_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function getStoredCartId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const id = localStorage.getItem(CART_ID_KEY);
    if (id && !CART_ID_PATTERN.test(id)) {
      log.warn('cart', 'Invalid cart ID format in localStorage, clearing');
      clearStoredCartId();
      return null;
    }
    return id;
  } catch (e) {
    log.warn('cart', 'Failed to read cart ID from localStorage:', e);
    return null;
  }
}

export function setStoredCartId(cartId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CART_ID_KEY, cartId);
  } catch (e) {
    log.warn('cart', 'Failed to save cart ID to localStorage:', e);
  }
}

export function clearStoredCartId(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CART_ID_KEY);
  } catch (e) {
    log.warn('cart', 'Failed to clear cart ID from localStorage:', e);
  }
}

let pendingEnsure: Promise<string> | null = null;

/**
 * Ensure a cart exists (fetch stored or create new).
 * Returns the cart ID for use in API URLs.
 * Uses a promise-based lock to prevent duplicate cart creation from concurrent calls.
 */
export async function ensureCart(client: StorefrontClient): Promise<string> {
  if (pendingEnsure) return pendingEnsure;

  pendingEnsure = _doEnsureCart(client).finally(() => {
    pendingEnsure = null;
  });
  return pendingEnsure;
}

async function _doEnsureCart(client: StorefrontClient): Promise<string> {
  const existing = $cart.get();
  if (existing?.id) return existing.id;

  const storedId = getStoredCartId();
  if (storedId) {
    const { data, error } = await client.GET(`/api/v1/cart/{id}/`, {
      params: { path: { id: storedId }, query: cartCoordsQuery() },
    });
    if (data) {
      const cart = normalizeCart(data as Record<string, unknown>);
      $cart.set(cart);
      return cart.id;
    }
    if (error) {
      log.warn('cart', 'Stored cart expired or invalid, creating new cart:', error);
      clearStoredCartId();
    }
  }

  const { data, error } = await client.POST('/api/v1/cart/');
  if (!data) {
    throw new Error(`Failed to create cart: ${errorDetail(error)}`);
  }
  const newCart = normalizeCart(data as Record<string, unknown>);
  $cart.set(newCart);
  setStoredCartId(newCart.id);
  return newCart.id;
}

export type AddSuggestionResult = 'added' | 'requires_options' | 'error';

// addSuggestionToCart has moved to cart-actions.ts. Re-exported here for
// backwards compatibility with existing imports.
export { addSuggestionToCart } from '@/stores/cart-actions';

/** Generation counter — only the latest background refresh writes to $cart. */
let refreshGeneration = 0;

/** Fire-and-forget cart re-fetch with coordinates to refresh shipping_estimate. */
export function backgroundRefreshShipping(cartId: string): void {
  const query = cartCoordsQuery();
  if (!query) return;
  const gen = ++refreshGeneration;
  const client = getClient();
  client
    .GET('/api/v1/cart/{cart_id}/', {
      params: { path: { cart_id: cartId }, query },
    })
    .then(({ data }) => {
      if (data && gen === refreshGeneration) {
        const fresh = normalizeCart(data as Record<string, unknown>);
        const current = $cart.get();
        // Only update if shipping_estimate actually changed — avoids redundant re-renders
        if (current) {
          const prev = JSON.stringify(current.shipping_estimate);
          const next = JSON.stringify(fresh.shipping_estimate);
          if (prev !== next) {
            $cart.set({ ...current, shipping_estimate: fresh.shipping_estimate });
          }
        } else {
          $cart.set(fresh);
        }
      }
    })
    .catch(() => {}); // non-blocking
}
