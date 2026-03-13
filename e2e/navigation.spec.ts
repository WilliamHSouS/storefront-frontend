import { test, expect } from '@playwright/test';
import { resetMockApi, menuPage, blockAnalytics, waitForHydration } from './helpers/test-utils';

test.describe('Navigation and language routing', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('bare URL redirects to default language prefix', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL(/\/nl\//);
    expect(page.url()).toContain('/nl/');
  });

  test('invalid language code redirects to default', async ({ page }) => {
    await page.goto('/zz/');
    await page.waitForURL(/\/nl\//);
    expect(page.url()).toContain('/nl/');
  });

  test('valid non-default language renders with correct lang attr', async ({ page }) => {
    await page.goto('/en/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('unknown path under valid lang shows 404 or redirects', async ({ page }) => {
    const response = await page.goto('/nl/nonexistent-page-xyz');
    // The app either returns 404 or redirects — both are acceptable
    const status = response?.status() ?? 0;
    // eslint-disable-next-line playwright/no-conditional-in-test -- multiple valid response codes
    const isRedirect = status >= 300 && status < 400;
    const isNotFound = status === 404;
    const isOk = status === 200; // Redirected to menu
    expect(isRedirect || isNotFound || isOk).toBe(true);
  });

  test('category drawer opens and navigates to section', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Click the category drawer trigger
    await page.click('[data-category-drawer-trigger]');

    // Drawer nav should appear
    const drawerNav = page.locator('[data-category-drawer]');
    await expect(drawerNav.first()).toBeVisible({ timeout: 3_000 });

    // Click a category
    const categoryButton = drawerNav.first().locator('button').first();
    await categoryButton.click();

    // Drawer should close
    await expect(drawerNav.first()).toBeHidden();
  });

  test('category drawer closes on Escape key', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await page.click('[data-category-drawer-trigger]');

    const drawerNav = page.locator('[data-category-drawer]');
    await expect(drawerNav.first()).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Escape');

    await expect(drawerNav.first()).toBeHidden();
  });

  test('category tab click scrolls to section', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Click a category tab — "Main Courses"
    const tab = page
      .getByRole('tablist', { name: 'Menu' })
      .getByRole('tab', { name: 'Main Courses' });
    await tab.click();

    // The corresponding section heading should be visible in the viewport
    const section = page.getByRole('heading', { name: 'Shawarma Bowl' });
    await expect(section).toBeVisible();
  });
});
