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
});
