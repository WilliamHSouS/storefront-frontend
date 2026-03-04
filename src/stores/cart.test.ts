import { describe, it, expect, vi, beforeEach } from 'vitest';
import { $cart, ensureCart, getStoredCartId, setStoredCartId } from './cart';
import type { Cart } from './cart';
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
      params: { path: { id: 'stored-cart' } },
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
