import { atom, computed } from 'nanostores';
import type { StorefrontClient } from '@/lib/sdk-stub';
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
}

export const $cart = atom<Cart | null>(null);
export const $cartLoading = atom(false);

export const $itemCount = computed($cart, (cart) => cart?.item_count ?? 0);

export const $cartTotal = computed($cart, (cart) => cart?.cart_total ?? '0.00');

/** Extract a human-readable detail string from an SDK error (ApiError or Error). */
export function errorDetail(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Unknown error';
  if ('message' in error && typeof (error as Error).message === 'string')
    return (error as Error).message;
  if ('statusText' in error) {
    const e = error as { status: number; statusText: string };
    return `${e.status} ${e.statusText}`;
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
      $cart.set(data as Cart);
      return (data as Cart).id;
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
  const newCart = data as Cart;
  $cart.set(newCart);
  setStoredCartId(newCart.id);
  return newCart.id;
}

/** Add a suggested item to cart (quantity 1, no modifiers). Shared by both upsell surfaces. */
export async function addSuggestionToCart(productId: string | number): Promise<boolean> {
  const client = getClient();
  const cartId = await ensureCart(client);
  const { data } = await client.POST(`/api/v1/cart/{cart_id}/items/`, {
    params: { path: { cart_id: cartId } },
    body: { product_id: productId, quantity: 1 },
  });
  if (data) {
    const cartData = data as Cart;
    $cart.set(cartData);
    if (cartData.id) setStoredCartId(cartData.id);
    return true;
  }
  return false;
}
