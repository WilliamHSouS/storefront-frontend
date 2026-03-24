import type { Page } from '@playwright/test';

/**
 * Mock Stripe.js by intercepting the external script load.
 * The @stripe/stripe-js loadStripe wrapper checks for window.Stripe
 * and uses it if available, so we don't need to intercept module imports.
 *
 * Supports configurable payment outcomes via window.__STRIPE_MOCK_DECLINE__.
 * Set this flag to true before calling handlePlaceOrder to simulate a decline.
 */
export async function mockStripe(page: Page) {
  await page.route('https://js.stripe.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        window.Stripe = function(key, opts) {
          return {
            elements: function(config) {
              return {
                create: function(type, options) {
                  return {
                    mount: function(el) {
                      var container = typeof el === 'string' ? document.querySelector(el) : el;
                      if (container) {
                        var mock = document.createElement('div');
                        mock.setAttribute('data-testid', 'stripe-mock');
                        mock.textContent = 'Stripe Payment Element (mock)';
                        container.appendChild(mock);
                      }
                    },
                    destroy: function() {},
                    on: function(event, cb) {
                      if (event === 'ready' && cb) setTimeout(cb, 0);
                      if (event === 'loaderror') { /* no-op */ }
                      return this;
                    },
                    update: function() {},
                  };
                },
                getElement: function() { return null; },
              };
            },
            confirmPayment: function() {
              if (window.__STRIPE_MOCK_DECLINE__) {
                return Promise.resolve({
                  error: {
                    type: 'card_error',
                    code: 'card_declined',
                    message: 'Your card was declined.',
                  }
                });
              }
              return Promise.resolve({ error: null });
            },
            retrievePaymentIntent: function() {
              return Promise.resolve({
                paymentIntent: { status: 'succeeded' }
              });
            },
            paymentRequest: function(config) {
              return {
                canMakePayment: function() { return Promise.resolve(null); },
                on: function() { return this; },
                update: function() {},
              };
            },
          };
        };
      `,
    });
  });
}

/**
 * Set the Stripe mock to decline the next payment.
 * Call this before triggering "Place order" to simulate a card decline.
 */
export async function setStripeDecline(page: Page, decline = true) {
  await page.evaluate((d) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only global flag
    (window as any).__STRIPE_MOCK_DECLINE__ = d;
  }, decline);
}
