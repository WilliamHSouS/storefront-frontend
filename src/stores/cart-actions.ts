import { getClient } from '@/lib/api';
import { $cart, $cartLoading, $eligiblePromotions, errorDetail } from '@/stores/cart';
import type { Cart, EligiblePromotion } from '@/stores/cart';
import { normalizeCart } from '@/lib/normalize';
import type { StorefrontClient } from '@/lib/sdk-stub';
import type { MessageKey } from '@/i18n';

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
    const cart = normalizeCart(data as Record<string, unknown>);
    $cart.set(cart);
    return cart;
  } finally {
    $cartLoading.set(false);
  }
}

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

export async function checkPromotionEligibility(
  cart: Cart,
  client?: StorefrontClient,
  signal?: AbortSignal,
): Promise<EligiblePromotion[]> {
  const sdk = client ?? getClient();
  const cartItems = cart.line_items.map((item) => ({
    product_id: item.product_id,
    quantity: item.quantity,
    price: item.unit_price,
  }));

  const { data, error } = await sdk.POST('/api/v1/promotions/eligible/', {
    body: { cart_items: cartItems },
    signal,
  });

  // Don't update state if request was aborted
  if (signal?.aborted) return [];

  if (error || !data) {
    $eligiblePromotions.set([]);
    return [];
  }

  const promos = (data as { eligible_promotions: EligiblePromotion[] }).eligible_promotions;
  $eligiblePromotions.set(promos);
  return promos;
}

/** Map backend error detail strings to i18n keys. */
export const DISCOUNT_ERROR_MAP: Record<string, MessageKey> = {
  'Invalid discount code': 'discountInvalid',
  'Discount code expired': 'discountExpired',
  'Minimum order amount not met': 'discountMinOrder',
};

/** Error thrown when a discount code is rejected by the API. */
export class DiscountError extends Error {
  readonly apiDetail: string;
  constructor(apiDetail: string) {
    super(apiDetail);
    this.name = 'DiscountError';
    this.apiDetail = apiDetail;
  }
}

export async function applyDiscountCode(
  cartId: string,
  code: string,
  client?: StorefrontClient,
): Promise<Cart> {
  $cartLoading.set(true);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.POST(`/api/v1/cart/{cart_id}/apply-discount/`, {
      params: { path: { cart_id: cartId } },
      body: { code },
    });
    if (error || !data) {
      throw new DiscountError(errorDetail(error));
    }
    const cart = normalizeCart(data as Record<string, unknown>);
    $cart.set(cart);
    return cart;
  } finally {
    $cartLoading.set(false);
  }
}

export async function removeDiscountCode(cartId: string, client?: StorefrontClient): Promise<Cart> {
  $cartLoading.set(true);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.DELETE(`/api/v1/cart/{cart_id}/remove-discount/`, {
      params: { path: { cart_id: cartId } },
    });
    if (error || !data) {
      throw new Error(`Failed to remove discount: ${errorDetail(error)}`);
    }
    const cart = normalizeCart(data as Record<string, unknown>);
    $cart.set(cart);
    return cart;
  } finally {
    $cartLoading.set(false);
  }
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
    const cart = normalizeCart(data as Record<string, unknown>);
    $cart.set(cart);
    return cart;
  } finally {
    $cartLoading.set(false);
  }
}
