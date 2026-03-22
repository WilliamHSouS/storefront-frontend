import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  $cart,
  $itemCount,
  $cartTotal,
  getStoredCartId,
  setStoredCartId,
  clearStoredCartId,
  ensureCart,
  addSuggestionToCart,
} from './cart';
import type { Cart } from './cart';

vi.mock('@/lib/api', () => ({
  getClient: vi.fn(),
}));

const mockCart: Cart = {
  id: 'cart-123',
  line_items: [
    {
      id: 'li-1',
      product_id: 'prod-1',
      product_title: 'Falafel Wrap',
      quantity: 2,
      unit_price: '8.50',
      line_total: '17.00',
    },
    {
      id: 'li-2',
      product_id: 'prod-2',
      product_title: 'Hummus',
      quantity: 1,
      unit_price: '4.00',
      line_total: '4.00',
      selected_options: [{ id: 'mod-1', name: 'Extra tahini', price: '0.50', quantity: 1 }],
    },
  ],
  cart_total: '21.00',
  cart_savings: '0.00',
  item_count: 3,
};

describe('cart store integration', () => {
  beforeEach(() => {
    $cart.set(null);
  });

  it('computed $itemCount reflects line item quantities', () => {
    expect($itemCount.get()).toBe(0);
    $cart.set(mockCart);
    expect($itemCount.get()).toBe(3); // 2 + 1
  });

  it('computed $cartTotal reflects cart total', () => {
    expect($cartTotal.get()).toBe('0.00');
    $cart.set(mockCart);
    expect($cartTotal.get()).toBe('21.00');
  });

  it('$itemCount updates when cart changes', () => {
    $cart.set(mockCart);
    expect($itemCount.get()).toBe(3);

    // Simulate removing an item
    const updatedCart: Cart = {
      ...mockCart,
      line_items: [mockCart.line_items[0]],
      cart_total: '17.00',
      item_count: 2,
    };
    $cart.set(updatedCart);
    expect($itemCount.get()).toBe(2);
  });

  it('handles null cart gracefully', () => {
    $cart.set(null);
    expect($itemCount.get()).toBe(0);
    expect($cartTotal.get()).toBe('0.00');
  });

  it('handles empty line_items', () => {
    $cart.set({ id: 'cart-empty', line_items: [], cart_total: '0.00', item_count: 0 });
    expect($itemCount.get()).toBe(0);
    expect($cartTotal.get()).toBe('0.00');
  });
});

describe('cart persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves cart ID', () => {
    expect(getStoredCartId()).toBeNull();
    setStoredCartId('cart-456');
    expect(getStoredCartId()).toBe('cart-456');
  });

  it('clears stored cart ID', () => {
    setStoredCartId('cart-789');
    expect(getStoredCartId()).toBe('cart-789');
    clearStoredCartId();
    expect(getStoredCartId()).toBeNull();
  });
});

describe('ensureCart', () => {
  beforeEach(() => {
    $cart.set(null);
    localStorage.clear();
  });

  it('returns existing cart ID when cart is already loaded', async () => {
    $cart.set(mockCart);
    const mockClient = { GET: vi.fn(), POST: vi.fn() };
    const id = await ensureCart(mockClient as never);
    expect(id).toBe('cart-123');
    expect(mockClient.GET).not.toHaveBeenCalled();
    expect(mockClient.POST).not.toHaveBeenCalled();
  });

  it('fetches stored cart from API when cart ID is in localStorage', async () => {
    setStoredCartId('cart-stored');
    const fetchedCart: Cart = {
      id: 'cart-stored',
      line_items: [],
      cart_total: '0.00',
      item_count: 0,
    };
    const mockClient = { GET: vi.fn().mockResolvedValue({ data: fetchedCart }), POST: vi.fn() };

    const id = await ensureCart(mockClient as never);
    expect(id).toBe('cart-stored');
    expect($cart.get()).toMatchObject(fetchedCart);
    expect(mockClient.GET).toHaveBeenCalledWith('/api/v1/cart/{cart_id}/', {
      params: { path: { cart_id: 'cart-stored' } },
    });
  });

  it('creates new cart when no stored ID and no loaded cart', async () => {
    const newCart: Cart = { id: 'cart-new', line_items: [], cart_total: '0.00', item_count: 0 };
    const mockClient = { GET: vi.fn(), POST: vi.fn().mockResolvedValue({ data: newCart }) };

    const id = await ensureCart(mockClient as never);
    expect(id).toBe('cart-new');
    expect($cart.get()).toMatchObject(newCart);
    expect(getStoredCartId()).toBe('cart-new');
  });

  it('creates new cart when stored cart ID returns null from API', async () => {
    setStoredCartId('cart-expired');
    const newCart: Cart = { id: 'cart-fresh', line_items: [], cart_total: '0.00', item_count: 0 };
    const mockClient = {
      GET: vi.fn().mockResolvedValue({ data: null }),
      POST: vi.fn().mockResolvedValue({ data: newCart }),
    };

    const id = await ensureCart(mockClient as never);
    expect(id).toBe('cart-fresh');
  });

  it('throws when cart creation fails', async () => {
    const mockClient = {
      GET: vi.fn(),
      POST: vi.fn().mockResolvedValue({ data: null }),
    };

    await expect(ensureCart(mockClient as never)).rejects.toThrow('Failed to create cart');
  });
});

describe('addSuggestionToCart', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adds suggestion and updates cart store on success', async () => {
    const cartWithItem: Cart = {
      id: 'cart-123',
      line_items: [
        {
          id: 'li-1',
          product_id: 3,
          product_title: 'Mint Lemonade',
          quantity: 1,
          unit_price: '4.50',
          line_total: '4.50',
        },
      ],
      cart_total: '4.50',
      item_count: 1,
    };
    $cart.set({ id: 'cart-123', line_items: [], cart_total: '0.00', item_count: 0 });

    const mockClient = { GET: vi.fn(), POST: vi.fn().mockResolvedValue({ data: cartWithItem }) };
    const { getClient } = await import('@/lib/api');
    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await addSuggestionToCart(3);
    expect(result).toBe('added');
    expect($cart.get()).toMatchObject(cartWithItem);
    expect(mockClient.POST).toHaveBeenCalledWith('/api/v1/cart/{cart_id}/items/', {
      params: { path: { cart_id: 'cart-123' } },
      body: { product_id: 3, quantity: 1 },
    });
  });

  it('returns requires_options when API returns 400', async () => {
    $cart.set({ id: 'cart-123', line_items: [], cart_total: '0.00', item_count: 0 });

    const mockClient = {
      GET: vi.fn(),
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 400, statusText: 'Bad Request' },
      }),
    };
    const { getClient } = await import('@/lib/api');
    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await addSuggestionToCart(99);
    expect(result).toBe('requires_options');
  });

  it('returns error when API call fails with non-400', async () => {
    $cart.set({ id: 'cart-123', line_items: [], cart_total: '0.00', item_count: 0 });

    const mockClient = {
      GET: vi.fn(),
      POST: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const { getClient } = await import('@/lib/api');
    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await addSuggestionToCart(99);
    expect(result).toBe('error');
  });
});
