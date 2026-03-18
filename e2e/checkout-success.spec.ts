import { test, expect } from '@playwright/test';
import { resetMockApi, waitForHydration, blockAnalytics } from './helpers/test-utils';
import { mockStripe } from './helpers/stripe-mock';

test.describe('Checkout success page', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('shows order confirmation with order number', async ({ page }) => {
    await page.goto('/en/checkout/success?order=ORD-12345');
    await waitForHydration(page);

    await expect(page.getByText('Order confirmed!')).toBeVisible();
    await expect(page.getByText('ORD-12345')).toBeVisible();
  });

  test('back to menu link works', async ({ page }) => {
    await page.goto('/en/checkout/success?order=ORD-12345');
    await waitForHydration(page);

    await page.getByText('Back to menu').click();
    await page.waitForURL('**/en/');
  });

  test('redirects to menu with no valid params', async ({ page }) => {
    await page.goto('/en/checkout/success');
    await waitForHydration(page);

    // CheckoutSuccess redirects to /{lang}/ when no order or checkout_id params
    await page.waitForURL('**/en/', { timeout: 5_000 });
  });
});
