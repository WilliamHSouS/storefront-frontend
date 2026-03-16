import { test, expect } from '@playwright/test';
import { resetMockApi, menuPage, waitForHydration, blockAnalytics } from './helpers/test-utils';

test.describe('Merchant Communications — banners', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('top banner renders with correct content', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('sous:comms:modal_shown', '1'));
    await page.goto(menuPage());
    await waitForHydration(page);

    const banner = page.locator('[data-comms-banner="top"]');
    await banner.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(banner).toContainText('Free delivery this weekend!');
    await expect(banner).toContainText('Orders over €25 ship free.');
    await expect(banner.getByRole('link', { name: 'Shop now' })).toBeVisible();
  });

  test('bottom banner renders', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('sous:comms:modal_shown', '1'));
    await page.goto(menuPage());
    await waitForHydration(page);

    const banner = page.locator('[data-comms-banner="bottom"]');
    await banner.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(banner).toContainText('New: order tracking!');
  });

  test('dismiss button hides top banner', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('sous:comms:modal_shown', '1'));
    await page.goto(menuPage());
    await waitForHydration(page);

    const banner = page.locator('[data-comms-banner="top"]');
    await banner.waitFor({ state: 'visible', timeout: 5_000 });

    // Use dispatchEvent to bypass hit-testing — the fixed bottom banner
    // at the same z-index can intercept pointer events on the top banner
    await banner.getByRole('button', { name: /sluiten|dismiss/i }).dispatchEvent('click');
    await expect(banner).toBeHidden();
  });

  test('dismissed banner stays hidden after navigation', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('sous:comms:modal_shown', '1'));
    await page.goto(menuPage());
    await waitForHydration(page);

    const banner = page.locator('[data-comms-banner="top"]');
    await banner.waitFor({ state: 'visible', timeout: 5_000 });

    await banner.getByRole('button', { name: /sluiten|dismiss/i }).dispatchEvent('click');
    await expect(banner).toBeHidden();

    // Navigate to English page and back
    await page.goto(menuPage('en'));
    await waitForHydration(page);
    // Banner should still be hidden (localStorage persisted)
    await expect(page.locator('[data-comms-banner="top"]')).toBeHidden();
  });

  test('modal renders with promotional content', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page, { dismissModal: false });

    const modal = page.locator('[data-comms-modal]');
    await modal.waitFor({ state: 'visible', timeout: 5_000 });
    await expect(modal.getByRole('dialog')).toBeVisible();
    await expect(modal).toContainText('Welcome!');
    await expect(modal).toContainText('First order? Get 10% off.');
    await expect(modal.getByRole('link', { name: 'Claim offer' })).toBeVisible();
  });

  test('CTA link has correct href', async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('sous:comms:modal_shown', '1'));
    await page.goto(menuPage());
    await waitForHydration(page);

    const banner = page.locator('[data-comms-banner="top"]');
    await banner.waitFor({ state: 'visible', timeout: 5_000 });
    const ctaLink = banner.getByRole('link', { name: 'Shop now' });
    await expect(ctaLink).toHaveAttribute('href', '/nl/collection/weekend-deals');
  });
});
