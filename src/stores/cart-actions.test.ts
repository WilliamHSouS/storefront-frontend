import { describe, it, expect, vi, beforeEach } from 'vitest';
import { $cart, $cartLoading } from './cart';
import type { Cart } from './cart';
import { updateCartItemQuantity, removeCartItem, setCartItemQuantity } from './cart-actions';
import type { StorefrontClient } from '@/lib/sdk-stub';

function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    id: 'cart-123',
    line_items: [
      {
        id: 'item-1',
        product_id: 'prod-1',
        product_title: 'Test Product',
        quantity: 2,
        unit_price: '5.00',
        line_total: '10.00',
      },
    ],
    cart_total: '10.00',
    item_count: 2,
    ...overrides,
  };
}

function makeClient(overrides: Partial<StorefrontClient> = {}): StorefrontClient {
  return {
    GET: vi.fn().mockResolvedValue({ data: null, error: null }),
    POST: vi.fn().mockResolvedValue({ data: null, error: null }),
    PATCH: vi.fn().mockResolvedValue({ data: null, error: null }),
    DELETE: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
}

describe('updateCartItemQuantity', () => {
  beforeEach(() => {
    $cart.set(null);
    $cartLoading.set(false);
  });

  it('updates cart state on success', async () => {
    const updatedCart = makeCart({ cart_total: '15.00', item_count: 3 });
    const client = makeClient({
      PATCH: vi.fn().mockResolvedValue({ data: updatedCart, error: null }),
    });

    const result = await updateCartItemQuantity('cart-123', 'item-1', 3, client);

    expect(result).toEqual(updatedCart);
    expect($cart.get()).toEqual(updatedCart);
    expect(client.PATCH).toHaveBeenCalledWith('/api/v1/cart/{cart_id}/items/{id}/', {
      params: { path: { cart_id: 'cart-123', id: 'item-1' } },
      body: { quantity: 3 },
    });
  });

  it('throws with error details on API failure', async () => {
    const client = makeClient({
      PATCH: vi.fn().mockResolvedValue({
        data: null,
        error: new Error('Server error'),
      }),
    });

    await expect(updateCartItemQuantity('cart-123', 'item-1', 3, client)).rejects.toThrow(
      'Failed to update cart item: Server error',
    );
  });

  it('includes status and statusText for ApiError-shaped errors', async () => {
    const client = makeClient({
      PATCH: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 500, statusText: 'Internal Server Error' },
      }),
    });

    await expect(updateCartItemQuantity('cart-123', 'item-1', 3, client)).rejects.toThrow(
      'Failed to update cart item: 500 Internal Server Error',
    );
  });

  it('sets $cartLoading to true during request and false after', async () => {
    const loadingStates: boolean[] = [];
    const updatedCart = makeCart();

    const client = makeClient({
      PATCH: vi.fn().mockImplementation(() => {
        loadingStates.push($cartLoading.get());
        return Promise.resolve({ data: updatedCart, error: null });
      }),
    });

    await updateCartItemQuantity('cart-123', 'item-1', 3, client);
    loadingStates.push($cartLoading.get());

    // During the request it should be true, after it should be false
    expect(loadingStates).toEqual([true, false]);
  });

  it('resets $cartLoading to false even on error', async () => {
    const client = makeClient({
      PATCH: vi.fn().mockResolvedValue({ data: null, error: new Error('fail') }),
    });

    await expect(updateCartItemQuantity('cart-123', 'item-1', 3, client)).rejects.toThrow();
    expect($cartLoading.get()).toBe(false);
  });
});

describe('setCartItemQuantity', () => {
  beforeEach(() => {
    $cart.set(null);
    $cartLoading.set(false);
  });

  it('delegates to updateCartItemQuantity for positive quantities', async () => {
    const updatedCart = makeCart({ cart_total: '15.00', item_count: 3 });
    const client = makeClient({
      PATCH: vi.fn().mockResolvedValue({ data: updatedCart, error: null }),
    });

    const result = await setCartItemQuantity('cart-123', 'item-1', 3, client);

    expect(result).toEqual(updatedCart);
    expect(client.PATCH).toHaveBeenCalled();
    expect(client.DELETE).not.toHaveBeenCalled();
  });

  it('delegates to removeCartItem for zero quantity', async () => {
    const emptyCart = makeCart({ line_items: [], cart_total: '0.00', item_count: 0 });
    const client = makeClient({
      DELETE: vi.fn().mockResolvedValue({ data: emptyCart, error: null }),
    });

    const result = await setCartItemQuantity('cart-123', 'item-1', 0, client);

    expect(result).toEqual(emptyCart);
    expect(client.DELETE).toHaveBeenCalled();
    expect(client.PATCH).not.toHaveBeenCalled();
  });

  it('delegates to removeCartItem for negative quantity', async () => {
    const emptyCart = makeCart({ line_items: [], cart_total: '0.00', item_count: 0 });
    const client = makeClient({
      DELETE: vi.fn().mockResolvedValue({ data: emptyCart, error: null }),
    });

    const result = await setCartItemQuantity('cart-123', 'item-1', -1, client);

    expect(result).toEqual(emptyCart);
    expect(client.DELETE).toHaveBeenCalled();
  });
});

describe('removeCartItem', () => {
  beforeEach(() => {
    $cart.set(null);
    $cartLoading.set(false);
  });

  it('updates cart state on successful removal', async () => {
    const emptyCart = makeCart({ line_items: [], cart_total: '0.00', item_count: 0 });
    const client = makeClient({
      DELETE: vi.fn().mockResolvedValue({ data: emptyCart, error: null }),
    });

    const result = await removeCartItem('cart-123', 'item-1', client);

    expect(result).toEqual(emptyCart);
    expect($cart.get()).toEqual(emptyCart);
    expect(client.DELETE).toHaveBeenCalledWith('/api/v1/cart/{cart_id}/items/{id}/', {
      params: { path: { cart_id: 'cart-123', id: 'item-1' } },
    });
  });

  it('throws with error details on API failure', async () => {
    const client = makeClient({
      DELETE: vi.fn().mockResolvedValue({
        data: null,
        error: new Error('Not found'),
      }),
    });

    await expect(removeCartItem('cart-123', 'item-1', client)).rejects.toThrow(
      'Failed to remove cart item: Not found',
    );
  });

  it('sets $cartLoading to true during request and false after', async () => {
    const loadingStates: boolean[] = [];
    const emptyCart = makeCart({ line_items: [], cart_total: '0.00', item_count: 0 });

    const client = makeClient({
      DELETE: vi.fn().mockImplementation(() => {
        loadingStates.push($cartLoading.get());
        return Promise.resolve({ data: emptyCart, error: null });
      }),
    });

    await removeCartItem('cart-123', 'item-1', client);
    loadingStates.push($cartLoading.get());

    expect(loadingStates).toEqual([true, false]);
  });

  it('resets $cartLoading to false even on error', async () => {
    const client = makeClient({
      DELETE: vi.fn().mockResolvedValue({ data: null, error: new Error('fail') }),
    });

    await expect(removeCartItem('cart-123', 'item-1', client)).rejects.toThrow();
    expect($cartLoading.get()).toBe(false);
  });
});
