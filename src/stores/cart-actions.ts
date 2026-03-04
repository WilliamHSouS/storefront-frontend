import { getClient } from '@/lib/api';
import { $cart, $cartLoading, errorDetail } from '@/stores/cart';
import type { Cart } from '@/stores/cart';
import type { StorefrontClient } from '@/lib/sdk-stub';

/**
 * Update the quantity of a line item in the cart.
 * Sets $cartLoading during the request and updates $cart on success.
 * Accepts an optional `client` parameter for testability; defaults to getClient().
 */
export async function updateCartItemQuantity(
  cartId: string,
  lineItemId: string,
  quantity: number,
  client?: StorefrontClient,
): Promise<Cart> {
  $cartLoading.set(true);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.PATCH(`/api/v1/cart/{cart_id}/items/{id}/`, {
      params: { path: { cart_id: cartId, id: lineItemId } },
      body: { quantity },
    });
    if (error || !data) {
      throw new Error(`Failed to update cart item: ${errorDetail(error)}`);
    }
    $cart.set(data as Cart);
    return data as Cart;
  } finally {
    $cartLoading.set(false);
  }
}

/**
 * Remove a line item from the cart.
 * Sets $cartLoading during the request and updates $cart on success.
 * Accepts an optional `client` parameter for testability; defaults to getClient().
 */
/**
 * Set cart item quantity, removing the item if quantity is 0 or less.
 * Unifies the zero-quantity check so callers don't need to branch.
 */
export async function setCartItemQuantity(
  cartId: string,
  lineItemId: string,
  quantity: number,
  client?: StorefrontClient,
): Promise<Cart> {
  if (quantity <= 0) return removeCartItem(cartId, lineItemId, client);
  return updateCartItemQuantity(cartId, lineItemId, quantity, client);
}

export async function removeCartItem(
  cartId: string,
  lineItemId: string,
  client?: StorefrontClient,
): Promise<Cart> {
  $cartLoading.set(true);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.DELETE(`/api/v1/cart/{cart_id}/items/{id}/`, {
      params: { path: { cart_id: cartId, id: lineItemId } },
    });
    if (error || !data) {
      throw new Error(`Failed to remove cart item: ${errorDetail(error)}`);
    }
    $cart.set(data as Cart);
    return data as Cart;
  } finally {
    $cartLoading.set(false);
  }
}
