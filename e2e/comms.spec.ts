import { test, expect } from '@playwright/test';
import { resetMockApi, menuPage, waitForHydration, blockAnalytics } from './helpers/test-utils';

test.describe('Merchant Communications — banners', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('top banner renders with correct content', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const banner = page.locator('[data-comms-banner="top"]');
    await banner.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(banner).toContainText('Free delivery this weekend!');
    await expect(banner).toContainText('Orders over €25 ship free.');
    await expect(banner.getByRole('link', { name: 'Shop now' })).toBeVisible();
  });

  test('bottom banner renders', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const banner = page.locator('[data-comms-banner="bottom"]');
    await banner.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(banner).toContainText('New: order tracking!');
  });

  test('dismiss button hides top banner', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const banner = page.locator('[data-comms-banner="top"]');
    await banner.waitFor({ state: 'visible', timeout: 5_000 });

    // Click the dismiss button (aria-label matches dismissBanner i18n key for nl)
    await banner.getByRole('button', { name: /sluiten|dismiss/i }).click();
    await expect(banner).toBeHidden();
  });

  test('dismissed banner stays hidden after navigation', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const banner = page.locator('[data-comms-banner="top"]');
    await banner.waitFor({ state: 'visible', timeout: 5_000 });
    await banner.getByRole('button', { name: /sluiten|dismiss/i }).click();
    await expect(banner).toBeHidden();

    // Navigate to English page and back
    await page.goto(menuPage('en'));
    await waitForHydration(page);
    // Banner should still be hidden (localStorage persisted)
    await expect(page.locator('[data-comms-banner="top"]')).toBeHidden();
  });

  test('no banners when API returns empty array', async ({ page }) => {
    // Override the comms route to return empty
    await page.route('**/merchant-comms/widget/active/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.goto(menuPage());
    await waitForHydration(page);

    await expect(page.locator('[data-comms-banner="top"]')).toBeHidden();
    await expect(page.locator('[data-comms-banner="bottom"]')).toBeHidden();
  });

  test('CTA link has correct href', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const banner = page.locator('[data-comms-banner="top"]');
    await banner.waitFor({ state: 'visible', timeout: 5_000 });
    const ctaLink = banner.getByRole('link', { name: 'Shop now' });
    await expect(ctaLink).toHaveAttribute('href', '/nl/collection/weekend-deals');
  });
});
