import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Checkout, CheckoutFormState } from '@/types/checkout';
import type { CartLineItem } from './cart';

// Mock sessionStorage
const sessionStorageMock = (() => {
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

Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock, writable: true });

import {
  $checkout,
  $checkoutTotals,
  $checkoutStatus,
  getStoredCheckoutId,
  setStoredCheckoutId,
  clearStoredCheckoutId,
  checkoutFingerprint,
  cartFingerprint,
  persistFormState,
  restoreFormState,
  clearFormState,
} from './checkout';

function mockCheckout(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: 'chk-abc-123',
    cart_id: 'cart-789',
    merchant_id: 1,
    channel_id: null,
    status: 'created',
    currency: 'EUR',
    display_currency: 'EUR',
    fx_rate_to_display: '1.00',
    email: null,
    shipping_address: null,
    billing_address: null,
    shipping_method: null,
    payment_method: null,
    payment_status: null,
    line_items: [
      {
        product_id: 'prod-1',
        variant_id: 'var-1',
        product_title: 'Falafel Wrap',
        title: 'Falafel Wrap - Regular',
        quantity: 2,
        unit_price: '8.50',
        total_price: '17.00',
        line_total: '17.00',
        tax_rate: '0.09',
        tax_amount: '1.53',
        fulfillment_type: 'local_delivery',
        fulfillment_date: null,
        options: [],
        product_type: 'food',
        surcharges: [],
      },
    ],
    subtotal: '17.00',
    tax_total: '1.53',
    shipping_cost: '4.95',
    surcharge_total: '0.00',
    display_surcharge_total: '0.00',
    discount_amount: '0.00',
    discount_code: null,
    applied_promotion_id: null,
    promotion_discount_amount: '0.00',
    total: '23.48',
    display_subtotal: '17.00',
    display_tax_total: '1.53',
    display_shipping_cost: '4.95',
    display_discount_amount: '0.00',
    display_promotion_discount_amount: '0.00',
    display_total: '23.48',
    fulfillment_slot_id: null,
    gift_card_details: null,
    order_number: null,
    purpose: 'standard',
    created_at: '2026-03-18T10:00:00Z',
    updated_at: '2026-03-18T10:00:00Z',
    available_payment_gateways: null,
    ...overrides,
  };
}

describe('$checkoutTotals', () => {
  beforeEach(() => {
    $checkout.set(null);
  });

  it('returns zeros when checkout is null', () => {
    const totals = $checkoutTotals.get();
    expect(totals).toEqual({
      subtotal: '0.00',
      tax: '0.00',
      shipping: '0.00',
      discount: '0.00',
      total: '0.00',
    });
  });

  it('derives display totals from checkout', () => {
    $checkout.set(mockCheckout());
    const totals = $checkoutTotals.get();
    expect(totals).toEqual({
      subtotal: '17.00',
      tax: '1.53',
      shipping: '4.95',
      discount: '0.00',
      total: '23.48',
    });
  });
});

describe('$checkoutStatus', () => {
  beforeEach(() => {
    $checkout.set(null);
  });

  it('returns null when checkout is null', () => {
    expect($checkoutStatus.get()).toBeNull();
  });

  it('returns status from checkout', () => {
    $checkout.set(mockCheckout({ status: 'delivery_set' }));
    expect($checkoutStatus.get()).toBe('delivery_set');
  });
});

describe('checkout ID persistence', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    vi.restoreAllMocks();
  });

  it('returns null when no checkout ID is stored', () => {
    expect(getStoredCheckoutId()).toBeNull();
  });

  it('stores and retrieves a checkout ID', () => {
    setStoredCheckoutId('chk-abc-123');
    expect(getStoredCheckoutId()).toBe('chk-abc-123');
  });

  it('clears a stored checkout ID', () => {
    setStoredCheckoutId('chk-abc-123');
    clearStoredCheckoutId();
    expect(getStoredCheckoutId()).toBeNull();
  });

  it('rejects invalid IDs', () => {
    sessionStorageMock.setItem('sous_checkout_id', 'invalid id with spaces');
    expect(getStoredCheckoutId()).toBeNull();
  });

  it('handles sessionStorage errors gracefully on get', () => {
    sessionStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error('Storage disabled');
    });
    expect(getStoredCheckoutId()).toBeNull();
  });

  it('handles sessionStorage errors gracefully on set', () => {
    sessionStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('Storage full');
    });
    // Should not throw
    expect(() => setStoredCheckoutId('chk-123')).not.toThrow();
  });

  it('handles sessionStorage errors gracefully on clear', () => {
    sessionStorageMock.removeItem.mockImplementationOnce(() => {
      throw new Error('Storage disabled');
    });
    expect(() => clearStoredCheckoutId()).not.toThrow();
  });
});

describe('checkoutFingerprint and cartFingerprint', () => {
  it('produces matching fingerprints for same items', () => {
    const checkout = mockCheckout({
      line_items: [
        {
          product_id: 'prod-1',
          variant_id: 'v1',
          product_title: 'A',
          title: 'A',
          quantity: 2,
          unit_price: '5.00',
          total_price: '10.00',
          line_total: '10.00',
          tax_rate: '0.09',
          tax_amount: '0.90',
          fulfillment_type: 'local_delivery',
          fulfillment_date: null,
          options: [],
          product_type: 'food',
          surcharges: [],
        },
        {
          product_id: 'prod-2',
          variant_id: 'v2',
          product_title: 'B',
          title: 'B',
          quantity: 1,
          unit_price: '3.00',
          total_price: '3.00',
          line_total: '3.00',
          tax_rate: '0.09',
          tax_amount: '0.27',
          fulfillment_type: 'local_delivery',
          fulfillment_date: null,
          options: [],
          product_type: 'food',
          surcharges: [],
        },
      ],
    });

    const cartItems: CartLineItem[] = [
      {
        id: 'li-1',
        product_id: 'prod-2',
        product_title: 'B',
        quantity: 1,
        unit_price: '3.00',
        line_total: '3.00',
      },
      {
        id: 'li-2',
        product_id: 'prod-1',
        product_title: 'A',
        quantity: 2,
        unit_price: '5.00',
        line_total: '10.00',
      },
    ];

    expect(checkoutFingerprint(checkout)).toBe(cartFingerprint(cartItems));
  });

  it('produces divergent fingerprints when quantities differ', () => {
    const checkout = mockCheckout({
      line_items: [
        {
          product_id: 'prod-1',
          variant_id: 'v1',
          product_title: 'A',
          title: 'A',
          quantity: 3,
          unit_price: '5.00',
          total_price: '15.00',
          line_total: '15.00',
          tax_rate: '0.09',
          tax_amount: '1.35',
          fulfillment_type: 'local_delivery',
          fulfillment_date: null,
          options: [],
          product_type: 'food',
          surcharges: [],
        },
      ],
    });

    const cartItems: CartLineItem[] = [
      {
        id: 'li-1',
        product_id: 'prod-1',
        product_title: 'A',
        quantity: 2,
        unit_price: '5.00',
        line_total: '10.00',
      },
    ];

    expect(checkoutFingerprint(checkout)).not.toBe(cartFingerprint(cartItems));
  });
});

describe('form state persistence', () => {
  beforeEach(() => {
    sessionStorageMock.clear();
    vi.restoreAllMocks();
  });

  const formState: CheckoutFormState = {
    email: 'test@example.com',
    phone: '+31612345678',
    firstName: 'Jan',
    lastName: 'de Vries',
    street: 'Keizersgracht 1',
    city: 'Amsterdam',
    postalCode: '1015 AA',
    countryCode: 'NL',
    fulfillmentMethod: 'delivery',
    pickupLocationId: null,
    schedulingMode: 'asap',
    scheduledDate: null,
    selectedSlotId: null,
    selectedShippingRateId: null,
  };

  it('persists and restores form state', () => {
    persistFormState(formState);
    const restored = restoreFormState();
    expect(restored).toEqual(formState);
  });

  it('returns null when no form state is stored', () => {
    expect(restoreFormState()).toBeNull();
  });

  it('clears form state', () => {
    persistFormState(formState);
    clearFormState();
    expect(restoreFormState()).toBeNull();
  });

  it('returns null when stored JSON is invalid', () => {
    sessionStorageMock.setItem('sous_checkout_form', '{invalid json');
    // Reset the mock to return the raw string
    sessionStorageMock.getItem.mockImplementationOnce(() => '{invalid json');
    expect(restoreFormState()).toBeNull();
  });
});

import {
  $stripePayment,
  $storageAvailable,
  checkStorageAvailable,
} from '@/stores/checkout-payment';

describe('$stripePayment', () => {
  it('starts as null', () => {
    expect($stripePayment.get()).toBeNull();
  });

  it('stores stripe, elements, and clientSecret', () => {
    const mockStripe = { confirmPayment: vi.fn() };
    const mockElements = { getElement: vi.fn() };
    $stripePayment.set({
      stripe: mockStripe as any,
      elements: mockElements as any,
      clientSecret: 'pi_test_secret',
    });
    const val = $stripePayment.get();
    expect(val?.clientSecret).toBe('pi_test_secret');
    expect(val?.stripe).toBe(mockStripe);
    $stripePayment.set(null);
  });
});

describe('$storageAvailable / checkStorageAvailable', () => {
  it('returns true when sessionStorage works', () => {
    expect(checkStorageAvailable()).toBe(true);
    expect($storageAvailable.get()).toBe(true);
  });

  it('returns false when sessionStorage throws', () => {
    const original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, 'sessionStorage', {
      get: () => {
        throw new Error('blocked');
      },
      configurable: true,
    });
    expect(checkStorageAvailable()).toBe(false);
    expect($storageAvailable.get()).toBe(false);
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: original,
      configurable: true,
    });
  });
});
