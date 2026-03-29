import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act, waitFor } from '@testing-library/preact';
import { $checkout, $shippingGroups, $shippingGroupsLoading } from '@/stores/checkout';
import type { CheckoutFormState } from '@/types/checkout';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockPatchDelivery = vi.fn();
const mockCancelPendingPatch = vi.fn();
const mockFetchShippingGroups = vi.fn().mockResolvedValue([]);
const mockSelectShippingRate = vi.fn().mockResolvedValue({ ok: true, expired: false });
const mockFetchCheckout = vi.fn().mockResolvedValue({});

vi.mock('@/stores/checkout-actions', () => ({
  patchDelivery: (...args: unknown[]) => mockPatchDelivery(...args),
  cancelPendingPatch: () => mockCancelPendingPatch(),
  fetchShippingGroups: (...args: unknown[]) => mockFetchShippingGroups(...args),
  selectShippingRate: (...args: unknown[]) => mockSelectShippingRate(...args),
  fetchCheckout: (...args: unknown[]) => mockFetchCheckout(...args),
}));

vi.mock('@/stores/toast', () => ({
  showToast: vi.fn(),
}));

const mockGET = vi.fn().mockResolvedValue({ data: [] });
vi.mock('@/lib/api', () => ({
  getClient: () => ({ GET: mockGET }),
}));

vi.mock('@/lib/logger', () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@/i18n/client', () => ({
  t: (key: string) => key,
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function defaultForm(overrides: Partial<CheckoutFormState> = {}): CheckoutFormState {
  return {
    email: '',
    phone: '',
    firstName: '',
    lastName: '',
    street: '',
    city: '',
    postalCode: '',
    countryCode: 'NL',
    fulfillmentMethod: 'delivery',
    pickupLocationId: null,
    schedulingMode: 'asap',
    scheduledDate: null,
    selectedSlotId: null,
    selectedShippingRateId: null,
    ...overrides,
  };
}

function completeContactForm(overrides: Partial<CheckoutFormState> = {}): CheckoutFormState {
  return defaultForm({
    email: 'test@example.com',
    firstName: 'John',
    lastName: 'Doe',
    phone: '+31612345678',
    street: 'Main St 1',
    city: 'Amsterdam',
    postalCode: '1012AB',
    ...overrides,
  });
}

const defaultProps = () => ({
  lang: 'en' as const,
  form: defaultForm(),
  dispatch: vi.fn(),
  formErrors: {},
  setFormErrors: vi.fn(),
  checkoutId: 'co_test',
  merchantSlug: 'test-merchant',
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('CheckoutFormOrchestrator', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    $checkout.set(null);
    $shippingGroups.set([]);
    $shippingGroupsLoading.set(false);
    mockGET.mockResolvedValue({ data: [] });
    mockFetchShippingGroups.mockResolvedValue([]);
    mockSelectShippingRate.mockResolvedValue({ ok: true, expired: false });
    mockFetchCheckout.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  async function renderOrchestrator(overrides: Partial<ReturnType<typeof defaultProps>> = {}) {
    const { default: CheckoutFormOrchestrator } = await import('./CheckoutFormOrchestrator');
    const props = { ...defaultProps(), ...overrides };
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<CheckoutFormOrchestrator {...props} />);
    });
    return { ...result!, props };
  }

  /* -- 1. Renders form sub-components ------------------------------- */

  describe('renders sub-components', () => {
    it('always renders ContactForm', async () => {
      const { container } = await renderOrchestrator();
      // ContactForm renders inputs with name="email", name="firstName", etc.
      expect(container.querySelector('input[name="email"]')).toBeTruthy();
      expect(container.querySelector('input[name="firstName"]')).toBeTruthy();
    });

    it('renders FulfillmentToggle when available fulfillment methods exist', async () => {
      const { container } = await renderOrchestrator();
      await waitFor(() => {
        expect(container.textContent).toContain('delivery');
      });
    });

    it('renders DeliveryAddressForm when fulfillmentMethod is delivery', async () => {
      const { container } = await renderOrchestrator({
        form: defaultForm({ fulfillmentMethod: 'delivery' }),
      });
      await waitFor(() => {
        expect(container.querySelector('#checkout-street')).toBeTruthy();
        expect(container.querySelector('#checkout-city')).toBeTruthy();
      });
    });

    it('renders PickupLocationPicker when fulfillmentMethod is pickup and locations exist', async () => {
      const pickupLocs = [
        { id: 1, name: 'Location A' },
        { id: 2, name: 'Location B' },
      ];
      mockGET.mockImplementation((path: string) => {
        if (path === '/api/v1/pickup-locations/') {
          return Promise.resolve({ data: pickupLocs });
        }
        return Promise.resolve({ data: [] });
      });

      const { container } = await renderOrchestrator({
        form: defaultForm({ fulfillmentMethod: 'pickup' }),
      });

      await waitFor(() => {
        expect(container.textContent).toContain('Location A');
      });
    });

    it('does NOT render DeliveryAddressForm when fulfillmentMethod is pickup', async () => {
      mockGET.mockImplementation((path: string) => {
        if (path === '/api/v1/pickup-locations/') {
          return Promise.resolve({ data: [{ id: 1, name: 'Loc' }] });
        }
        return Promise.resolve({ data: [] });
      });

      const { container } = await renderOrchestrator({
        form: defaultForm({ fulfillmentMethod: 'pickup' }),
      });

      await waitFor(() => {
        expect(container.textContent).toContain('Loc');
      });

      expect(container.querySelector('#checkout-street')).toBeFalsy();
    });

    it('always renders SchedulingPicker', async () => {
      const { container } = await renderOrchestrator();
      await waitFor(() => {
        expect(container.textContent).toContain('asap');
      });
    });
  });

  /* -- 2. Fulfillment derivation ------------------------------------ */

  describe('fulfillment derivation', () => {
    it('delivery is always available even without pickup locations', async () => {
      mockGET.mockResolvedValue({ data: [] });
      const { container } = await renderOrchestrator();
      await waitFor(() => {
        expect(container.textContent).toContain('delivery');
      });
    });

    it('pickup becomes available when pickup locations exist', async () => {
      mockGET.mockImplementation((path: string) => {
        if (path === '/api/v1/pickup-locations/') {
          return Promise.resolve({ data: [{ id: 1, name: 'Store 1' }] });
        }
        return Promise.resolve({ data: [] });
      });

      const { container } = await renderOrchestrator();
      await waitFor(() => {
        expect(container.textContent).toContain('pickup');
      });
    });

    it('auto-selects single pickup location', async () => {
      const dispatch = vi.fn();
      mockGET.mockImplementation((path: string) => {
        if (path === '/api/v1/pickup-locations/') {
          return Promise.resolve({ data: [{ id: 42, name: 'Only Store' }] });
        }
        return Promise.resolve({ data: [] });
      });

      await renderOrchestrator({ dispatch });

      await waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith({
          type: 'SET_FIELD',
          field: 'pickupLocationId',
          value: 42,
        });
      });
    });
  });

  /* -- 3. fulfillment_type mapping ---------------------------------- */

  describe('fulfillment_type mapping', () => {
    it('maps delivery to local_delivery in PATCH payload', async () => {
      const form = completeContactForm({ fulfillmentMethod: 'delivery' });
      const { container } = await renderOrchestrator({ form });

      const emailInput = container.querySelector('input[name="email"]')!;
      await act(async () => {
        fireEvent.blur(emailInput);
      });

      await waitFor(() => {
        expect(mockPatchDelivery).toHaveBeenCalled();
      });

      const patchCall = mockPatchDelivery.mock.calls[0];
      expect(patchCall[0]).toBe('co_test');
      expect(patchCall[1]).toMatchObject({
        fulfillment_type: 'local_delivery',
      });
    });

    it('maps pickup to pickup in PATCH payload', async () => {
      mockGET.mockImplementation((path: string) => {
        if (path === '/api/v1/pickup-locations/') {
          return Promise.resolve({ data: [{ id: 5, name: 'Store' }] });
        }
        return Promise.resolve({ data: [] });
      });

      const form = completeContactForm({
        fulfillmentMethod: 'pickup',
        pickupLocationId: 5,
      });

      const { container } = await renderOrchestrator({ form });

      const emailInput = container.querySelector('input[name="email"]')!;
      await act(async () => {
        fireEvent.blur(emailInput);
      });

      await waitFor(() => {
        expect(mockPatchDelivery).toHaveBeenCalled();
      });

      const patchCall = mockPatchDelivery.mock.calls[0];
      expect(patchCall[1]).toMatchObject({
        fulfillment_type: 'pickup',
        pickup_location_id: 5,
      });
    });

    it('includes shipping_address for delivery', async () => {
      const form = completeContactForm({ fulfillmentMethod: 'delivery' });
      const { container } = await renderOrchestrator({ form });

      const emailInput = container.querySelector('input[name="email"]')!;
      await act(async () => {
        fireEvent.blur(emailInput);
      });

      await waitFor(() => {
        expect(mockPatchDelivery).toHaveBeenCalled();
      });

      const payload = mockPatchDelivery.mock.calls[0][1];
      expect(payload.shipping_address).toBeDefined();
      expect(payload.shipping_address).toMatchObject({
        street_address_1: 'Main St 1',
        city: 'Amsterdam',
        postal_code: '1012AB',
        country_code: 'NL',
      });
    });
  });

  /* -- 4. cancelPendingPatch on unmount ----------------------------- */

  describe('cleanup on unmount', () => {
    it('calls cancelPendingPatch when component unmounts', async () => {
      const { default: CheckoutFormOrchestrator } = await import('./CheckoutFormOrchestrator');
      const props = defaultProps();

      let result: ReturnType<typeof render>;
      await act(async () => {
        result = render(<CheckoutFormOrchestrator {...props} />);
      });

      expect(mockCancelPendingPatch).not.toHaveBeenCalled();

      result!.unmount();

      expect(mockCancelPendingPatch).toHaveBeenCalledTimes(1);
    });
  });

  /* -- 5. Blur triggers PATCH --------------------------------------- */

  describe('blur triggers PATCH', () => {
    it('patches when contact info is complete and valid on blur', async () => {
      const form = completeContactForm();
      const { container } = await renderOrchestrator({ form });

      const phoneInput = container.querySelector('input[name="phone"]')!;
      await act(async () => {
        fireEvent.blur(phoneInput);
      });

      await waitFor(() => {
        expect(mockPatchDelivery).toHaveBeenCalledWith(
          'co_test',
          expect.objectContaining({
            email: 'test@example.com',
            first_name: 'John',
            last_name: 'Doe',
            phone_number: '+31612345678',
            fulfillment_type: 'local_delivery',
          }),
        );
      });
    });

    it('includes fulfillment_slot_id when scheduled with valid UUID', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const form = completeContactForm({
        schedulingMode: 'scheduled',
        selectedSlotId: uuid,
      });

      const { container } = await renderOrchestrator({ form });

      const emailInput = container.querySelector('input[name="email"]')!;
      await act(async () => {
        fireEvent.blur(emailInput);
      });

      await waitFor(() => {
        expect(mockPatchDelivery).toHaveBeenCalled();
      });

      const payload = mockPatchDelivery.mock.calls[0][1];
      expect(payload.fulfillment_slot_id).toBe(uuid);
    });

    it('does NOT include fulfillment_slot_id when slot is not a UUID', async () => {
      const form = completeContactForm({
        schedulingMode: 'scheduled',
        selectedSlotId: '10:00-11:00',
      });

      const { container } = await renderOrchestrator({ form });

      const emailInput = container.querySelector('input[name="email"]')!;
      await act(async () => {
        fireEvent.blur(emailInput);
      });

      await waitFor(() => {
        expect(mockPatchDelivery).toHaveBeenCalled();
      });

      const payload = mockPatchDelivery.mock.calls[0][1];
      expect(payload.fulfillment_slot_id).toBeUndefined();
    });
  });

  /* -- 6. Incomplete contact info prevents PATCH -------------------- */

  describe('incomplete contact prevents PATCH', () => {
    it('does NOT patch when email is missing', async () => {
      const form = completeContactForm({ email: '' });
      const { container } = await renderOrchestrator({ form });

      const phoneInput = container.querySelector('input[name="phone"]')!;
      await act(async () => {
        fireEvent.blur(phoneInput);
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(mockPatchDelivery).not.toHaveBeenCalled();
    });

    it('does NOT patch when email is invalid', async () => {
      const form = completeContactForm({ email: 'not-an-email' });
      const { container } = await renderOrchestrator({ form });

      const phoneInput = container.querySelector('input[name="phone"]')!;
      await act(async () => {
        fireEvent.blur(phoneInput);
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(mockPatchDelivery).not.toHaveBeenCalled();
    });

    it('does NOT patch when firstName is missing', async () => {
      const form = completeContactForm({ firstName: '' });
      const { container } = await renderOrchestrator({ form });

      const emailInput = container.querySelector('input[name="email"]')!;
      await act(async () => {
        fireEvent.blur(emailInput);
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(mockPatchDelivery).not.toHaveBeenCalled();
    });

    it('does NOT patch when lastName is missing', async () => {
      const form = completeContactForm({ lastName: '' });
      const { container } = await renderOrchestrator({ form });

      const emailInput = container.querySelector('input[name="email"]')!;
      await act(async () => {
        fireEvent.blur(emailInput);
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(mockPatchDelivery).not.toHaveBeenCalled();
    });

    it('does NOT patch when phone is missing', async () => {
      const form = completeContactForm({ phone: '' });
      const { container } = await renderOrchestrator({ form });

      const emailInput = container.querySelector('input[name="email"]')!;
      await act(async () => {
        fireEvent.blur(emailInput);
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(mockPatchDelivery).not.toHaveBeenCalled();
    });

    it('does NOT patch when checkoutId is undefined', async () => {
      const form = completeContactForm();
      const { container } = await renderOrchestrator({ form, checkoutId: undefined });

      const emailInput = container.querySelector('input[name="email"]')!;
      await act(async () => {
        fireEvent.blur(emailInput);
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(mockPatchDelivery).not.toHaveBeenCalled();
    });

    it('does NOT patch delivery mode when address is incomplete', async () => {
      const form = completeContactForm({ street: '', fulfillmentMethod: 'delivery' });
      const { container } = await renderOrchestrator({ form });

      const emailInput = container.querySelector('input[name="email"]')!;
      await act(async () => {
        fireEvent.blur(emailInput);
      });

      await new Promise((r) => setTimeout(r, 50));
      expect(mockPatchDelivery).not.toHaveBeenCalled();
    });

    it('sets form errors when email is invalid on blur', async () => {
      const setFormErrors = vi.fn();
      const form = completeContactForm({ email: 'bad-email' });
      const { container } = await renderOrchestrator({ form, setFormErrors });

      const emailInput = container.querySelector('input[name="email"]')!;
      await act(async () => {
        fireEvent.blur(emailInput);
      });

      expect(setFormErrors).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'emailInvalid' }),
      );
    });
  });

  /* -- 7. Shipping rate selection ----------------------------------- */

  describe('shipping rate selection', () => {
    it('fetches shipping groups when checkout status becomes delivery_set', async () => {
      $checkout.set({
        id: 'co_test',
        status: 'delivery_set',
        cart_id: 'cart-1',
        merchant_id: 1,
        channel_id: null,
        currency: 'EUR',
        display_currency: 'EUR',
        fx_rate_to_display: '1.00',
        email: 'test@example.com',
        shipping_address: {
          first_name: 'J',
          last_name: 'D',
          street_address_1: 'St 1',
          city: 'A',
          postal_code: '1012AB',
          country_code: 'NL',
        },
        billing_address: null,
        shipping_method: null,
        payment_method: null,
        payment_status: null,
        line_items: [],
        subtotal: '10.00',
        tax_total: '0.83',
        shipping_cost: '0.00',
        surcharge_total: '0.00',
        display_surcharge_total: '0.00',
        discount_amount: '0.00',
        discount_code: null,
        applied_promotion_id: null,
        promotion_discount_amount: '0.00',
        total: '10.00',
        display_subtotal: '€ 10,00',
        display_tax_total: '€ 0,83',
        display_shipping_cost: '€ 0,00',
        display_discount_amount: '€ 0,00',
        display_promotion_discount_amount: '€ 0,00',
        display_total: '€ 10,00',
        fulfillment_slot_id: null,
        gift_card_details: null,
        order_number: null,
        purpose: 'standard',
        created_at: null,
        updated_at: null,
        available_payment_gateways: null,
      } as any);

      await renderOrchestrator();

      await waitFor(() => {
        expect(mockFetchShippingGroups).toHaveBeenCalledWith('co_test');
      });
    });
  });
});
