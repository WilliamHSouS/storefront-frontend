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

const LANG = 'en';
const falafel = products[0]; // simple, no modifiers

test.describe('Shipping rate selection', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await mockStripe(page);
  });

  test('user can select Uber Direct shipping rate', async ({ page }) => {
    await page.goto(menuPage(LANG));
    await waitForHydration(page);
    await addSimpleProductToCart(page, falafel.id);

    await page.goto(`/${LANG}/checkout`);
    await waitForHydration(page);

    // Fill in contact info
    await page.fill('input[name="email"]', 'test@example.com');
    await page.fill('input[name="firstName"]', 'Test');
    await page.fill('input[name="lastName"]', 'User');
    await page.fill('input[name="phone"]', '+31612345678');

    // Fill in delivery address
    await page.fill('#checkout-street', 'Keizersgracht 1');
    await page.fill('#checkout-city', 'Amsterdam');
    await page.fill('#checkout-postalCode', '1012AB');

    // Blur to trigger delivery PATCH
    await page.locator('#checkout-postalCode').blur();

    // Wait for shipping rates to appear
    await expect(page.locator('[data-rate-id="rate-local"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-rate-id="rate-uber"]')).toBeVisible();

    // Verify both rates are shown with names
    await expect(page.locator('[data-rate-id="rate-local"]')).toContainText('Local Delivery');
    await expect(page.locator('[data-rate-id="rate-uber"]')).toContainText('Uber Direct');

    // Select Uber Direct
    await page.locator('[data-rate-id="rate-uber"]').click();

    // Verify it's highlighted (selected state)
    await expect(page.locator('[data-rate-id="rate-uber"]')).toHaveClass(/border-primary/);

    // Verify Uber Direct rate shows expiry indicator
    await expect(page.locator('[data-rate-id="rate-uber"]')).toContainText('Price valid for');
  });
});
