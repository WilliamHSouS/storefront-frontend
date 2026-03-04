import { atom, computed } from 'nanostores';
import type { StorefrontClient } from '@/lib/sdk-stub';
import { normalizeCart } from '@/lib/normalize';

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

export const $itemCount = computed(
  $cart,
  (cart) => cart?.line_items.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
);

export const $cartTotal = computed($cart, (cart) => cart?.cart_total ?? '0.00');

const CART_ID_KEY = 'sous_cart_id';

export function getStoredCartId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CART_ID_KEY);
}

export function setStoredCartId(cartId: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CART_ID_KEY, cartId);
}

export function clearStoredCartId(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(CART_ID_KEY);
}

/**
 * Ensure a cart exists (fetch stored or create new).
 * Returns the cart ID for use in API URLs.
 */
export async function ensureCart(client: StorefrontClient): Promise<string> {
  const existing = $cart.get();
  if (existing?.id) return existing.id;

  const storedId = getStoredCartId();
  if (storedId) {
    const { data } = await client.GET(`/api/v1/cart/{id}/`, {
      params: { path: { id: storedId } },
    });
    if (data) {
      const cart = normalizeCart(data as Record<string, unknown>);
      $cart.set(cart);
      return cart.id;
    }
  }

  const { data } = await client.POST('/api/v1/cart/');
  if (!data) throw new Error('Failed to create cart');
  const newCart = normalizeCart(data as Record<string, unknown>);
  $cart.set(newCart);
  setStoredCartId(newCart.id);
  return newCart.id;
}
