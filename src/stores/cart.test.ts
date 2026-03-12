import { describe, it, expect, vi, beforeEach } from 'vitest';
import { $addressCoords } from './address';

const mockGetClient = vi.fn();
vi.mock('@/lib/api', () => ({
  getClient: (...args: unknown[]) => mockGetClient(...args),
}));

import {
  $cart,
  ensureCart,
  getStoredCartId,
  setStoredCartId,
  errorDetail,
  mergeShippingEstimate,
  cartCoordsQuery,
  backgroundRefreshShipping,
} from './cart';
import type { Cart, ShippingEstimate } from './cart';
import type { StorefrontClient } from '@/lib/sdk-stub';

function makeCart(overrides: Partial<Cart> = {}): Cart {
  return {
    id: 'cart-123',
    line_items: [],
    cart_total: '0.00',
    item_count: 0,
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

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

describe('ensureCart', () => {
  beforeEach(() => {
    // Reset cart store
    $cart.set(null);
    // Clear localStorage mock
    localStorageMock.clear();
    vi.restoreAllMocks();
  });

  it('returns existing cart ID when cart is already in the store', async () => {
    const existingCart = makeCart({ id: 'existing-cart' });
    $cart.set(existingCart);

    const client = makeClient();
    const cartId = await ensureCart(client);

    expect(cartId).toBe('existing-cart');
    expect(client.GET).not.toHaveBeenCalled();
    expect(client.POST).not.toHaveBeenCalled();
  });

  it('fetches cart from API when cart ID is in localStorage', async () => {
    const storedCart = makeCart({ id: 'stored-cart' });
    localStorageMock.setItem('sous_cart_id', 'stored-cart');

    const client = makeClient({
      GET: vi.fn().mockResolvedValue({ data: storedCart, error: null }),
    });

    const cartId = await ensureCart(client);

    expect(cartId).toBe('stored-cart');
    expect(client.GET).toHaveBeenCalledWith('/api/v1/cart/{id}/', {
      params: { path: { id: 'stored-cart' }, query: undefined },
    });
    expect($cart.get()).toEqual(storedCart);
  });

  it('creates a new cart when no stored ID exists', async () => {
    const newCart = makeCart({ id: 'new-cart-456' });

    const client = makeClient({
      POST: vi.fn().mockResolvedValue({ data: newCart, error: null }),
    });

    const cartId = await ensureCart(client);

    expect(cartId).toBe('new-cart-456');
    expect(client.POST).toHaveBeenCalledWith('/api/v1/cart/');
    expect($cart.get()).toEqual(newCart);
    expect(getStoredCartId()).toBe('new-cart-456');
  });

  it('creates a new cart when stored cart ID returns no data from API', async () => {
    const newCart = makeCart({ id: 'fallback-cart' });
    localStorageMock.setItem('sous_cart_id', 'stale-id');

    const client = makeClient({
      GET: vi.fn().mockResolvedValue({ data: null, error: null }),
      POST: vi.fn().mockResolvedValue({ data: newCart, error: null }),
    });

    const cartId = await ensureCart(client);

    expect(cartId).toBe('fallback-cart');
    expect(client.GET).toHaveBeenCalled();
    expect(client.POST).toHaveBeenCalled();
  });

  it('throws when cart creation fails', async () => {
    const client = makeClient({
      POST: vi.fn().mockResolvedValue({ data: null, error: { status: 500, statusText: 'Error' } }),
    });

    await expect(ensureCart(client)).rejects.toThrow('Failed to create cart: 500 Error');
  });

  it('clears stored cart ID and creates new cart when stored cart returns an error', async () => {
    const newCart = makeCart({ id: 'recovery-cart' });
    localStorageMock.setItem('sous_cart_id', 'expired-id');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const client = makeClient({
      GET: vi
        .fn()
        .mockResolvedValue({ data: null, error: { status: 404, statusText: 'Not Found' } }),
      POST: vi.fn().mockResolvedValue({ data: newCart, error: null }),
    });

    const cartId = await ensureCart(client);

    expect(cartId).toBe('recovery-cart');
    expect(warnSpy).toHaveBeenCalledWith(
      'Stored cart expired or invalid, creating new cart:',
      expect.objectContaining({ status: 404 }),
    );
    expect(getStoredCartId()).toBe('recovery-cart');
    warnSpy.mockRestore();
  });

  it('deduplicates concurrent calls and only makes one API request', async () => {
    const newCart = makeCart({ id: 'dedup-cart' });
    let resolvePost: (value: unknown) => void;
    const postPromise = new Promise((resolve) => {
      resolvePost = resolve;
    });

    const client = makeClient({
      POST: vi.fn().mockReturnValue(postPromise),
    });

    // Fire two concurrent calls
    const promise1 = ensureCart(client);
    const promise2 = ensureCart(client);

    // Resolve the POST
    resolvePost!({ data: newCart, error: null });

    const [id1, id2] = await Promise.all([promise1, promise2]);

    expect(id1).toBe('dedup-cart');
    expect(id2).toBe('dedup-cart');
    // Only one POST call should have been made
    expect(client.POST).toHaveBeenCalledTimes(1);
  });
});

describe('errorDetail', () => {
  it('extracts detail from SDK ApiError with body.detail', () => {
    expect(
      errorDetail({
        status: 400,
        statusText: 'Bad Request',
        body: { detail: 'Discount code expired' },
      }),
    ).toBe('Discount code expired');
  });

  it('extracts detail from raw DRF error', () => {
    expect(errorDetail({ detail: 'Invalid discount code' })).toBe('Invalid discount code');
  });

  it('falls back to status + statusText', () => {
    expect(errorDetail({ status: 500, statusText: 'Internal Server Error' })).toBe(
      '500 Internal Server Error',
    );
  });

  it('extracts message from Error objects', () => {
    expect(errorDetail(new Error('Network failure'))).toBe('Network failure');
  });

  it('returns Unknown error for null/undefined', () => {
    expect(errorDetail(null)).toBe('Unknown error');
    expect(errorDetail(undefined)).toBe('Unknown error');
  });
});

describe('getStoredCartId / setStoredCartId', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  it('returns null when no cart ID is stored', () => {
    expect(getStoredCartId()).toBeNull();
  });

  it('returns stored cart ID after setStoredCartId', () => {
    setStoredCartId('abc-123');
    expect(getStoredCartId()).toBe('abc-123');
  });
});

const SHIPPING_ESTIMATE: ShippingEstimate = {
  groups: [
    {
      provider_name: 'Local Bike Courier',
      fulfillment_type: 'local_delivery',
      status: 'quoted',
      estimated_cost: '4.95',
      items: ['item-1'],
    },
  ],
  total_shipping: '4.95',
  ships_in_parts: false,
};

describe('mergeShippingEstimate', () => {
  it('returns newCart as-is when it has its own shipping_estimate', () => {
    const newEstimate: ShippingEstimate = { ...SHIPPING_ESTIMATE, total_shipping: '6.00' };
    const newCart = makeCart({ shipping_estimate: newEstimate });
    const prevCart = makeCart({ shipping_estimate: SHIPPING_ESTIMATE });

    const result = mergeShippingEstimate(newCart, prevCart);
    expect(result.shipping_estimate).toBe(newEstimate);
  });

  it('carries forward previous shipping_estimate when newCart lacks one', () => {
    const newCart = makeCart();
    const prevCart = makeCart({ shipping_estimate: SHIPPING_ESTIMATE });

    const result = mergeShippingEstimate(newCart, prevCart);
    expect(result.shipping_estimate).toBe(SHIPPING_ESTIMATE);
    // Should be a new object (spread), not mutate newCart
    expect(result).not.toBe(newCart);
  });

  it('returns newCart as-is when prevCart is null', () => {
    const newCart = makeCart();
    const result = mergeShippingEstimate(newCart, null);
    expect(result).toBe(newCart);
    expect(result.shipping_estimate).toBeUndefined();
  });

  it('returns newCart as-is when prevCart also has no estimate', () => {
    const newCart = makeCart();
    const prevCart = makeCart();
    const result = mergeShippingEstimate(newCart, prevCart);
    expect(result).toBe(newCart);
  });
});

describe('cartCoordsQuery', () => {
  beforeEach(() => {
    $addressCoords.set(null);
  });

  it('returns undefined when no address coords are set', () => {
    expect(cartCoordsQuery()).toBeUndefined();
  });

  it('returns lat/lng/postal_code when address coords are set', () => {
    $addressCoords.set({
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3738,
      longitude: 4.884,
    });

    expect(cartCoordsQuery()).toEqual({
      latitude: 52.3738,
      longitude: 4.884,
      postal_code: '1015 BS',
    });
  });
});

describe('backgroundRefreshShipping', () => {
  beforeEach(() => {
    $cart.set(null);
    $addressCoords.set(null);
    mockGetClient.mockReset();
  });

  it('does nothing when no address coords are set', () => {
    const mockGet = vi.fn();
    mockGetClient.mockReturnValue({ GET: mockGet });

    backgroundRefreshShipping('cart-1');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('fires a GET with coords and updates $cart on success', async () => {
    const updatedCart = makeCart({ id: 'cart-1', shipping_estimate: SHIPPING_ESTIMATE });
    const mockGet = vi.fn().mockResolvedValue({ data: updatedCart, error: null });
    mockGetClient.mockReturnValue({ GET: mockGet });

    $addressCoords.set({
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3738,
      longitude: 4.884,
    });

    backgroundRefreshShipping('cart-1');

    await vi.waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/v1/cart/{cart_id}/', {
        params: {
          path: { cart_id: 'cart-1' },
          query: { latitude: 52.3738, longitude: 4.884, postal_code: '1015 BS' },
        },
      });
    });

    await vi.waitFor(() => {
      expect($cart.get()?.shipping_estimate).toEqual(SHIPPING_ESTIMATE);
    });
  });

  it('silently ignores fetch failures', async () => {
    const mockGet = vi.fn().mockRejectedValue(new Error('Network error'));
    mockGetClient.mockReturnValue({ GET: mockGet });

    $addressCoords.set({
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3738,
      longitude: 4.884,
    });

    backgroundRefreshShipping('cart-1');

    await vi.waitFor(() => {
      expect(mockGet).toHaveBeenCalled();
    });

    expect($cart.get()).toBeNull();
  });

  it('ensureCart includes coords when address is set', async () => {
    const storedCart = makeCart({ id: 'stored-cart', shipping_estimate: SHIPPING_ESTIMATE });
    $addressCoords.set({
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3738,
      longitude: 4.884,
    });
    localStorageMock.setItem('sous_cart_id', 'stored-cart');

    const client = makeClient({
      GET: vi.fn().mockResolvedValue({ data: storedCart, error: null }),
    });

    await ensureCart(client);

    expect(client.GET).toHaveBeenCalledWith('/api/v1/cart/{id}/', {
      params: {
        path: { id: 'stored-cart' },
        query: { latitude: 52.3738, longitude: 4.884, postal_code: '1015 BS' },
      },
    });
  });
});
