import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/preact';
import { $checkout, $checkoutError } from '@/stores/checkout';
import { $stripePayment } from '@/stores/checkout-payment';
import type { Checkout, PaymentGatewayConfig } from '@/types/checkout';
import type { CheckoutFormState } from '@/types/checkout';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockLoadStripe = vi.fn().mockResolvedValue({ fake: 'stripe' });
vi.mock('@/lib/stripe-loader', () => ({
  loadStripe: (...args: unknown[]) => mockLoadStripe(...args),
}));

const mockInitiatePayment = vi.fn();
vi.mock('@/stores/checkout-actions', () => ({
  initiatePayment: (...args: unknown[]) => mockInitiatePayment(...args),
}));

vi.mock('@/lib/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getClient: vi.fn(),
}));

// Mock lazy-loaded StripePaymentForm — renders immediately and calls onStripeReady
vi.mock('./StripePaymentForm', () => ({
  StripePaymentForm: (props: {
    onStripeReady?: (stripe: unknown, elements: unknown) => void;
    onError?: (msg: string) => void;
    clientSecret: string;
  }) => {
    // Auto-fire onStripeReady on mount via a microtask
    if (props.onStripeReady) {
      // Use queueMicrotask to simulate async mount
      queueMicrotask(() => props.onStripeReady!({ id: 'mock-stripe' }, { id: 'mock-elements' }));
    }
    return <div data-testid="stripe-payment-form">StripePaymentForm</div>;
  },
}));

// Mock ExpressCheckout
vi.mock('./ExpressCheckout', () => ({
  default: () => <div data-testid="express-checkout">ExpressCheckout</div>,
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const stripeGateway: PaymentGatewayConfig = {
  id: 'stripe',
  name: 'Stripe',
  type: 'stripe',
  config: {
    publishable_key: 'pk_test_123',
    stripe_account: 'acct_test_456',
  },
};

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

function defaultForm(): CheckoutFormState {
  return {
    email: 'test@example.com',
    phone: '+31612345678',
    firstName: 'John',
    lastName: 'Doe',
    street: '123 Main St',
    city: 'Amsterdam',
    postalCode: '1012AB',
    countryCode: 'NL',
    fulfillmentMethod: 'delivery',
    pickupLocationId: null,
    schedulingMode: 'asap',
    scheduledDate: null,
    selectedSlotId: null,
    selectedShippingRateId: null,
  };
}

const defaultProps = {
  lang: 'en' as const,
  form: defaultForm(),
  currency: 'EUR',
  cartId: 'cart-1',
  cartTotal: '25.00',
  merchantName: 'Test Restaurant',
  merchantTheme: { primary: 'hsl(0 0% 0%)', background: 'hsl(0 0% 100%)' },
};

/* ------------------------------------------------------------------ */
/*  Import component (after mocks are set up)                          */
/* ------------------------------------------------------------------ */

import CheckoutPaymentSection from './CheckoutPaymentSection';

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('CheckoutPaymentSection', () => {
  beforeEach(() => {
    cleanup();
    $checkout.set(null);
    $checkoutError.set(null);
    $stripePayment.set(null);
    mockLoadStripe.mockReset().mockResolvedValue({ fake: 'stripe' });
    // Default: resolve with no client_secret (safe no-op for tests that don't care about payment)
    mockInitiatePayment.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    $checkout.set(null);
    $checkoutError.set(null);
    $stripePayment.set(null);
  });

  /* ── Stripe.js preload ───────────────────────────────────────────── */

  describe('Stripe.js preload', () => {
    it('calls loadStripe with publishable_key and stripeAccount when gateways are available', async () => {
      mockInitiatePayment.mockResolvedValue({ client_secret: 'cs_test' });
      $checkout.set(
        makeCheckout({
          available_payment_gateways: [stripeGateway],
        }),
      );

      render(<CheckoutPaymentSection {...defaultProps} />);

      await waitFor(() => {
        expect(mockLoadStripe).toHaveBeenCalledWith('pk_test_123', {
          stripeAccount: 'acct_test_456',
        });
      });
    });

    it('does not call loadStripe when no gateways are available', () => {
      $checkout.set(makeCheckout({ available_payment_gateways: null }));
      render(<CheckoutPaymentSection {...defaultProps} />);
      expect(mockLoadStripe).not.toHaveBeenCalled();
    });

    it('does not call loadStripe when no stripe gateway exists', () => {
      $checkout.set(
        makeCheckout({
          available_payment_gateways: [
            { id: 'paypal', name: 'PayPal', type: 'paypal', config: {} },
          ],
        }),
      );
      render(<CheckoutPaymentSection {...defaultProps} />);
      expect(mockLoadStripe).not.toHaveBeenCalled();
    });

    it('does not call loadStripe when publishable_key is empty', () => {
      $checkout.set(
        makeCheckout({
          available_payment_gateways: [
            {
              ...stripeGateway,
              config: { publishable_key: '', stripe_account: 'acct_test' },
            },
          ],
        }),
      );
      render(<CheckoutPaymentSection {...defaultProps} />);
      expect(mockLoadStripe).not.toHaveBeenCalled();
    });
  });

  /* ── Payment initiation ──────────────────────────────────────────── */

  describe('payment initiation', () => {
    it('calls initiatePayment when checkout has id and gateways', async () => {
      mockInitiatePayment.mockResolvedValue({ client_secret: 'cs_test_abc' });

      $checkout.set(
        makeCheckout({
          id: 'chk-42',
          status: 'delivery_set',
          available_payment_gateways: [stripeGateway],
        }),
      );

      render(<CheckoutPaymentSection {...defaultProps} />);

      await waitFor(() => {
        expect(mockInitiatePayment).toHaveBeenCalledWith('chk-42');
      });
    });

    it('does not call initiatePayment when checkout has no id', () => {
      $checkout.set(
        makeCheckout({
          id: '',
          available_payment_gateways: [stripeGateway],
        }),
      );

      render(<CheckoutPaymentSection {...defaultProps} />);
      expect(mockInitiatePayment).not.toHaveBeenCalled();
    });

    it('does not call initiatePayment when no gateways exist', () => {
      $checkout.set(
        makeCheckout({
          id: 'chk-42',
          available_payment_gateways: null,
        }),
      );

      render(<CheckoutPaymentSection {...defaultProps} />);
      expect(mockInitiatePayment).not.toHaveBeenCalled();
    });
  });

  /* ── Payment retry ───────────────────────────────────────────────── */

  describe('payment retry on failure', () => {
    it('shows error message and retry button when initiatePayment fails', async () => {
      mockInitiatePayment.mockRejectedValue(new Error('Network error'));

      $checkout.set(
        makeCheckout({
          id: 'chk-1',
          status: 'delivery_set',
          available_payment_gateways: [stripeGateway],
        }),
      );

      const { getByText } = render(<CheckoutPaymentSection {...defaultProps} />);

      await waitFor(() => {
        expect(getByText('Payment setup failed. Please try again.')).toBeTruthy();
        expect(getByText('Try again')).toBeTruthy();
      });
    });

    it('sets $checkoutError when initiatePayment fails', async () => {
      mockInitiatePayment.mockRejectedValue(new Error('Server down'));

      $checkout.set(
        makeCheckout({
          id: 'chk-1',
          status: 'delivery_set',
          available_payment_gateways: [stripeGateway],
        }),
      );

      render(<CheckoutPaymentSection {...defaultProps} />);

      await waitFor(() => {
        expect($checkoutError.get()).toBe('Payment setup failed. Please try again.');
      });
    });

    it('calls onError callback when initiatePayment fails', async () => {
      mockInitiatePayment.mockRejectedValue(new Error('Timeout'));
      const onError = vi.fn();

      $checkout.set(
        makeCheckout({
          id: 'chk-1',
          status: 'delivery_set',
          available_payment_gateways: [stripeGateway],
        }),
      );

      render(<CheckoutPaymentSection {...defaultProps} onError={onError} />);

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith('Payment setup failed. Please try again.');
      });
    });

    it('clears error UI when retry button is clicked', async () => {
      mockInitiatePayment.mockRejectedValue(new Error('Temporary'));

      $checkout.set(
        makeCheckout({
          id: 'chk-1',
          status: 'delivery_set',
          available_payment_gateways: [stripeGateway],
        }),
      );

      const { getByText, queryByText } = render(<CheckoutPaymentSection {...defaultProps} />);

      // Wait for error state
      await waitFor(() => {
        expect(getByText('Try again')).toBeTruthy();
      });

      // Click retry — clears the error message
      fireEvent.click(getByText('Try again'));

      await waitFor(() => {
        expect(queryByText('Payment setup failed. Please try again.')).toBeNull();
      });
    });
  });

  /* ── $stripePayment atom mutation ────────────────────────────────── */

  describe('$stripePayment atom', () => {
    it('is set with stripe, elements, clientSecret when StripePaymentForm fires onStripeReady', async () => {
      mockInitiatePayment.mockResolvedValue({ client_secret: 'cs_test_ready' });

      $checkout.set(
        makeCheckout({
          id: 'chk-1',
          status: 'delivery_set',
          available_payment_gateways: [stripeGateway],
        }),
      );

      render(<CheckoutPaymentSection {...defaultProps} />);

      await waitFor(() => {
        const state = $stripePayment.get();
        expect(state).not.toBeNull();
        expect(state?.stripe).toEqual({ id: 'mock-stripe' });
        expect(state?.elements).toEqual({ id: 'mock-elements' });
        expect(state?.clientSecret).toBe('cs_test_ready');
      });
    });
  });

  /* ── Cleanup on unmount ──────────────────────────────────────────── */

  describe('cleanup on unmount', () => {
    it('sets $stripePayment to null when component unmounts', async () => {
      mockInitiatePayment.mockResolvedValue({ client_secret: 'cs_test_cleanup' });

      $checkout.set(
        makeCheckout({
          id: 'chk-1',
          status: 'delivery_set',
          available_payment_gateways: [stripeGateway],
        }),
      );

      const { unmount } = render(<CheckoutPaymentSection {...defaultProps} />);

      // Wait for stripePayment to be set
      await waitFor(() => {
        expect($stripePayment.get()).not.toBeNull();
      });

      // Unmount
      unmount();

      expect($stripePayment.get()).toBeNull();
    });
  });

  /* ── Stripe Payment Form rendering ─────────────────────────────── */

  describe('StripePaymentForm rendering', () => {
    it('renders StripePaymentForm when stripeConfig is set and no error', async () => {
      mockInitiatePayment.mockResolvedValue({ client_secret: 'cs_test_render' });

      $checkout.set(
        makeCheckout({
          id: 'chk-1',
          status: 'delivery_set',
          available_payment_gateways: [stripeGateway],
        }),
      );

      const { getByTestId } = render(<CheckoutPaymentSection {...defaultProps} />);

      await waitFor(() => {
        expect(getByTestId('stripe-payment-form')).toBeTruthy();
      });
    });

    it('does not render StripePaymentForm when there is a payment error', async () => {
      mockInitiatePayment.mockRejectedValue(new Error('fail'));

      $checkout.set(
        makeCheckout({
          id: 'chk-1',
          status: 'delivery_set',
          available_payment_gateways: [stripeGateway],
        }),
      );

      const { queryByTestId, getByText } = render(<CheckoutPaymentSection {...defaultProps} />);

      await waitFor(() => {
        expect(getByText('Payment setup failed. Please try again.')).toBeTruthy();
      });

      expect(queryByTestId('stripe-payment-form')).toBeNull();
    });

    it('does not render StripePaymentForm when initiatePayment returns no client_secret', async () => {
      mockInitiatePayment.mockResolvedValue({ client_secret: undefined });

      $checkout.set(
        makeCheckout({
          id: 'chk-1',
          status: 'delivery_set',
          available_payment_gateways: [stripeGateway],
        }),
      );

      const { queryByTestId } = render(<CheckoutPaymentSection {...defaultProps} />);

      // Give effects time to run
      await new Promise((r) => setTimeout(r, 50));

      expect(queryByTestId('stripe-payment-form')).toBeNull();
    });
  });
});
