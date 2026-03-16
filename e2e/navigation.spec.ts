import { test, expect } from '@playwright/test';
import { resetMockApi, menuPage, blockAnalytics, waitForHydration } from './helpers/test-utils';

test.describe('Navigation and language routing', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('bare URL redirects to a supported language prefix', async ({ page }) => {
    await page.goto('/');
    // The middleware negotiates language from Accept-Language and redirects.
    // In preview mode the redirect may be internal. Verify the page ends up
    // at a supported language (nl or en) either via URL or rendered content.
    try {
      await page.waitForURL(/\/(nl|en)\//, { timeout: 5_000 });
    } catch {
      // URL didn't change — verify the page rendered with a supported language
      const lang = await page.locator('html').getAttribute('lang');
      expect(['nl', 'en']).toContain(lang);
    }
  });

  test('invalid language code redirects to a supported language', async ({ page }) => {
    await page.goto('/zz/');
    try {
      await page.waitForURL(/\/(nl|en)\//, { timeout: 5_000 });
    } catch {
      const lang = await page.locator('html').getAttribute('lang');
      expect(['nl', 'en']).toContain(lang);
    }
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

    // The CategoryDrawer renders two variants: a mobile full-screen overlay
    // (md:hidden) and a desktop dropdown popover (hidden md:block). Use
    // `locator('visible=true')` to find whichever is visible in the viewport.
    const drawerNav = page.locator('[data-category-drawer]');

    // Retry clicking the trigger — the CategoryDrawer island (client:idle) may
    // not have hydrated yet in preview mode, so the custom event may be lost.
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.click('[data-category-drawer-trigger]');
      try {
        await drawerNav
          .locator('visible=true')
          .first()
          .waitFor({ state: 'visible', timeout: 2_000 });
        break;
      } catch {
        // Island not hydrated yet — retry
      }
    }
    const visibleDrawer = drawerNav.locator('visible=true').first();
    await expect(visibleDrawer).toBeVisible({ timeout: 3_000 });

    // Click a category
    const categoryButton = visibleDrawer.locator('button').first();
    await categoryButton.click();

    // Drawer should close
    await expect(visibleDrawer).toBeHidden();
  });

  test('category drawer closes on Escape key', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const drawerNav = page.locator('[data-category-drawer]');

    // Retry clicking the trigger for hydration timing
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.click('[data-category-drawer-trigger]');
      try {
        await drawerNav
          .locator('visible=true')
          .first()
          .waitFor({ state: 'visible', timeout: 2_000 });
        break;
      } catch {
        // Island not hydrated yet — retry
      }
    }
    const visibleDrawer = drawerNav.locator('visible=true').first();
    await expect(visibleDrawer).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press('Escape');

    await expect(visibleDrawer).toBeHidden();
  });

  test('category tab click scrolls to section', async ({ page }) => {
    // CategoryTabs are hidden on mobile (md:flex only) — skip on mobile
    // eslint-disable-next-line playwright/no-skipped-test -- desktop-only component
    test.skip(test.info().project.name === 'mobile', 'CategoryTabs hidden on mobile');

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

test.describe('Multi-locale routing', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('English menu page renders', async ({ page }) => {
    await page.goto(menuPage('en'));
    await waitForHydration(page);

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('[data-product-id]').first()).toBeVisible();
  });

  test('German menu page redirects to default (de not supported)', async ({ page }) => {
    // bar-sumac only supports nl and en — /de/ should redirect to /nl/
    await page.goto(menuPage('de'));
    await waitForHydration(page);

    // Middleware redirects unsupported language to default; in preview mode
    // the redirect may be internal, so check the rendered lang attribute.
    const lang = await page.locator('html').getAttribute('lang');
    expect(['nl', 'en']).toContain(lang);
    await expect(page.locator('[data-product-id]').first()).toBeVisible();
  });

  test('Accept-Language header negotiation', async ({ page }) => {
    // bar-sumac supports nl and en. When Accept-Language prefers en, the
    // middleware should negotiate to en instead of the default nl.
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en,nl;q=0.9' });
    await page.goto('/');
    try {
      await page.waitForURL(/\/en\//, { timeout: 5_000 });
    } catch {
      // In preview mode, the URL may not change but the page renders with en
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    }
  });
});
