import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  resetMockApi,
  menuPage,
  waitForHydration,
  blockAnalytics,
  addSimpleProductToCart,
  openCartDrawer,
} from './helpers/test-utils';

/** Dismiss the comms modal if it appears (e.g. "Welcome!" promo). */
async function dismissCommsModal(page: Page) {
  const dismiss = page.getByText('Melding sluiten');
  try {
    await dismiss.waitFor({ state: 'visible', timeout: 2_000 });
    await dismiss.click();
    await dismiss.waitFor({ state: 'hidden', timeout: 2_000 });
  } catch {
    // Modal didn't appear — that's fine
  }
}

/**
 * Submit a postcode via the AddressBar component.
 * Clicks the compact button to expand, types the postcode, and submits.
 */
async function enterPostcode(page: Page, postcode: string) {
  await dismissCommsModal(page);
  // Click the compact "Voer postcode in" button to expand the input form
  const addressButton = page.getByRole('button', { name: 'Voer postcode in' });
  await addressButton.waitFor({ state: 'visible', timeout: 5_000 });
  await addressButton.click();

  // Fill the postcode input
  const input = page.getByLabel('Voer postcode in');
  await input.waitFor({ state: 'visible', timeout: 3_000 });
  await input.fill(postcode);

  // Submit and wait for the address-check API response
  const responsePromise = page.waitForResponse((resp) =>
    resp.url().includes('/api/v1/fulfillment/address-check/'),
  );
  await page.getByRole('button', { name: 'Controleren' }).click();
  return responsePromise;
}

test.describe('AddressBar — postcode entry', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('enter valid postcode shows confirmation', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await enterPostcode(page, '1015AB');

    // After successful address check, the banner should show the postcode
    const banner = page.getByRole('status');
    await expect(banner.getByText('1015AB')).toBeVisible({ timeout: 5_000 });
  });

  test('enter invalid postcode shows error', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await enterPostcode(page, '0000XX');

    // Error alert should appear
    const alert = page.getByRole('alert');
    await expect(alert.getByText('Postcode niet gevonden')).toBeVisible({ timeout: 5_000 });
  });

  test('clear address resets state', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // First set a valid address
    await enterPostcode(page, '1015AB');
    const banner = page.getByRole('status');
    await expect(banner.getByText('1015AB')).toBeVisible({ timeout: 5_000 });

    // Click the clear (X) button next to the postcode
    await page.getByRole('button', { name: 'Wissen' }).click();

    // The "Voer postcode in" button should reappear
    await expect(page.getByRole('button', { name: 'Voer postcode in' })).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe('DeliveryBanner — status messages', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('shows green delivery banner when delivery is available', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await enterPostcode(page, '1015AB');

    const banner = page.getByRole('status');
    await expect(banner.getByText('Bezorgen naar 1015AB')).toBeVisible({ timeout: 5_000 });
  });

  test('shows amber warning when delivery is unavailable', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await enterPostcode(page, '9999ZZ');

    const banner = page.getByRole('status');
    await expect(banner.getByText('Bezorging is niet beschikbaar in jouw regio')).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe('FulfillmentOverlay — product badges', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('pickup-only badge appears on product after address entry', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Enter a valid postcode and wait for the products refetch with coordinates
    const addressResponse = enterPostcode(page, '1015AB');
    await addressResponse;

    // Wait for the products API to be called with coordinates
    await page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/products/') &&
        resp.url().includes('latitude=') &&
        resp.request().method() === 'GET',
    );

    // prod-3 (Mint Lemonade) should have a pickup-only badge
    const mintCard = page.locator('[data-product-id="prod-3"]').first();
    await expect(mintCard.locator('[data-fulfillment-badge]')).toBeVisible({ timeout: 5_000 });
    await expect(mintCard.getByText('Alleen afhalen')).toBeVisible();
  });
});

test.describe('ShippingEstimate — cart drawer', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('shows shipping estimate in cart after address is set', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);
    await dismissCommsModal(page);

    // Add a product to the cart first
    await addSimpleProductToCart(page, 'prod-1');

    // Enter a valid postcode
    await enterPostcode(page, '1015AB');

    // Wait for the products refetch with coordinates
    await page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/products/') &&
        resp.url().includes('latitude=') &&
        resp.request().method() === 'GET',
    );

    // Open the cart drawer
    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Shipping estimate should be visible
    await expect(drawer.getByText('Verzending')).toBeVisible({ timeout: 5_000 });
    await expect(drawer.getByText('€ 4,95')).toBeVisible();
  });

  test('shows free shipping label when shipping cost is zero', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);
    await dismissCommsModal(page);

    // Add a product to the cart first
    await addSimpleProductToCart(page, 'prod-1');

    // Enter postcode in the free-shipping zone
    await enterPostcode(page, '2000AB');

    // Wait for the products refetch with coordinates
    await page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/products/') &&
        resp.url().includes('latitude=') &&
        resp.request().method() === 'GET',
    );

    // Open the cart drawer
    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Shipping estimate should show "Gratis" (Dutch for Free), not "€ 0,00"
    await expect(drawer.getByText('Gratis')).toBeVisible({ timeout: 5_000 });
  });

  test('shows prompt to enter postcode when no address is set', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);
    await dismissCommsModal(page);

    // Add a product to the cart
    await addSimpleProductToCart(page, 'prod-1');

    // Open the cart drawer without setting an address
    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Should show the prompt to enter postcode for shipping costs
    await expect(drawer.getByText('Voer je postcode in voor verzendkosten')).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe('Address persistence — across navigation', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('address survives page navigation via localStorage hydration', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Set a valid address
    await enterPostcode(page, '1015AB');
    const banner = page.getByRole('status');
    await expect(banner.getByText('1015AB')).toBeVisible({ timeout: 5_000 });

    // Navigate away and back — localStorage should persist the address.
    // Set up response listener BEFORE navigation so we catch the early
    // hydration call to address-check that fires at module load.
    const hydrationResponse = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/fulfillment/address-check/'),
      { timeout: 10_000 },
    );
    await page.goto(menuPage());
    await waitForHydration(page);
    await hydrationResponse;
    await dismissCommsModal(page);

    // DeliveryBanner should rehydrate with the stored address
    const restoredBanner = page.getByRole('status');
    await expect(restoredBanner.getByText('Bezorgen naar 1015AB')).toBeVisible({ timeout: 5_000 });
  });
});
