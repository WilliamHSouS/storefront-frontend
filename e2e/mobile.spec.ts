import { test, expect } from '@playwright/test';
import {
  resetMockApi,
  menuPage,
  blockAnalytics,
  waitForHydration,
  addSimpleProductToCart,
  openProductDetailModal,
} from './helpers/test-utils';

test.describe('Mobile', () => {
  test.beforeEach(async ({ page }) => {
    // eslint-disable-next-line playwright/no-skipped-test -- project-gated tests
    test.skip(test.info().project.name !== 'mobile', 'Mobile only');
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('cart bar appears fixed at bottom after adding item', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, 'prod-1');

    // CartBar should now appear — use colon in name to distinguish from header button
    // CartBar aria-label: "Winkelwagen: 1 item, € 8,50"
    const cartBar = page.getByRole('button', { name: /Winkelwagen:/ });
    await expect(cartBar).toBeVisible({ timeout: 5_000 });

    // Verify the cart bar is positioned fixed at the bottom
    const boundingBox = await cartBar.boundingBox();
    const viewport = page.viewportSize();
    expect(boundingBox).toBeTruthy();
    expect(viewport).toBeTruthy();

    // The bottom edge of the cart bar should be near the bottom of the viewport
    const bottomEdge = boundingBox!.y + boundingBox!.height;
    expect(bottomEdge).toBeGreaterThan(viewport!.height - 80);
  });

  test('cart drawer opens as bottom sheet', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, 'prod-1');

    // Open the cart drawer by tapping the CartBar
    const cartBar = page.getByRole('button', { name: /Winkelwagen:/ });
    await expect(cartBar).toBeVisible({ timeout: 5_000 });
    await cartBar.click();

    // The cart drawer dialog should appear
    const cartDialog = page.getByRole('dialog', { name: /Winkelwagen/i });
    await expect(cartDialog).toBeVisible({ timeout: 5_000 });

    // On mobile, the drawer renders as a bottom sheet — anchored to the bottom
    const dialogBox = await cartDialog.boundingBox();
    const viewport = page.viewportSize();
    expect(dialogBox).toBeTruthy();
    expect(viewport).toBeTruthy();

    // The bottom edge of the dialog should touch or be near the viewport bottom
    const bottomEdge = dialogBox!.y + dialogBox!.height;
    expect(bottomEdge).toBeGreaterThanOrEqual(viewport!.height - 5);

    // The dialog should span the full width on mobile
    expect(dialogBox!.width).toBeGreaterThanOrEqual(viewport!.width - 10);
  });

  test('product detail opens as bottom sheet', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Open the Shawarma Bowl product detail (has modifiers)
    const dialog = await openProductDetailModal(page, 'prod-2');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(dialogBox).toBeTruthy();
    expect(viewport).toBeTruthy();

    // On mobile, the dialog is anchored to the bottom (bottom-0, rounded-t-xl)
    const bottomEdge = dialogBox!.y + dialogBox!.height;
    expect(bottomEdge).toBeGreaterThanOrEqual(viewport!.height - 5);

    // Should span full width on mobile
    expect(dialogBox!.width).toBeGreaterThanOrEqual(viewport!.width - 10);
  });

  test('category drawer opens on mobile', async ({ page }) => {
    // CategoryTabs is hidden on mobile (md:flex). On mobile, categories are
    // accessed via the CategoryDrawer trigger button instead.
    await page.goto(menuPage());
    await waitForHydration(page);

    const drawerNav = page.locator('[data-category-drawer]');

    // Retry clicking — CategoryDrawer island (client:idle) may not have hydrated yet
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.click('[data-category-drawer-trigger]');
      try {
        await drawerNav.first().waitFor({ state: 'visible', timeout: 2_000 });
        break;
      } catch {
        // Island not hydrated yet — retry
      }
    }
    await expect(drawerNav.first()).toBeVisible();

    // Drawer should contain category buttons
    const buttons = drawerNav.first().locator('button');
    const buttonCount = await buttons.count();
    expect(buttonCount).toBeGreaterThanOrEqual(2);
  });
});
