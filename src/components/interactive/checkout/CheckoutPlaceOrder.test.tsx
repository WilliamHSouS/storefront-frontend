import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { atom } from 'nanostores';
import type { CheckoutFormState } from '@/types/checkout';
import type { Checkout } from '@/types/checkout';

// ── Mock stores ─────────────────────────────────────────────────────────────

const $checkout = atom<Checkout | null>(null);
const $checkoutLoading = atom(false);
const $checkoutError = atom<string | null>(null);
const $checkoutTotals = atom({ subtotal: '10.00', shipping: '0.00', tax: '0.00', total: '10.00' });
const persistFormState = vi.fn();

vi.mock('@/stores/checkout', () => ({
  $checkout,
  $checkoutLoading,
  $checkoutError,
  $checkoutTotals,
  persistFormState,
}));

const completeCheckout = vi.fn();
const ensurePaymentAndComplete = vi.fn();

vi.mock('@/stores/checkout-actions', () => ({
  completeCheckout,
  ensurePaymentAndComplete,
}));

const $stripePayment = atom<unknown>(null);

vi.mock('@/stores/checkout-payment', () => ({
  $stripePayment,
}));

const $cartTotal = atom('10.00');

vi.mock('@/stores/cart', () => ({
  $cartTotal,
}));

vi.mock('@/lib/currency', () => ({
  formatPrice: (amount: string, _currency: string, _locale: string) => `€${amount}`,
  langToLocale: () => 'nl-NL',
}));

vi.mock('@/i18n/client', () => ({
  t: (key: string) => key,
}));

vi.mock('@/lib/logger', () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function defaultForm(overrides: Partial<CheckoutFormState> = {}): CheckoutFormState {
  return {
    email: 'test@example.com',
    phone: '+31612345678',
    firstName: 'John',
    lastName: 'Doe',
    street: 'Main St 1',
    city: 'Amsterdam',
    postalCode: '1234AB',
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

function emptyForm(overrides: Partial<CheckoutFormState> = {}): CheckoutFormState {
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

function makeCheckout(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: 'chk-1',
    cart_id: 'cart-1',
    merchant_id: 1,
    channel_id: null,
    status: 'delivery_set',
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
    tax_total: '0.00',
    shipping_cost: '0.00',
    surcharge_total: '0.00',
    display_surcharge_total: '0.00',
    discount_amount: '0.00',
    discount_code: null,
    applied_promotion_id: null,
    promotion_discount_amount: '0.00',
    total: '10.00',
    display_subtotal: '10.00',
    display_tax_total: '0.00',
    display_shipping_cost: '0.00',
    display_discount_amount: '0.00',
    display_promotion_discount_amount: '0.00',
    display_total: '10.00',
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

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CheckoutPlaceOrder', () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- dynamic import requires runtime typeof
  let CheckoutPlaceOrder: (typeof import('./CheckoutPlaceOrder'))['default'];

  beforeEach(async () => {
    cleanup();
    vi.clearAllMocks();
    $checkout.set(null);
    $checkoutLoading.set(false);
    $checkoutError.set(null);
    $cartTotal.set('10.00');
    $stripePayment.set(null);
    // Dynamic import to get fresh module after mocks
    const mod = await import('./CheckoutPlaceOrder');
    CheckoutPlaceOrder = mod.default;
  });

  afterEach(() => {
    cleanup();
    $checkout.set(null);
    $checkoutLoading.set(false);
    $checkoutError.set(null);
    $cartTotal.set('10.00');
    $stripePayment.set(null);
  });

  // ── Rendering ───────────────────────────────────────────────────────────

  it('renders desktop button and PlaceOrderButton', () => {
    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={defaultForm()}
        setFormErrors={setFormErrors}
      />,
    );
    // Desktop button with data-place-order attribute
    const placeOrderElements = container.querySelectorAll('[data-place-order]');
    expect(placeOrderElements.length).toBeGreaterThanOrEqual(2);
  });

  it('shows order total in button text', () => {
    $cartTotal.set('25.50');
    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={defaultForm()}
        setFormErrors={setFormErrors}
      />,
    );
    // Desktop button should contain formatted price
    const desktopBtn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    expect(desktopBtn?.textContent).toContain('€25.50');
  });

  // ── Form validation ─────────────────────────────────────────────────────

  it('validates missing email', async () => {
    $checkout.set(makeCheckout());
    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={emptyForm({
          phone: '123',
          firstName: 'A',
          lastName: 'B',
          street: 'S',
          city: 'C',
          postalCode: '1234',
        })}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);
    expect(setFormErrors).toHaveBeenCalledWith(
      expect.objectContaining({ email: expect.any(String) }),
    );
  });

  it('validates invalid email format', async () => {
    $checkout.set(makeCheckout());
    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={emptyForm({
          email: 'not-an-email',
          phone: '123',
          firstName: 'A',
          lastName: 'B',
          street: 'S',
          city: 'C',
          postalCode: '1234',
        })}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);
    expect(setFormErrors).toHaveBeenCalledWith(
      expect.objectContaining({ email: expect.any(String) }),
    );
  });

  it('validates missing phone', async () => {
    $checkout.set(makeCheckout());
    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={emptyForm({
          email: 'a@b.com',
          firstName: 'A',
          lastName: 'B',
          street: 'S',
          city: 'C',
          postalCode: '1234',
        })}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);
    expect(setFormErrors).toHaveBeenCalledWith(
      expect.objectContaining({ phone: expect.any(String) }),
    );
  });

  it('validates missing firstName and lastName', async () => {
    $checkout.set(makeCheckout());
    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={emptyForm({
          email: 'a@b.com',
          phone: '123',
          street: 'S',
          city: 'C',
          postalCode: '1234',
        })}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);
    expect(setFormErrors).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: expect.any(String),
        lastName: expect.any(String),
      }),
    );
  });

  it('validates missing address fields for delivery', async () => {
    $checkout.set(makeCheckout());
    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={emptyForm({
          email: 'a@b.com',
          phone: '123',
          firstName: 'A',
          lastName: 'B',
          fulfillmentMethod: 'delivery',
        })}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);
    expect(setFormErrors).toHaveBeenCalledWith(
      expect.objectContaining({
        street: expect.any(String),
        city: expect.any(String),
        postalCode: expect.any(String),
      }),
    );
  });

  it('skips address validation for pickup', async () => {
    $checkout.set(makeCheckout());
    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={emptyForm({
          email: 'a@b.com',
          phone: '123',
          firstName: 'A',
          lastName: 'B',
          fulfillmentMethod: 'pickup',
        })}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);
    // Should pass validation (no errors) — empty errors object
    expect(setFormErrors).toHaveBeenCalledWith({});
  });

  // ── Validation prevents submission ──────────────────────────────────────

  it('does not call completeCheckout or ensurePaymentAndComplete when form is invalid', async () => {
    $checkout.set(makeCheckout());
    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={emptyForm()}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);
    expect(completeCheckout).not.toHaveBeenCalled();
    expect(ensurePaymentAndComplete).not.toHaveBeenCalled();
  });

  // ── Error scroll ────────────────────────────────────────────────────────

  it('calls scrollIntoView on error element when validation fails', async () => {
    $checkout.set(makeCheckout());
    const setFormErrors = vi.fn();
    const scrollMock = vi.fn();

    // When setFormErrors is called, create a role="alert" element to simulate error rendering
    // The component queries the DOM for [role="alert"] after calling setFormErrors
    const alertEl = document.createElement('div');
    alertEl.setAttribute('role', 'alert');
    alertEl.scrollIntoView = scrollMock;
    document.body.appendChild(alertEl);

    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={emptyForm()}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);
    expect(scrollMock).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });

    document.body.removeChild(alertEl);
  });

  // ── Successful Stripe payment flow ──────────────────────────────────────

  it('calls ensurePaymentAndComplete after successful Stripe confirmPayment', async () => {
    $checkout.set(makeCheckout());
    const mockStripe = {
      confirmPayment: vi.fn().mockResolvedValue({}),
    };
    const mockElements = {};
    $stripePayment.set({
      stripe: mockStripe,
      elements: mockElements,
      clientSecret: 'pi_secret_123',
    });

    ensurePaymentAndComplete.mockResolvedValue({
      status: 'succeeded',
      redirectUrl: '/en/checkout/success',
    });

    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={defaultForm()}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);

    // Wait for async operations
    await vi.waitFor(() => {
      expect(mockStripe.confirmPayment).toHaveBeenCalledWith({
        elements: mockElements,
        confirmParams: {
          return_url: expect.stringContaining('/en/checkout/success'),
        },
        redirect: 'if_required',
      });
    });

    await vi.waitFor(() => {
      expect(ensurePaymentAndComplete).toHaveBeenCalledWith(
        'chk-1',
        'pi_secret_123',
        mockStripe,
        'en',
      );
    });
  });

  // ── Stripe payment error ────────────────────────────────────────────────

  it('sets $checkoutError when Stripe confirmPayment returns error', async () => {
    $checkout.set(makeCheckout());
    const mockStripe = {
      confirmPayment: vi.fn().mockResolvedValue({
        error: { message: 'Card declined' },
      }),
    };
    $stripePayment.set({
      stripe: mockStripe,
      elements: {},
      clientSecret: 'pi_secret_123',
    });

    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={defaultForm()}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);

    await vi.waitFor(() => {
      expect($checkoutError.get()).toBe('Card declined');
    });
    expect(ensurePaymentAndComplete).not.toHaveBeenCalled();
  });

  // ── Fallback to completeCheckout ────────────────────────────────────────

  it('calls completeCheckout directly when $stripePayment is null', async () => {
    $checkout.set(makeCheckout());
    $stripePayment.set(null);
    completeCheckout.mockResolvedValue({ order_number: 'ORD-123' });

    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={defaultForm()}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);

    await vi.waitFor(() => {
      expect(completeCheckout).toHaveBeenCalledWith('chk-1');
    });
    expect(ensurePaymentAndComplete).not.toHaveBeenCalled();
  });

  // ── Button disabled during loading ──────────────────────────────────────

  it('disables button when checkoutLoading is true', () => {
    $checkoutLoading.set(true);
    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={defaultForm()}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  // ── persistFormState called on valid submission ─────────────────────────

  it('calls persistFormState on valid form submission', async () => {
    $checkout.set(makeCheckout());
    completeCheckout.mockResolvedValue({ order_number: 'ORD-1' });

    const form = defaultForm();
    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder lang="en" currency="EUR" form={form} setFormErrors={setFormErrors} />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);

    await vi.waitFor(() => {
      expect(persistFormState).toHaveBeenCalledWith(form);
    });
  });

  // ── Error from completeCheckout sets $checkoutError ─────────────────────

  it('sets $checkoutError when completeCheckout throws', async () => {
    $checkout.set(makeCheckout());
    $stripePayment.set(null);
    completeCheckout.mockRejectedValue(new Error('Server error'));

    const setFormErrors = vi.fn();
    const { container } = render(
      <CheckoutPlaceOrder
        lang="en"
        currency="EUR"
        form={defaultForm()}
        setFormErrors={setFormErrors}
      />,
    );
    const btn = container.querySelector('.hidden.md\\:block button') as HTMLButtonElement;
    await fireEvent.click(btn);

    await vi.waitFor(() => {
      expect($checkoutError.get()).toBe('Server error');
    });
  });
});
