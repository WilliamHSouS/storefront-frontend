import { test, expect } from '@playwright/test';
import { resetMockApi, blockAnalytics } from './helpers/test-utils';

test.describe('Checkout security headers', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('checkout page has no-store cache control', async ({ page }) => {
    const responsePromise = page.waitForResponse('**/en/checkout');
    await page.goto('/en/checkout');
    const response = await responsePromise;
    const headers = response.headers();
    expect(headers['cache-control']).toContain('no-store');
  });

  test('success page has no-store cache control', async ({ page }) => {
    const responsePromise = page.waitForResponse('**/en/checkout/success**');
    await page.goto('/en/checkout/success?order=test');
    const response = await responsePromise;
    const headers = response.headers();
    expect(headers['cache-control']).toContain('no-store');
  });
});
