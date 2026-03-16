import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetClient = vi.fn();
vi.mock('@/lib/api', () => ({
  getClient: (...args: unknown[]) => mockGetClient(...args),
}));

import { $cart, $cartLoading } from './cart';
import type { Cart } from './cart';
import {
  updateCartItemQuantity,
  removeCartItem,
  setCartItemQuantity,
  commitCartResponse,
  applyDiscountCode,
  removeDiscountCode,
  addSuggestionToCart,
  DiscountError,
  DISCOUNT_ERROR_MAP,
} from './cart-actions';
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

    expect(result).toMatchObject(updatedCart);
    expect($cart.get()).toMatchObject(updatedCart);
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

    expect(result).toMatchObject(updatedCart);
    expect(client.PATCH).toHaveBeenCalled();
    expect(client.DELETE).not.toHaveBeenCalled();
  });

  it('delegates to removeCartItem for zero quantity', async () => {
    const emptyCart = makeCart({ line_items: [], cart_total: '0.00', item_count: 0 });
    const client = makeClient({
      DELETE: vi.fn().mockResolvedValue({ data: emptyCart, error: null }),
    });

    const result = await setCartItemQuantity('cart-123', 'item-1', 0, client);

    expect(result).toMatchObject(emptyCart);
    expect(client.DELETE).toHaveBeenCalled();
    expect(client.PATCH).not.toHaveBeenCalled();
  });

  it('delegates to removeCartItem for negative quantity', async () => {
    const emptyCart = makeCart({ line_items: [], cart_total: '0.00', item_count: 0 });
    const client = makeClient({
      DELETE: vi.fn().mockResolvedValue({ data: emptyCart, error: null }),
    });

    const result = await setCartItemQuantity('cart-123', 'item-1', -1, client);

    expect(result).toMatchObject(emptyCart);
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

    expect(result).toMatchObject(emptyCart);
    expect($cart.get()).toMatchObject(emptyCart);
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

describe('commitCartResponse', () => {
  beforeEach(() => {
    $cart.set(null);
    localStorage.clear();
    mockGetClient.mockReset();
  });

  it('normalizes cart, sets $cart, persists cart ID, and triggers backgroundRefreshShipping', () => {
    // backgroundRefreshShipping calls getClient internally; stub it to prevent real calls.
    mockGetClient.mockReturnValue({
      GET: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const rawData = {
      id: 'cart-42',
      line_items: [],
      cart_total: '10.00',
      item_count: 2,
    };

    const result = commitCartResponse(rawData);

    // Returns normalized cart
    expect(result.id).toBe('cart-42');
    expect(result.cart_total).toBe('10.00');

    // Sets $cart store
    expect($cart.get()).not.toBeNull();
    expect($cart.get()!.id).toBe('cart-42');

    // Persists cart ID to localStorage
    expect(localStorage.getItem('sous_cart_id')).toBe('cart-42');
  });
});

describe('applyDiscountCode', () => {
  beforeEach(() => {
    $cart.set(null);
    $cartLoading.set(false);
    localStorage.clear();
    mockGetClient.mockReset();
  });

  it('returns normalized cart on success', async () => {
    // backgroundRefreshShipping needs getClient
    mockGetClient.mockReturnValue({
      GET: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const client = makeClient({
      POST: vi.fn().mockResolvedValue({
        data: { id: 'cart-1', line_items: [], cart_total: '8.00', item_count: 1 },
        error: null,
      }),
    });

    const result = await applyDiscountCode('cart-1', 'SAVE10', client);

    expect(result.id).toBe('cart-1');
    expect(client.POST).toHaveBeenCalledWith(
      '/api/v1/cart/{cart_id}/apply-discount/',
      expect.objectContaining({
        body: { code: 'SAVE10' },
      }),
    );
  });

  it('throws DiscountError on API error', async () => {
    const client = makeClient({
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { detail: 'Discount code expired' },
      }),
    });

    await expect(applyDiscountCode('cart-1', 'EXPIRED', client)).rejects.toThrow(DiscountError);
    await expect(applyDiscountCode('cart-1', 'EXPIRED', client)).rejects.toThrow(
      'Discount code expired',
    );
  });

  it('sets $cartLoading during the request', async () => {
    mockGetClient.mockReturnValue({
      GET: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const loadingStates: boolean[] = [];
    const client = makeClient({
      POST: vi.fn().mockImplementation(() => {
        loadingStates.push($cartLoading.get());
        return Promise.resolve({
          data: { id: 'cart-1', line_items: [], cart_total: '8.00', item_count: 1 },
          error: null,
        });
      }),
    });

    await applyDiscountCode('cart-1', 'SAVE10', client);
    loadingStates.push($cartLoading.get());

    expect(loadingStates).toEqual([true, false]);
  });
});

describe('removeDiscountCode', () => {
  beforeEach(() => {
    $cart.set(null);
    $cartLoading.set(false);
    localStorage.clear();
    mockGetClient.mockReset();
  });

  it('returns normalized cart on success', async () => {
    mockGetClient.mockReturnValue({
      GET: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const client = makeClient({
      DELETE: vi.fn().mockResolvedValue({
        data: { id: 'cart-1', line_items: [], cart_total: '10.00', item_count: 1 },
        error: null,
      }),
    });

    const result = await removeDiscountCode('cart-1', client);

    expect(result.id).toBe('cart-1');
    expect(client.DELETE).toHaveBeenCalledWith(
      '/api/v1/cart/{cart_id}/remove-discount/',
      expect.objectContaining({
        params: expect.objectContaining({
          path: { cart_id: 'cart-1' },
        }),
      }),
    );
  });

  it('throws on API error', async () => {
    const client = makeClient({
      DELETE: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 500, statusText: 'Internal Server Error' },
      }),
    });

    await expect(removeDiscountCode('cart-1', client)).rejects.toThrow('Failed to remove discount');
  });
});

describe('addSuggestionToCart', () => {
  beforeEach(() => {
    $cart.set(null);
    localStorage.clear();
    mockGetClient.mockReset();
  });

  it('returns "added" on success', async () => {
    // Set an existing cart so ensureCart returns immediately
    $cart.set(makeCart({ id: 'cart-1' }));

    const mockPost = vi.fn().mockResolvedValue({
      data: { id: 'cart-1', line_items: [], cart_total: '5.00', item_count: 1 },
      error: null,
    });
    mockGetClient.mockReturnValue({
      GET: vi.fn().mockResolvedValue({ data: null, error: null }),
      POST: mockPost,
      PATCH: vi.fn(),
      DELETE: vi.fn(),
    });

    const result = await addSuggestionToCart('prod-42');

    expect(result).toBe('added');
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/cart/{cart_id}/items/',
      expect.objectContaining({
        body: { product_id: 'prod-42', quantity: 1 },
      }),
    );
  });

  it('returns "requires_options" on 400 error', async () => {
    $cart.set(makeCart({ id: 'cart-1' }));

    const mockPost = vi.fn().mockResolvedValue({
      data: null,
      error: { status: 400, statusText: 'Bad Request' },
    });
    mockGetClient.mockReturnValue({
      GET: vi.fn(),
      POST: mockPost,
      PATCH: vi.fn(),
      DELETE: vi.fn(),
    });

    const result = await addSuggestionToCart('prod-42');

    expect(result).toBe('requires_options');
  });

  it('returns "error" on non-400 failure', async () => {
    $cart.set(makeCart({ id: 'cart-1' }));

    const mockPost = vi.fn().mockResolvedValue({
      data: null,
      error: { status: 500, statusText: 'Server Error' },
    });
    mockGetClient.mockReturnValue({
      GET: vi.fn(),
      POST: mockPost,
      PATCH: vi.fn(),
      DELETE: vi.fn(),
    });

    const result = await addSuggestionToCart('prod-42');

    expect(result).toBe('error');
  });
});

describe('DISCOUNT_ERROR_MAP', () => {
  it('maps "Invalid discount code" to discountInvalid', () => {
    expect(DISCOUNT_ERROR_MAP['Invalid discount code']).toBe('discountInvalid');
  });

  it('maps "Discount code expired" to discountExpired', () => {
    expect(DISCOUNT_ERROR_MAP['Discount code expired']).toBe('discountExpired');
  });

  it('maps "Minimum order amount not met" to discountMinOrder', () => {
    expect(DISCOUNT_ERROR_MAP['Minimum order amount not met']).toBe('discountMinOrder');
  });

  it('has exactly 3 entries', () => {
    expect(Object.keys(DISCOUNT_ERROR_MAP)).toHaveLength(3);
  });
});
