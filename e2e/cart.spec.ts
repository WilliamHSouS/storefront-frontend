import { test, expect } from '@playwright/test';
import {
  resetMockApi,
  menuPage,
  cartPage,
  waitForHydration,
  blockAnalytics,
  addSimpleProductToCart,
  openCartDrawer,
  openProductDetailModal,
} from './helpers/test-utils';
import { products } from './fixtures/products';

const falafel = products[0]; // simple, no modifiers
const shawarma = products[1]; // has modifiers

test.describe('Cart — adding items', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('add simple product to cart updates button state', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);

    // After adding, AddToCartButton changes from "Toevoegen" to a quantity badge
    const card = page.locator(`[data-product-id="${falafel.id}"]`).first();
    await expect(card.getByRole('button', { name: /in winkelwagen/ })).toBeVisible();
  });

  test('add complex product opens product detail modal first', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Click the Shawarma Bowl add button — has modifiers so opens modal
    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByRole('heading', { name: shawarma.name })).toBeVisible();
  });
});

test.describe('Cart drawer — display and interaction', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('cart drawer opens from header cart button', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);

    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });
  });

  test('cart drawer shows item with correct name and price', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);

    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    await expect(drawer.getByRole('heading', { name: falafel.name })).toBeVisible();
    // nl-NL formats EUR as "€ 8,50" — scope to the line item to avoid matching
    // the order total (which is also €8,50 for a single item)
    await expect(drawer.locator('li').first().getByText('€ 8,50')).toBeVisible();
  });

  test('increment quantity updates total', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);

    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Wait for PATCH response after incrementing
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/items/') &&
        resp.url().includes('/api/v1/cart/') &&
        resp.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: 'Aantal verhogen' }).click();
    await responsePromise;

    // Line item total should update to 2x €8.50 = €17.00
    await expect(drawer.locator('li').first().getByText('€ 17,00')).toBeVisible();
  });

  test('decrement to zero shows confirm remove dialog', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);

    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // With quantity 1, the minus button shows trash icon with "Remove item".
    // Use .first() in case the QuantitySelector renders multiple matching buttons.
    await drawer.getByRole('button', { name: 'Item verwijderen' }).first().click();

    // ConfirmRemoveDialog should appear as an alertdialog
    const confirmDialog = page.getByRole('alertdialog', { name: 'Verwijderen' });
    await expect(confirmDialog).toBeVisible();
  });

  test('confirm remove empties cart', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);

    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    await drawer.getByRole('button', { name: 'Item verwijderen' }).first().click();

    const confirmDialog = page.getByRole('alertdialog', { name: 'Verwijderen' });
    await expect(confirmDialog).toBeVisible();

    // Wait for DELETE response after confirming removal
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/items/') &&
        resp.url().includes('/api/v1/cart/') &&
        resp.request().method() === 'DELETE',
    );
    await confirmDialog.getByRole('button', { name: 'Verwijderen' }).click();
    await responsePromise;

    // Cart should now show empty state
    await expect(page.getByText('Je winkelwagen is leeg')).toBeVisible();
  });

  test('cart drawer closes on X button', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);

    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    await drawer.getByRole('button', { name: 'Sluiten' }).click();
    await expect(drawer).toBeHidden();
  });

  test('cart drawer closes on Escape key', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);

    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // The focus trap's Escape handler is a document-level keydown listener
    // attached via useEffect. We must wait briefly for Preact's useEffect
    // to fire after the drawer renders (DOM visible ≠ effects complete).
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
  });
});

test.describe('Cart page — inline mode', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('cart page shows empty state without dialog overlay', async ({ page }) => {
    await page.goto(cartPage());
    await waitForHydration(page);

    // Inline CartDrawer shows empty cart text (cart state doesn't persist across navigation)
    await expect(page.getByText('Je winkelwagen is leeg')).toBeVisible();

    // No dialog overlay should be present — inline mode renders a plain <div>
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('cart page empty state has continue shopping link', async ({ page }) => {
    await page.goto(cartPage());
    await waitForHydration(page);

    // Empty state has a "Verder winkelen" link back to the menu
    const link = page.getByRole('link', { name: /Verder winkelen/ });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/nl/');
  });
});
