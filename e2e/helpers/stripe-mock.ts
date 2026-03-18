import type { Page } from '@playwright/test';

/**
 * Mock Stripe.js by intercepting the external script load.
 * The @stripe/stripe-js loadStripe wrapper checks for window.Stripe
 * and uses it if available, so we don't need to intercept module imports.
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
                      if (typeof el === 'string') {
                        var container = document.querySelector(el);
                        if (container) {
                          var mock = document.createElement('div');
                          mock.setAttribute('data-testid', 'stripe-mock');
                          mock.textContent = 'Stripe Payment Element (mock)';
                          container.appendChild(mock);
                        }
                      }
                    },
                    destroy: function() {},
                    on: function() { return this; },
                    update: function() {},
                  };
                },
                getElement: function() { return null; },
              };
            },
            confirmPayment: function() {
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
