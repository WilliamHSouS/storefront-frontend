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

test.describe('Checkout page', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('shows checkout page with cart items and price breakdown', async ({ page }) => {
    await page.goto(menuPage('en'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    await page.goto('/en/checkout');
    await waitForHydration(page);

    // Verify order summary shows price breakdown
    await expect(page.getByText('Subtotal').locator('visible=true').first()).toBeVisible();
    await expect(
      page.getByText('Total', { exact: true }).locator('visible=true').first(),
    ).toBeVisible();
  });

  test('shows fulfillment toggle with delivery and pickup options', async ({ page }) => {
    await page.goto(menuPage('en'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    await page.goto('/en/checkout');
    await waitForHydration(page);

    await expect(page.locator('role=radiogroup').first()).toBeVisible();
    await expect(page.getByLabel('Delivery')).toBeVisible();
    await expect(page.getByLabel('Pickup')).toBeVisible();
  });

  test('shows contact form fields', async ({ page }) => {
    await page.goto(menuPage('en'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    await page.goto('/en/checkout');
    await waitForHydration(page);

    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Phone number')).toBeVisible();
    await expect(page.getByLabel('First name')).toBeVisible();
    await expect(page.getByLabel('Last name')).toBeVisible();
  });

  test('shows delivery address form when delivery is selected', async ({ page }) => {
    await page.goto(menuPage('en'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    await page.goto('/en/checkout');
    await waitForHydration(page);

    // Checkout defaults to pickup — switch to delivery
    await page.getByText('Delivery', { exact: true }).click();
    await expect(page.getByLabel('Street and number')).toBeVisible();
    await expect(page.getByLabel('City')).toBeVisible();
    await expect(page.getByLabel('Postal code')).toBeVisible();
  });

  test('hides address form when pickup is selected', async ({ page }) => {
    await page.goto(menuPage('en'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    await page.goto('/en/checkout');
    await waitForHydration(page);

    // Pickup is the default — address fields should be hidden
    await expect(page.getByLabel('Street and number')).toBeHidden();

    // Pickup location selector should be visible
    await expect(page.getByText('Pickup location')).toBeVisible();
  });

  test('shows scheduling picker', async ({ page }) => {
    await page.goto(menuPage('en'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    await page.goto('/en/checkout');
    await waitForHydration(page);

    await expect(page.getByText('As soon as possible')).toBeVisible();
    await expect(page.getByText('Schedule for later')).toBeVisible();
  });

  test('redirects to menu when cart is empty', async ({ page }) => {
    // Don't add products — go directly to checkout
    await page.goto('/en/checkout');
    await waitForHydration(page);

    // CheckoutPage redirects to menu when cart is empty
    await page.waitForURL('**/en/');
  });

  test('mobile: place order button is visible', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(menuPage('en'));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    await page.goto('/en/checkout');
    await waitForHydration(page);

    // Mobile sticky CTA is md:hidden, contains "Place order" text
    const mobileCta = page.locator('.md\\:hidden').getByText('Place order');
    await expect(mobileCta).toBeVisible();
  });
});
