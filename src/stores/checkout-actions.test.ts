import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { $shippingGroups, $shippingGroupsLoading } from '@/stores/checkout';
import type { ShippingGroup } from '@/types/checkout';

vi.mock('@/lib/api', () => ({
  getClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { $checkout, $checkoutLoading, $checkoutError } from './checkout';
import type { Checkout } from '@/types/checkout';
import {
  createCheckout,
  fetchCheckout,
  patchDelivery,
  cancelPendingPatch,
  completeCheckout,
  ensurePaymentAndComplete,
  initiatePayment,
} from './checkout-actions';

function makeCheckout(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: 'chk-1',
    cart_id: 'cart-1',
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
    line_items: [],
    subtotal: '10.00',
    tax_total: '2.10',
    shipping_cost: '0.00',
    surcharge_total: '0.00',
    display_surcharge_total: '0.00',
    discount_amount: '0.00',
    discount_code: null,
    applied_promotion_id: null,
    promotion_discount_amount: '0.00',
    total: '12.10',
    display_subtotal: '10.00',
    display_tax_total: '2.10',
    display_shipping_cost: '0.00',
    display_discount_amount: '0.00',
    display_promotion_discount_amount: '0.00',
    display_total: '12.10',
    fulfillment_slot_id: null,
    gift_card_details: null,
    order_number: null,
    purpose: 'standard',
    created_at: null,
    updated_at: null,
    available_payment_gateways: null,
    ...overrides,
  };
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    GET: vi.fn().mockResolvedValue({ data: overrides.GET ?? null, error: null }),
    POST: vi.fn().mockResolvedValue({ data: overrides.POST ?? null, error: null }),
    PATCH: vi.fn().mockResolvedValue({ data: overrides.PATCH ?? null, error: null }),
    DELETE: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

describe('createCheckout', () => {
  beforeEach(() => {
    $checkout.set(null);
    $checkoutLoading.set(false);
    $checkoutError.set(null);
    sessionStorage.clear();
  });

  it('creates checkout and stores ID in sessionStorage', async () => {
    const checkout = makeCheckout({ id: 'chk-99' });
    const client = makeClient({ POST: checkout });

    const result = await createCheckout('cart-1', client as any);

    expect(result).toMatchObject({ id: 'chk-99' });
    expect(sessionStorage.getItem('sous_checkout_id')).toBe('chk-99');
    expect($checkout.get()).toMatchObject({ id: 'chk-99' });
    expect(client.POST).toHaveBeenCalledWith(
      '/api/v1/checkout/',
      expect.objectContaining({
        body: { cart_id: 'cart-1' },
      }),
    );
  });

  it('throws on API error', async () => {
    const client = {
      ...makeClient(),
      POST: vi.fn().mockResolvedValue({ data: null, error: new Error('Server error') }),
    };

    await expect(createCheckout('cart-1', client as any)).rejects.toThrow();
  });

  it('sets $checkoutLoading during the request', async () => {
    const loadingStates: boolean[] = [];
    const checkout = makeCheckout();
    const client = {
      ...makeClient(),
      POST: vi.fn().mockImplementation(() => {
        loadingStates.push($checkoutLoading.get());
        return Promise.resolve({ data: checkout, error: null });
      }),
    };

    await createCheckout('cart-1', client as any);
    loadingStates.push($checkoutLoading.get());

    expect(loadingStates).toEqual([true, false]);
  });
});

describe('fetchCheckout', () => {
  beforeEach(() => {
    $checkout.set(null);
    $checkoutLoading.set(false);
    $checkoutError.set(null);
  });

  it('fetches and updates store', async () => {
    const checkout = makeCheckout({ id: 'chk-42', total: '25.00' });
    const client = makeClient({ GET: checkout });

    const result = await fetchCheckout('chk-42', client as any);

    expect(result).toMatchObject({ id: 'chk-42' });
    expect($checkout.get()).toMatchObject({ id: 'chk-42' });
    expect(client.GET).toHaveBeenCalledWith('/api/v1/checkout/{checkout_id}/', {
      params: { path: { checkout_id: 'chk-42' } },
    });
  });

  it('throws on API error', async () => {
    const client = {
      ...makeClient(),
      GET: vi.fn().mockResolvedValue({ data: null, error: new Error('Not found') }),
    };

    await expect(fetchCheckout('chk-42', client as any)).rejects.toThrow();
  });
});

describe('patchDelivery', () => {
  beforeEach(() => {
    $checkout.set(null);
    $checkoutLoading.set(false);
    $checkoutError.set(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces rapid calls', async () => {
    const checkout = makeCheckout({ id: 'chk-1' });
    const client = makeClient({ PATCH: checkout });

    // Fire three rapid calls — only the last should execute
    patchDelivery('chk-1', { email: 'a@a.com' }, client as any);
    patchDelivery('chk-1', { email: 'b@b.com' }, client as any);
    patchDelivery('chk-1', { email: 'c@c.com' }, client as any);

    await vi.advanceTimersByTimeAsync(600);

    // Only one PATCH call should have been made (the last one)
    expect(client.PATCH).toHaveBeenCalledTimes(1);
    expect(client.PATCH).toHaveBeenCalledWith(
      '/api/v1/checkout/{checkout_id}/delivery/',
      expect.objectContaining({
        params: { path: { checkout_id: 'chk-1' } },
        body: { email: 'c@c.com' },
      }),
    );
  });

  it('updates $checkout store on success', async () => {
    const checkout = makeCheckout({ id: 'chk-1', email: 'test@test.com' });
    const client = makeClient({ PATCH: checkout });

    patchDelivery('chk-1', { email: 'test@test.com' }, client as any);
    await vi.advanceTimersByTimeAsync(600);

    expect($checkout.get()).toMatchObject({ id: 'chk-1', email: 'test@test.com' });
  });
});

describe('completeCheckout', () => {
  beforeEach(() => {
    $checkout.set(null);
    $checkoutLoading.set(false);
    $checkoutError.set(null);
    sessionStorage.clear();
  });

  it('completes and clears storage', async () => {
    sessionStorage.setItem('sous_checkout_id', 'chk-1');
    const checkout = makeCheckout({ id: 'chk-1', status: 'completed' });
    const client = makeClient({ POST: checkout });

    const result = await completeCheckout('chk-1', client as any);

    expect(result).toMatchObject({ id: 'chk-1', status: 'completed' });
    expect(sessionStorage.getItem('sous_checkout_id')).toBeNull();
    expect(client.POST).toHaveBeenCalledWith(
      '/api/v1/checkout/{checkout_id}/complete/',
      expect.objectContaining({
        params: { path: { checkout_id: 'chk-1' } },
      }),
    );
  });

  it('throws on API error', async () => {
    const client = {
      ...makeClient(),
      POST: vi.fn().mockResolvedValue({ data: null, error: new Error('fail') }),
    };

    await expect(completeCheckout('chk-1', client as any)).rejects.toThrow();
  });
});

describe('initiatePayment', () => {
  beforeEach(() => {
    $checkout.set(null);
    $checkoutLoading.set(false);
    $checkoutError.set(null);
  });

  it('posts payment with gateway_id stripe', async () => {
    const paymentResult = { ...makeCheckout(), client_secret: 'cs_test_123' };
    const client = makeClient({ POST: paymentResult });

    const result = await initiatePayment('chk-1', client as any);

    expect(result).toMatchObject({ client_secret: 'cs_test_123' });
    expect(client.POST).toHaveBeenCalledWith(
      '/api/v1/checkout/{checkout_id}/payment/',
      expect.objectContaining({
        params: { path: { checkout_id: 'chk-1' } },
        body: { gateway_id: 'stripe' },
      }),
    );
  });
});

describe('ensurePaymentAndComplete', () => {
  beforeEach(() => {
    $checkout.set(null);
    $checkoutLoading.set(false);
    $checkoutError.set(null);
    sessionStorage.clear();
  });

  it('handles "succeeded" status — completes and returns redirect', async () => {
    const checkout = makeCheckout({ id: 'chk-1', status: 'paid' });
    const completedCheckout = makeCheckout({
      id: 'chk-1',
      status: 'completed',
      order_number: 'ORD-1',
    });
    const client = {
      ...makeClient(),
      GET: vi.fn().mockResolvedValue({ data: checkout, error: null }),
      POST: vi.fn().mockResolvedValue({ data: completedCheckout, error: null }),
    };

    const stripe = {
      retrievePaymentIntent: vi.fn().mockResolvedValue({
        paymentIntent: { status: 'succeeded' },
      }),
    };

    const result = await ensurePaymentAndComplete(
      'chk-1',
      'cs_test',
      stripe as any,
      'en',
      client as any,
    );

    expect(result.status).toBe('succeeded');
    expect(result.redirectUrl).toContain('/en/checkout/success');
    expect(sessionStorage.getItem('sous_checkout_id')).toBeNull();
  });

  it('handles "processing" status', async () => {
    const checkout = makeCheckout({ id: 'chk-1', status: 'paid' });
    const client = makeClient({ GET: checkout });

    const stripe = {
      retrievePaymentIntent: vi.fn().mockResolvedValue({
        paymentIntent: { status: 'processing' },
      }),
    };

    const result = await ensurePaymentAndComplete(
      'chk-1',
      'cs_test',
      stripe as any,
      'en',
      client as any,
    );

    expect(result.status).toBe('processing');
  });

  it('handles "requires_action" status', async () => {
    const checkout = makeCheckout({ id: 'chk-1', status: 'paid' });
    const client = makeClient({ GET: checkout });

    const stripe = {
      retrievePaymentIntent: vi.fn().mockResolvedValue({
        paymentIntent: { status: 'requires_action' },
      }),
    };

    const result = await ensurePaymentAndComplete(
      'chk-1',
      'cs_test',
      stripe as any,
      'en',
      client as any,
    );

    expect(result.status).toBe('requires_action');
  });

  it('redirects immediately if checkout already completed', async () => {
    const checkout = makeCheckout({ id: 'chk-1', status: 'completed', order_number: 'ORD-1' });
    const client = makeClient({ GET: checkout });

    const stripe = {
      retrievePaymentIntent: vi.fn(),
    };

    const result = await ensurePaymentAndComplete(
      'chk-1',
      'cs_test',
      stripe as any,
      'en',
      client as any,
    );

    expect(result.status).toBe('succeeded');
    expect(result.redirectUrl).toContain('/en/checkout/success');
    // Stripe should not have been called
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('returns error for unknown payment status', async () => {
    const checkout = makeCheckout({ id: 'chk-1', status: 'paid' });
    const client = makeClient({ GET: checkout });

    const stripe = {
      retrievePaymentIntent: vi.fn().mockResolvedValue({
        paymentIntent: { status: 'canceled' },
      }),
    };

    const result = await ensurePaymentAndComplete(
      'chk-1',
      'cs_test',
      stripe as any,
      'en',
      client as any,
    );

    expect(result.status).toBe('error');
  });
});

describe('patchDelivery network retry', () => {
  beforeEach(() => {
    $checkoutError.set(null);
  });

  it('retries once on network error then succeeds', async () => {
    const failThenSucceed = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ data: { id: 'co_1', status: 'delivery_set' }, error: null });
    const retryClient = { PATCH: failThenSucceed } as any;

    patchDelivery('co_1', { email: 'test@test.com' }, retryClient);
    await new Promise((r) => setTimeout(r, 700));

    expect(failThenSucceed).toHaveBeenCalledTimes(2);
    expect($checkoutError.get()).toBeNull();
  });

  it('sets error after retry also fails', async () => {
    const alwaysFail = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const failClient = { PATCH: alwaysFail } as any;

    patchDelivery('co_1', { email: 'test@test.com' }, failClient);
    await new Promise((r) => setTimeout(r, 700));

    expect(alwaysFail).toHaveBeenCalledTimes(2);
    expect($checkoutError.get()).not.toBeNull();
  });
});

describe('cancelPendingPatch', () => {
  it('is exported as a function', () => {
    expect(typeof cancelPendingPatch).toBe('function');
  });

  it('cancels a pending debounced PATCH', async () => {
    const mockPatch = vi
      .fn()
      .mockResolvedValue({ data: { id: 'co_1', status: 'delivery_set' }, error: null });
    const client = { PATCH: mockPatch } as any;

    patchDelivery('test-checkout-id', { email: 'test@test.com' }, client);
    cancelPendingPatch();
    await new Promise((r) => setTimeout(r, 600));

    expect(mockPatch).not.toHaveBeenCalled();
  });
});

describe('fetchShippingGroups', () => {
  beforeEach(() => {
    $shippingGroups.set([]);
    $shippingGroupsLoading.set(false);
  });

  it('fetches shipping groups and stores them', async () => {
    const mockGroups: ShippingGroup[] = [
      {
        id: 'grp-1',
        merchant_shipping_provider_id: 1,
        shipping_cost: '5.00',
        selected_rate_id: null,
        is_digital: false,
        available_rates: [
          {
            id: 'rate-1',
            name: 'Local Delivery',
            cost: '5.00',
            original_cost: '5.00',
            rate_id: 'local_delivery',
            expires_at: null,
          },
          {
            id: 'rate-2',
            name: 'Uber Direct',
            cost: '6.00',
            original_cost: '6.00',
            rate_id: 'dqt_abc123',
            expires_at: '2026-03-29T15:15:00Z',
          },
        ],
        line_items: [],
      },
    ];

    const mockClient = {
      GET: vi.fn().mockResolvedValue({ data: mockGroups, error: null }),
    };

    const { fetchShippingGroups } = await import('./checkout-actions');
    const groups = await fetchShippingGroups('chk-1', mockClient as any);

    expect(mockClient.GET).toHaveBeenCalledWith('/api/v1/checkout/{checkout_id}/shipping-groups/', {
      params: { path: { checkout_id: 'chk-1' } },
    });
    expect(groups).toEqual(mockGroups);
    expect($shippingGroups.get()).toEqual(mockGroups);
    expect($shippingGroupsLoading.get()).toBe(false);
  });

  it('returns empty array on error', async () => {
    const mockClient = {
      GET: vi.fn().mockResolvedValue({ data: null, error: { status: 500, statusText: 'Error' } }),
    };

    const { fetchShippingGroups } = await import('./checkout-actions');
    const groups = await fetchShippingGroups('chk-1', mockClient as any);

    expect(groups).toEqual([]);
    expect($shippingGroups.get()).toEqual([]);
  });
});

describe('selectShippingRate', () => {
  beforeEach(() => {
    $shippingGroups.set([]);
  });

  it('calls select-rate endpoint and returns success', async () => {
    const mockClient = {
      POST: vi.fn().mockResolvedValue({ data: { status: 'ok' }, error: null }),
    };

    const { selectShippingRate } = await import('./checkout-actions');
    const result = await selectShippingRate('chk-1', 'grp-1', 'rate-1', mockClient as any);

    expect(mockClient.POST).toHaveBeenCalledWith(
      '/api/v1/checkout/{checkout_id}/shipping-groups/select-rate/',
      {
        params: { path: { checkout_id: 'chk-1' } },
        body: { group_id: 'grp-1', rate_id: 'rate-1' },
      },
    );
    expect(result).toEqual({ ok: true, expired: false });
  });

  it('returns expired=true on 410 response', async () => {
    const mockClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 410, statusText: 'Gone', body: { code: 'shipping_rate_expired' } },
      }),
    };

    const { selectShippingRate } = await import('./checkout-actions');
    const result = await selectShippingRate('chk-1', 'grp-1', 'rate-1', mockClient as any);

    expect(result).toEqual({ ok: false, expired: true });
  });

  it('returns ok=false on other errors', async () => {
    const mockClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 500, statusText: 'Server Error' },
      }),
    };

    const { selectShippingRate } = await import('./checkout-actions');
    const result = await selectShippingRate('chk-1', 'grp-1', 'rate-1', mockClient as any);

    expect(result).toEqual({ ok: false, expired: false });
  });
});
