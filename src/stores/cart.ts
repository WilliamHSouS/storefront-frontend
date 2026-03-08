import { atom, computed } from 'nanostores';
import type { StorefrontClient } from '@/lib/sdk-stub';
import { normalizeCart } from '@/lib/normalize';
import { getClient } from '@/lib/api';

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
  shipping_cost?: string;
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

const CART_ID_KEY = 'sous_cart_id';

export function getStoredCartId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(CART_ID_KEY);
  } catch (e) {
    console.warn('Failed to read cart ID from localStorage:', e);
    return null;
  }
}

export function setStoredCartId(cartId: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CART_ID_KEY, cartId);
  } catch (e) {
    console.warn('Failed to save cart ID to localStorage:', e);
  }
}

export function clearStoredCartId(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(CART_ID_KEY);
  } catch (e) {
    console.warn('Failed to clear cart ID from localStorage:', e);
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
      params: { path: { id: storedId } },
    });
    if (data) {
      const cart = normalizeCart(data as Record<string, unknown>);
      $cart.set(cart);
      return cart.id;
    }
    if (error) {
      console.warn('Stored cart expired or invalid, creating new cart:', error);
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

/** Add a suggested item to cart (quantity 1, no modifiers). Shared by both upsell surfaces. */
export async function addSuggestionToCart(
  productId: string | number,
): Promise<AddSuggestionResult> {
  const client = getClient();
  const cartId = await ensureCart(client);
  const { data, error } = await client.POST(`/api/v1/cart/{cart_id}/items/`, {
    params: { path: { cart_id: cartId } },
    body: { product_id: productId, quantity: 1 },
  });
  if (data) {
    const cartData = normalizeCart(data as Record<string, unknown>);
    $cart.set(cartData);
    if (cartData.id) setStoredCartId(cartData.id);
    return 'added';
  }
  if (error && 'status' in error && error.status === 400) {
    return 'requires_options';
  }
  return 'error';
}
