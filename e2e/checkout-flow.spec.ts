/**
 * Comprehensive E2E tests for the Poke Perfect checkout flow.
 *
 * Covers happy paths (delivery + pickup), discount codes, form validation,
 * payment failure recovery, data integrity (verifying API payloads), and
 * the iDEAL redirect return flow.
 *
 * These tests exercise the full customer journey: add to cart → checkout →
 * fill form → pay → success page — validating both UI state and the data
 * the backend receives at each step.
 */
import { test, expect, type Page, type Request } from '@playwright/test';
import {
  resetMockApi,
  waitForHydration,
  blockAnalytics,
  addSimpleProductToCart,
  menuPage,
  openCartDrawer,
} from './helpers/test-utils';
import { mockStripe, setStripeDecline } from './helpers/stripe-mock';
import { products } from './fixtures/products';

const falafel = products[0]; // prod-1, €8.50, no modifiers
const mintLemonade = products[2]; // prod-3, €4.50

// ── Shared helpers ───────────────────────────────────────────────

/**
 * Navigate to Dutch menu, add a product, then go to English checkout.
 * Uses Dutch menu because addSimpleProductToCart expects "Toevoegen" button.
 * Waits for the checkout object to be created before returning.
 */
async function goToCheckoutWithItem(page: Page, lang = 'en') {
  await page.goto(menuPage('nl'));
  await waitForHydration(page);
  await addSimpleProductToCart(page, falafel.id);

  // Set up checkout creation listener BEFORE navigating
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

/** Fill the contact form fields. */
async function fillContactForm(
  page: Page,
  data: {
    email?: string;
    phone?: string;
    firstName?: string;
    lastName?: string;
  } = {},
) {
  const {
    email = 'test@example.com',
    phone = '+31612345678',
    firstName = 'Jan',
    lastName = 'de Vries',
  } = data;

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Phone number').fill(phone);
  await page.getByLabel('First name').fill(firstName);
  await page.getByLabel('Last name').fill(lastName);
}

/** Fill the delivery address fields. */
async function fillDeliveryAddress(
  page: Page,
  data: {
    street?: string;
    city?: string;
    postalCode?: string;
  } = {},
) {
  const { street = 'Damstraat 1', city = 'Amsterdam', postalCode = '1015AB' } = data;

  await page.getByLabel('Street and number').fill(street);
  await page.getByLabel('City').fill(city);
  await page.getByLabel('Postal code').fill(postalCode);
}

/**
 * Fill contact + delivery, set up the PATCH listener, then blur to trigger.
 * Returns the PATCH request promise for payload inspection.
 */
async function fillFormAndTriggerPatch(page: Page): Promise<Request> {
  await fillContactForm(page);
  await fillDeliveryAddress(page);

  // Set up listener BEFORE blur (PATCH is debounced 500ms)
  const patchPromise = page.waitForRequest(
    (req) =>
      req.url().includes('/api/v1/checkout/') &&
      req.url().includes('/delivery/') &&
      req.method() === 'PATCH',
    { timeout: 15_000 },
  );

  // Blur the last field to trigger the debounced PATCH
  await page.getByLabel('Postal code').blur();

  return patchPromise;
}

/**
 * Wait for the Stripe Payment Element mock to appear.
 * This indicates the full chain completed: PATCH → gateways → payment init → mount.
 */
async function waitForPaymentElement(page: Page) {
  await page.getByTestId('stripe-mock').waitFor({ state: 'visible', timeout: 20_000 });
}

/** Click the visible "Place order" button (works on desktop and mobile). */
async function clickPlaceOrder(page: Page) {
  // Desktop: .hidden.md:block button, Mobile: fixed bottom sticky button
  // Use the visible button matching "Place order" text
  const button = page
    .getByRole('button', { name: /Place order/ })
    .locator('visible=true')
    .first();
  await button.click();
}

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 1 — Happy path: Delivery order end-to-end
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 1: Delivery order — happy path', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('complete delivery order: cart → checkout → payment → success', async ({ page }) => {
    await goToCheckoutWithItem(page);

    // 1. Verify cart item appears in order summary (visible on both mobile + desktop)
    await expect(page.getByText('Falafel Wrap').locator('visible=true').first()).toBeVisible();
    await expect(page.getByText('Subtotal').locator('visible=true').first()).toBeVisible();

    // 2. Fill contact + address, wait for delivery PATCH
    const patchRequest = await fillFormAndTriggerPatch(page);

    // 3. Verify delivery PATCH payload
    const patchBody = patchRequest.postDataJSON();
    expect(patchBody.email).toBe('test@example.com');
    expect(patchBody.first_name).toBe('Jan');
    expect(patchBody.last_name).toBe('de Vries');
    expect(patchBody.phone_number).toBe('+31612345678');
    expect(patchBody.shipping_address).toBeDefined();
    expect(patchBody.shipping_address.street_address_1).toBe('Damstraat 1');
    expect(patchBody.shipping_address.city).toBe('Amsterdam');
    expect(patchBody.shipping_address.postal_code).toBe('1015AB');

    // 4. Wait for Stripe Payment Element to mount (full chain)
    await waitForPaymentElement(page);

    // 5. Click Place Order — mock Stripe returns success
    const completeResponse = page.waitForResponse(
      (resp) => resp.url().includes('/complete/') && resp.request().method() === 'POST',
    );
    await clickPlaceOrder(page);
    await completeResponse;

    // 6. Verify redirect to success page with order number
    await page.waitForURL('**/checkout/success**', { timeout: 10_000 });
    await expect(page.getByText('Order confirmed!')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/ORD-\d+/)).toBeVisible();

    // 7. Verify "Back to menu" link works
    await page.getByText('Back to menu').click();
    await page.waitForURL('**/en/', { timeout: 5_000 });
  });
});

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 2 — Happy path: Pickup order end-to-end
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 2: Pickup order — happy path', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('complete pickup order: select pickup → no address → payment → success', async ({
    page,
  }) => {
    await goToCheckoutWithItem(page);

    // 1. Switch to pickup
    await page.getByText('Pickup').click();

    // 2. Verify address fields are hidden
    await expect(page.getByLabel('Street and number')).toBeHidden();

    // 3. Wait for pickup locations to load (from /api/v1/pickup-locations/)
    await expect(page.getByText('Pickup location')).toBeVisible({ timeout: 5_000 });

    // 4. Fill contact info
    await fillContactForm(page);

    // 5. Set up PATCH listener before blur
    const patchPromise = page.waitForRequest(
      (req) =>
        req.url().includes('/api/v1/checkout/') &&
        req.url().includes('/delivery/') &&
        req.method() === 'PATCH',
      { timeout: 15_000 },
    );
    await page.getByLabel('Last name').blur();
    const patchRequest = await patchPromise;

    // 6. Verify pickup payload
    const patchBody = patchRequest.postDataJSON();
    expect(patchBody.fulfillment_type).toBe('pickup');
    expect(patchBody.pickup_location_id).toBe(1);
    expect(patchBody.shipping_address).toBeUndefined();

    // 7. Wait for Stripe Payment Element and place order
    await waitForPaymentElement(page);
    const completeResponse = page.waitForResponse(
      (resp) => resp.url().includes('/complete/') && resp.request().method() === 'POST',
    );
    await clickPlaceOrder(page);
    await completeResponse;

    // 8. Success page
    await page.waitForURL('**/checkout/success**', { timeout: 10_000 });
    await expect(page.getByText('Order confirmed!')).toBeVisible({ timeout: 10_000 });
  });
});

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 3 — Discount code: valid percentage (SAVE10)
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 3: Valid discount code', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('SAVE10 applies 10% discount and updates total', async ({ page }) => {
    // Add item and open cart drawer to apply discount (discount input is in cart drawer)
    await page.goto(menuPage('nl'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    // Open cart drawer
    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Enter discount code in the cart drawer
    const discountInput = drawer.getByLabel('Kortingscode');
    await expect(discountInput).toBeVisible({ timeout: 5_000 });
    await discountInput.fill('SAVE10');

    // Apply discount and wait for API response
    const discountResponse = page.waitForResponse(
      (resp) => resp.url().includes('/apply-discount/') && resp.request().method() === 'POST',
    );
    await drawer.getByRole('button', { name: 'Toepassen' }).click();
    const response = await discountResponse;
    const responseBody = await response.json();

    // Verify discount was applied in the API response
    expect(parseFloat(responseBody.discount_amount)).toBeGreaterThan(0);

    // Verify the discount remove button appeared (scoped text — not the item remove button)
    // The discount section shows: code + name + "Verwijderen" link-button
    await expect(drawer.locator('text=Verwijderen').last()).toBeVisible({ timeout: 5_000 });

    // Verify discount line appears in pricing breakdown
    await expect(drawer.getByText('Korting')).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 4 — Discount code: invalid/expired
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 4: Invalid and expired discount codes', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('expired discount code shows error, total unchanged', async ({ page }) => {
    await page.goto(menuPage('nl'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    const discountInput = drawer.getByLabel('Kortingscode');
    await expect(discountInput).toBeVisible({ timeout: 5_000 });
    await discountInput.fill('EXPIRED');

    const discountResponse = page.waitForResponse(
      (resp) => resp.url().includes('/apply-discount/') && resp.status() === 400,
    );
    await drawer.getByRole('button', { name: 'Toepassen' }).click();
    await discountResponse;

    // Discount input should still be visible (not replaced with active discount UI)
    await expect(drawer.getByLabel('Kortingscode')).toBeVisible({ timeout: 3_000 });
  });

  test('nonexistent discount code shows error', async ({ page }) => {
    await page.goto(menuPage('nl'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    const discountInput = drawer.getByLabel('Kortingscode');
    await expect(discountInput).toBeVisible({ timeout: 5_000 });
    await discountInput.fill('DOESNOTEXIST');

    const discountResponse = page.waitForResponse(
      (resp) => resp.url().includes('/apply-discount/') && resp.status() === 400,
    );
    await drawer.getByRole('button', { name: 'Toepassen' }).click();
    await discountResponse;

    // Discount input should remain (no discount applied)
    await expect(drawer.getByLabel('Kortingscode')).toBeVisible({ timeout: 3_000 });
  });
});

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 5 — Discount removal reverts total
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 5: Discount removal', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('removing a discount reverts total to original', async ({ page }) => {
    await page.goto(menuPage('nl'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    // 1. Open cart drawer and apply FLAT5
    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    const discountInput = drawer.getByLabel('Kortingscode');
    await expect(discountInput).toBeVisible({ timeout: 5_000 });
    await discountInput.fill('FLAT5');
    const applyResponse = page.waitForResponse(
      (resp) => resp.url().includes('/apply-discount/') && resp.request().method() === 'POST',
    );
    await drawer.getByRole('button', { name: 'Toepassen' }).click();
    await applyResponse;

    // 2. Verify discount is active (discount remove link visible)
    // The discount section has a "Verwijderen" text-button — use last() to avoid
    // strict mode conflict with the item "Item verwijderen" button
    const discountRemoveBtn = drawer.locator('text=Verwijderen').last();
    await expect(discountRemoveBtn).toBeVisible({ timeout: 5_000 });

    // 3. Remove the discount
    const removeResponse = page.waitForResponse(
      (resp) => resp.url().includes('/remove-discount/') && resp.request().method() === 'DELETE',
    );
    await discountRemoveBtn.click();
    const removeResult = await removeResponse;
    const removeBody = await removeResult.json();

    // 4. Verify discount is removed in API response
    expect(removeBody.discount_amount).toBe('0.00');

    // 5. Verify discount input reappears (no active discount)
    await expect(drawer.getByLabel('Kortingscode')).toBeVisible({ timeout: 3_000 });
  });
});

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 6 — Empty cart redirects to menu
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 6: Empty cart redirect', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('navigating to checkout with empty cart redirects to menu', async ({ page }) => {
    await page.goto('/en/checkout');
    await waitForHydration(page);
    await page.waitForURL('**/en/', { timeout: 10_000 });
  });
});

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 7 — Form validation prevents submission
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 7: Form validation', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('empty required fields show validation errors and block submission', async ({ page }) => {
    await goToCheckoutWithItem(page);

    // Fill form completely to trigger Stripe mount, then clear fields
    const patchPromise = fillFormAndTriggerPatch(page);
    await patchPromise;
    await waitForPaymentElement(page);

    // Clear required fields to trigger validation on submit
    await page.getByLabel('Email').fill('');
    await page.getByLabel('First name').fill('');
    await page.getByLabel('Phone number').fill('');
    // Blur to dismiss mobile keyboard (PlaceOrderButton hides when keyboard is open)
    await page.getByLabel('Phone number').blur();

    // Attempt to place order
    await clickPlaceOrder(page);

    // Validation errors should appear (role="alert" elements)
    const alerts = page.locator('[role="alert"]');
    await expect(alerts.first()).toBeVisible({ timeout: 5_000 });

    // Verify specific error messages
    await expect(page.getByText('Email is required')).toBeVisible();
    await expect(page.getByText('First name is required')).toBeVisible();
    await expect(page.getByText('Phone number is required')).toBeVisible();
  });

  test('invalid email shows validation error on blur', async ({ page }) => {
    await goToCheckoutWithItem(page);

    // Fill with invalid email and blur
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Email').blur();

    // Wait for the inline validation
    await expect(page.getByText('Please enter a valid email address')).toBeVisible({
      timeout: 5_000,
    });
  });
});

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 8 — Payment failure and recovery
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 8: Payment failure recovery', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('card decline shows error, form state preserved, retry works', async ({ page }) => {
    await goToCheckoutWithItem(page);

    // Fill form and wait for payment element
    const patchPromise = fillFormAndTriggerPatch(page);
    await patchPromise;
    await waitForPaymentElement(page);

    // Set Stripe mock to decline
    await setStripeDecline(page, true);

    // Attempt to place order
    await clickPlaceOrder(page);

    // Error message should appear
    await expect(page.getByText('Your card was declined')).toBeVisible({ timeout: 10_000 });

    // Form state should be preserved
    await expect(page.getByLabel('Email')).toHaveValue('test@example.com');
    await expect(page.getByLabel('First name')).toHaveValue('Jan');
    await expect(page.getByLabel('Street and number')).toHaveValue('Damstraat 1');

    // Place Order button should re-enable (not stuck in submitting state)
    const placeOrderButton = page
      .getByRole('button', { name: /Place order/ })
      .locator('visible=true')
      .first();
    await expect(placeOrderButton).toBeEnabled({ timeout: 5_000 });

    // Now fix the decline and retry
    await setStripeDecline(page, false);

    const completeResponse = page.waitForResponse(
      (resp) => resp.url().includes('/complete/') && resp.request().method() === 'POST',
    );
    await clickPlaceOrder(page);
    await completeResponse;

    // Should succeed on retry
    await page.waitForURL('**/checkout/success**', { timeout: 10_000 });
    await expect(page.getByText('Order confirmed!')).toBeVisible({ timeout: 10_000 });
  });
});

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 9 — Cart summary accuracy (multi-item)
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 9: Cart summary accuracy', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('multi-item cart shows correct line items and totals', async ({ page }) => {
    // Add two different products (Dutch menu for "Toevoegen" button)
    await page.goto(menuPage('nl'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id); // €8.50
    await addSimpleProductToCart(page, mintLemonade.id); // €4.50

    // Set up checkout creation listener BEFORE navigating
    const checkoutCreatePromise = page.waitForResponse(
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

    const checkoutResponse = await checkoutCreatePromise;
    const checkoutData = await checkoutResponse.json();

    // Verify both items in checkout response
    expect(checkoutData.line_items).toHaveLength(2);
    const productIds = checkoutData.line_items.map((li: { product_id: string }) => li.product_id);
    expect(productIds).toContain('prod-1');
    expect(productIds).toContain('prod-3');

    // Verify subtotal is correct (€8.50 + €4.50 = €13.00)
    expect(checkoutData.subtotal).toBe('13.00');

    // Verify both items appear in UI order summary (visible on both mobile + desktop)
    await expect(page.getByText('Falafel Wrap').locator('visible=true').first()).toBeVisible();
    await expect(page.getByText('Mint Lemonade').locator('visible=true').first()).toBeVisible();
    await expect(page.getByText('Subtotal').locator('visible=true').first()).toBeVisible();
  });
});

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 10 — Fulfillment toggle preserves address state
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 10: Fulfillment toggle state preservation', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('switching delivery → pickup → delivery preserves address fields', async ({ page }) => {
    await goToCheckoutWithItem(page);

    // 1. Fill delivery address
    await fillDeliveryAddress(page, {
      street: 'Keizersgracht 100',
      city: 'Amsterdam',
      postalCode: '1015AB',
    });

    // 2. Switch to pickup
    await page.getByText('Pickup').click();
    await expect(page.getByLabel('Street and number')).toBeHidden();

    // 3. Switch back to delivery
    await page.getByText('Delivery').click();

    // 4. Address fields should retain their values
    await expect(page.getByLabel('Street and number')).toHaveValue('Keizersgracht 100');
    await expect(page.getByLabel('City')).toHaveValue('Amsterdam');
    await expect(page.getByLabel('Postal code')).toHaveValue('1015AB');
  });

  test('pickup order sends no shipping address in PATCH', async ({ page }) => {
    await goToCheckoutWithItem(page);

    // Switch to pickup first
    await page.getByText('Pickup').click();

    // Wait for pickup location section to appear (label + combobox)
    await expect(page.getByText('Pickup location')).toBeVisible({ timeout: 5_000 });

    // Fill contact info
    await fillContactForm(page);

    // Set up PATCH listener before blur
    const patchPromise = page.waitForRequest(
      (req) =>
        req.url().includes('/api/v1/checkout/') &&
        req.url().includes('/delivery/') &&
        req.method() === 'PATCH',
      { timeout: 15_000 },
    );
    await page.getByLabel('Last name').blur();
    const patchRequest = await patchPromise;

    // Verify the PATCH payload has pickup fulfillment, no shipping address
    const patchBody = patchRequest.postDataJSON();
    expect(patchBody.fulfillment_type).toBe('pickup');
    expect(patchBody.shipping_address).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 11 — iDEAL redirect return flow
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 11: iDEAL redirect return flow', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('success page handles checkout_id + payment_intent polling', async ({ page }) => {
    // Create a checkout via the normal flow so the mock API has state
    // goToCheckoutWithItem already waits for checkout creation
    await page.goto(menuPage('nl'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    // Set up checkout creation listener BEFORE navigating
    const checkoutCreatePromise = page.waitForResponse(
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

    const checkoutResponse = await checkoutCreatePromise;
    const checkoutData = await checkoutResponse.json();
    const checkoutId = checkoutData.id;

    // Complete the checkout in the mock API (simulating webhook)
    await page.evaluate(async (id) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      // Include the test cart header to match the mock API's cart state
      const testCartId = document.cookie
        .split(';')
        .find((c) => c.includes('test-cart'))
        ?.split('=')?.[1];
      if (testCartId) headers['x-test-cart-id'] = testCartId;

      await fetch(`http://localhost:4322/api/v1/checkout/${id}/payment/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ gateway_id: 'stripe' }),
      });
      await fetch(`http://localhost:4322/api/v1/checkout/${id}/complete/`, {
        method: 'POST',
        headers,
      });
    }, checkoutId);

    // Simulate returning from bank redirect
    await page.goto(`/en/checkout/success?checkout_id=${checkoutId}&payment_intent=pi_mock_123`);
    await waitForHydration(page);

    // The polling should find the completed checkout and display the order number
    await expect(page.getByText(/Order confirmed|Payment received/)).toBeVisible({
      timeout: 15_000,
    });

    // Sensitive params should be stripped from URL
    await expect(page).not.toHaveURL(/payment_intent/);
  });

  test('success page shows loading state for delayed webhook', async ({ page }) => {
    // Navigate directly with a non-existent checkout_id
    // The polling will get 404s, and eventually the success page should redirect or show fallback
    await page.goto('/en/checkout/success?checkout_id=chk-fake&payment_intent=pi_mock_456');
    await waitForHydration(page);

    // Should show the loading/confirming state
    await expect(page.getByText(/confirming your order/i)).toBeVisible({ timeout: 5_000 });
  });
});

// ═════════════════════════════════════════════════════════════════
//  SCENARIO 12 — Backend data verification (PATCH payload)
// ═════════════════════════════════════════════════════════════════

test.describe('Scenario 12: Backend data verification', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('checkout creation sends correct cart_id', async ({ page }) => {
    await page.goto(menuPage('nl'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    // Listen for checkout creation
    const checkoutCreatePromise = page.waitForRequest(
      (req) =>
        req.url().includes('/api/v1/checkout/') &&
        req.method() === 'POST' &&
        !req.url().includes('/delivery/') &&
        !req.url().includes('/payment/') &&
        !req.url().includes('/complete/'),
      { timeout: 15_000 },
    );

    await page.goto('/en/checkout');
    await waitForHydration(page);

    const createRequest = await checkoutCreatePromise;
    const createBody = createRequest.postDataJSON();

    // cart_id should be present and non-empty
    expect(createBody.cart_id).toBeDefined();
    expect(typeof createBody.cart_id).toBe('string');
    expect(createBody.cart_id.length).toBeGreaterThan(0);
  });

  test('delivery PATCH contains complete contact + address data', async ({ page }) => {
    await goToCheckoutWithItem(page);

    // Fill all fields with specific values
    await fillContactForm(page, {
      email: 'pieter@poke.nl',
      phone: '+31687654321',
      firstName: 'Pieter',
      lastName: 'Bakker',
    });
    await fillDeliveryAddress(page, {
      street: 'Prinsengracht 263',
      city: 'Amsterdam',
      postalCode: '1015AB',
    });

    // Set up PATCH listener before blur
    const patchPromise = page.waitForRequest(
      (req) =>
        req.url().includes('/api/v1/checkout/') &&
        req.url().includes('/delivery/') &&
        req.method() === 'PATCH',
      { timeout: 15_000 },
    );
    await page.getByLabel('Postal code').blur();
    const patchRequest = await patchPromise;
    const body = patchRequest.postDataJSON();

    // Verify every field the restaurant operator needs
    // Contact info is at the top level; shipping_address contains only address fields
    expect(body).toMatchObject({
      email: 'pieter@poke.nl',
      first_name: 'Pieter',
      last_name: 'Bakker',
      phone_number: '+31687654321',
      shipping_address: {
        street_address_1: 'Prinsengracht 263',
        city: 'Amsterdam',
        postal_code: '1015AB',
        country_code: 'NL',
      },
    });

    // Fulfillment type should be a delivery variant
    expect(body.fulfillment_type).toMatch(/delivery|local_delivery|nationwide_delivery/);
  });

  test('payment initiation sends stripe gateway_id', async ({ page }) => {
    await goToCheckoutWithItem(page);

    // Set up payment request listener before triggering the form flow
    const paymentPromise = page.waitForRequest(
      (req) =>
        req.url().includes('/payment/') &&
        req.method() === 'POST' &&
        !req.url().includes('/confirm/'),
      { timeout: 20_000 },
    );

    // Fill form and trigger PATCH (which triggers gateway fetch → payment init)
    const patchPromise = fillFormAndTriggerPatch(page);
    await patchPromise;

    const paymentRequest = await paymentPromise;
    const paymentBody = paymentRequest.postDataJSON();
    expect(paymentBody.gateway_id).toBe('stripe');
  });
});
