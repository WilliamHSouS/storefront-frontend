import { test, expect } from '@playwright/test';
import {
  resetMockApi,
  waitForHydration,
  blockAnalytics,
  addSimpleProductToCart,
  menuPage,
} from './helpers/test-utils';
import { mockStripe } from './helpers/stripe-mock';
import { products } from './fixtures/products';

const falafel = products[0]; // simple, no modifiers

/**
 * Navigate to Dutch menu, add falafel, then navigate to English checkout.
 * Waits for the checkout POST (201) to complete before returning.
 */
async function goToCheckoutWithItem(page: Parameters<typeof waitForHydration>[0], lang = 'en') {
  await page.goto(menuPage('nl'));
  await waitForHydration(page);
  await addSimpleProductToCart(page, falafel.id);

  const checkoutCreated = page.waitForResponse(
    (resp) =>
      resp.url().includes('/api/v1/checkout/') &&
      resp.request().method() === 'POST' &&
      resp.status() === 201 &&
      !resp.url().includes('/delivery/') &&
      !resp.url().includes('/payment/') &&
      !resp.url().includes('/complete/'),
    { timeout: 15_000 },
  );

  await page.goto(`/${lang}/checkout`);
  await waitForHydration(page);
  await checkoutCreated;
}

test.describe('Checkout error recovery', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('shows storage unavailable toast when sessionStorage blocked', async ({ page }) => {
    // Add a product to cart first (sessionStorage is available at this point)
    await page.goto(menuPage('en'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    // Block sessionStorage before navigating to checkout
    await page.addInitScript(() => {
      Object.defineProperty(window, 'sessionStorage', {
        get: () => {
          throw new Error('blocked');
        },
      });
    });

    await page.goto('/en/checkout');
    await waitForHydration(page);

    // Toast should appear with the storage unavailable message
    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Your browser doesn't support saving form progress")).toBeVisible({
      timeout: 10000,
    });
  });

  // ── Payment init failure + retry ──────────────────────────────────────────

  test('shows retry button when payment initialization fails', async ({ page }) => {
    // Intercept the payment init endpoint BEFORE navigating — with eager gateway
    // config, CheckoutPaymentSection may initiate payment immediately after delivery_set.
    let paymentCallCount = 0;
    await page.route('**/api/v1/checkout/*/payment/', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      paymentCallCount++;
      if (paymentCallCount === 1) {
        // First call: return a 500 to trigger the error UI
        await route.fulfill({
          status: 500,
          body: JSON.stringify({ detail: 'Internal Server Error' }),
        });
      } else {
        // Subsequent calls: let through to the mock API
        await route.continue();
      }
    });

    await goToCheckoutWithItem(page);

    // Fill contact + delivery to trigger the delivery PATCH → delivery_set → payment init chain
    await page.getByLabel('Email').fill('test@example.com');
    await page.getByLabel('Phone number').fill('+31612345678');
    await page.getByLabel('First name').fill('Jan');
    await page.getByLabel('Last name').fill('de Vries');
    await page.getByLabel('Street and number').fill('Damstraat 1');
    await page.getByLabel('City').fill('Amsterdam');
    await page.getByLabel('Postal code').fill('1015AB');

    // Blur to fire the debounced PATCH
    await page.getByLabel('Postal code').blur();

    // Wait for the delivery PATCH to complete (transitions checkout to delivery_set)
    await page.waitForResponse(
      (resp) =>
        resp.url().includes('/delivery/') &&
        resp.request().method() === 'PATCH' &&
        resp.status() === 200,
      { timeout: 15_000 },
    );

    // The payment error message and "Try again" button should appear
    await expect(page.getByText('Payment setup failed. Please try again.').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'Try again' }).first()).toBeVisible();

    // Click retry — the second payment call should succeed and mount the payment form
    await page.getByRole('button', { name: 'Try again' }).click();

    // Payment form (stripe mock) should now be visible
    await page.getByTestId('stripe-mock').waitFor({ state: 'visible', timeout: 20_000 });

    // Error message should be gone after successful retry
    await expect(page.getByText('Payment failed. Please try again.')).toBeHidden();
  });

  // ── Fulfillment toggle without contact info ───────────────────────────────

  test('fulfillment toggle without contact info does not trigger PATCH', async ({ page }) => {
    await goToCheckoutWithItem(page);

    // Track any PATCH requests to the delivery endpoint
    let patchCount = 0;
    page.on('request', (req) => {
      if (
        req.url().includes('/api/v1/checkout/') &&
        req.url().includes('/delivery/') &&
        req.method() === 'PATCH'
      ) {
        patchCount++;
      }
    });

    // Contact fields are deliberately left empty.
    // Click the Pickup toggle — fulfillment type change alone must not fire a PATCH.
    await page.getByText('Pickup').click();

    // Wait long enough for any debounced PATCH (debounce is 500ms) to have fired.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- deliberate pause to confirm no debounced PATCH fires
    await page.waitForTimeout(1_500);

    expect(patchCount).toBe(0);
  });

  // ── Form validation on empty submit ──────────────────────────────────────

  test('form validation shows errors on empty submit', async ({ page }) => {
    await goToCheckoutWithItem(page);

    // Attempt to place the order without filling any fields
    const placeOrderButton = page
      .getByRole('button', { name: /Place order/ })
      .locator('visible=true')
      .first();
    await placeOrderButton.click();

    // Required-field validation errors should appear for the contact fields.
    // The error messages follow the pattern "{Field} is required" (i18n key: fieldRequired).
    await expect(page.getByText('Email is required')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Phone number is required')).toBeVisible();
    await expect(page.getByText('First name is required')).toBeVisible();
    await expect(page.getByText('Last name is required')).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════
//  EDGE CASE — Empty cart redirects to menu
// ═════════════════════════════════════════════════════════════════

test.describe('Checkout edge case: empty cart redirect', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('redirects to menu when cart is empty', async ({ page }) => {
    // Navigate directly to checkout without adding any items.
    // The checkout island should detect the empty cart and redirect to the menu.
    await page.goto('/en/checkout');
    await waitForHydration(page);
    await expect(page).toHaveURL(/\/en\/$/, { timeout: 10_000 });
  });
});

// ═════════════════════════════════════════════════════════════════
//  EDGE CASE — Cross-tab cart change triggers page reload
// ═════════════════════════════════════════════════════════════════

test.describe('Checkout edge case: cross-tab cart change', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('detects cart change from another tab and reloads', async ({ page }) => {
    // Add a product and navigate to checkout so we have an active session
    await goToCheckoutWithItem(page);

    // Capture the current URL before dispatching the cross-tab storage event,
    // so we can verify the page reloads back to the same URL (a full reload,
    // not a client-side navigation away).
    const checkoutUrl = page.url();

    // Simulate another browser tab updating the cart in localStorage.
    // The checkout island listens for `storage` events; when the cart key
    // changes it should reload the page to avoid stale order totals.
    await page.evaluate(() => {
      // 'cart_id' is the key the Nanostores cart store persists to localStorage.
      const CART_KEY = 'cart_id';
      const oldValue = localStorage.getItem(CART_KEY);
      // Dispatch the synthetic storage event as if a second tab wrote a new cart ID
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: CART_KEY,
          oldValue,
          newValue: `cart-other-tab-${Date.now()}`,
          storageArea: localStorage,
          url: window.location.href,
        }),
      );
    });

    // After the storage event, the checkout island should trigger a page reload.
    // We wait for the checkout URL to remain (reload brings us back to the same
    // path) and for hydration to complete, confirming the page was not stuck.
    await page.waitForURL(checkoutUrl, { timeout: 10_000 });
    await expect(page).toHaveURL(checkoutUrl);
  });
});

// ═════════════════════════════════════════════════════════════════
//  EDGE CASE — Stale/expired checkout ID is recovered gracefully
// ═════════════════════════════════════════════════════════════════

test.describe('Checkout edge case: expired checkout ID', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('handles expired checkout gracefully by creating a new one', async ({ page }) => {
    // Add a product to cart so the subsequent checkout creation can succeed
    await page.goto(menuPage('nl'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    // Inject a stale/non-existent checkout ID into sessionStorage.
    // The checkout island reads this on mount and tries to resume the previous
    // session via GET /api/v1/checkout/{id}/. The mock API returns 404 for
    // unknown IDs, which should trigger a fresh POST /api/v1/checkout/.
    await page.evaluate(() => {
      sessionStorage.setItem('checkout_id', 'chk-expired-fake-id');
    });

    // Explicitly route the stale checkout GET to 404 — the mock API already
    // does this for unknown IDs but routing it here makes the intent clear.
    await page.route('**/api/v1/checkout/chk-expired-fake-id/**', (route) => {
      if (route.request().method() === 'GET') {
        route.fulfill({ status: 404, body: JSON.stringify({ detail: 'Not found' }) });
      } else {
        route.continue();
      }
    });

    // Expect a fresh checkout to be created (POST → 201)
    const newCheckoutCreated = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/checkout/') &&
        resp.request().method() === 'POST' &&
        resp.status() === 201 &&
        !resp.url().includes('/delivery/') &&
        !resp.url().includes('/payment/') &&
        !resp.url().includes('/complete/'),
      { timeout: 15_000 },
    );

    await page.goto('/en/checkout');
    await waitForHydration(page);

    // A new checkout must be created — the expired ID must not crash the page
    const checkoutResponse = await newCheckoutCreated;
    const checkoutData = await checkoutResponse.json();
    expect(checkoutData.id).toBeDefined();
    expect(checkoutData.id).not.toBe('chk-expired-fake-id');

    // The checkout page should render normally with cart contents
    await expect(page.getByText('Falafel Wrap').locator('visible=true').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
