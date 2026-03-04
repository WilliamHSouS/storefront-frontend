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

test.describe('Cart — modifier display', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('shows modifier group names and prices in cart', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Add Shawarma Bowl with modifiers via product detail
    await openProductDetailModal(page, shawarma.id);
    // Select "Large" size (+€3.00)
    await page.getByRole('radio', { name: 'Large' }).click();

    // Wait for POST response after clicking "add to order"
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/items/') &&
        resp.url().includes('/api/v1/cart/') &&
        resp.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /toevoegen aan bestelling/i }).click();
    await responsePromise;

    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Assert modifier group name and price visible within the cart drawer
    const cartItem = drawer.locator('li').first();
    await expect(cartItem.getByText('Size: Large')).toBeVisible();
    await expect(cartItem.getByText(/\+€/)).toBeVisible();
  });
});

test.describe('Cart — order summary', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('shows subtotal and tax rows', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);
    await openCartDrawer(page);

    // Assert subtotal row
    await expect(page.getByText('Subtotaal')).toBeVisible();
    // Assert tax row (Dutch: "incl. BTW")
    await expect(page.getByText('incl. BTW')).toBeVisible();
    // Assert total row (exact match to avoid matching "Subtotaal")
    await expect(page.getByText('Totaal', { exact: true })).toBeVisible();
  });
});

test.describe('Cart — promotion banner', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('shows promotion banner when eligible', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Add 1 Falafel Wrap, then increment to qty 2 to trigger BOGO promo
    await addSimpleProductToCart(page, falafel.id);
    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Increment quantity to 2
    const patchResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes('/items/') &&
        resp.url().includes('/api/v1/cart/') &&
        resp.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: 'Aantal verhogen' }).click();
    await patchResponse;

    // Wait for the promotion eligibility check (300ms debounce + API call)
    await expect(page.locator('[role="status"]').filter({ hasText: /falafel/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('hides promotion banner when cart is emptied', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Add 1 Falafel Wrap, then increment to qty 2 to trigger BOGO promo
    await addSimpleProductToCart(page, falafel.id);
    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Increment quantity to 2
    const patchResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes('/items/') &&
        resp.url().includes('/api/v1/cart/') &&
        resp.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: 'Aantal verhogen' }).click();
    await patchResponse;

    // Banner should be visible
    await expect(page.locator('[role="status"]').filter({ hasText: /falafel/i })).toBeVisible({
      timeout: 10_000,
    });

    // Remove item: click trash/remove button which triggers confirm dialog
    // First decrement from 2 to 1
    const patchResponse2 = page.waitForResponse(
      (resp) =>
        resp.url().includes('/items/') &&
        resp.url().includes('/api/v1/cart/') &&
        resp.request().method() === 'PATCH',
    );
    await drawer.getByRole('button', { name: 'Aantal verminderen' }).click();
    await patchResponse2;

    // Now at qty 1, click remove (trash icon) to trigger confirm dialog
    await drawer.getByRole('button', { name: 'Item verwijderen' }).first().click();
    const confirmDialog = page.getByRole('alertdialog', { name: 'Verwijderen' });
    await expect(confirmDialog).toBeVisible();

    const deleteResponse = page.waitForResponse(
      (resp) =>
        resp.url().includes('/items/') &&
        resp.url().includes('/api/v1/cart/') &&
        resp.request().method() === 'DELETE',
    );
    await confirmDialog.getByRole('button', { name: 'Verwijderen' }).click();
    await deleteResponse;

    // Banner should be gone
    await expect(page.locator('[role="status"]').filter({ hasText: /falafel/i })).toBeHidden();
  });
});

test.describe('Cart — discount codes', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('apply and remove a discount code', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);
    const drawer = await openCartDrawer(page);

    // Fill in discount code
    const input = drawer.getByLabel('Kortingscode');
    await input.fill('SAVE10');

    // Apply discount
    const applyResponse = page.waitForResponse(
      (resp) => resp.url().includes('/apply-discount/') && resp.request().method() === 'POST',
    );
    await drawer.getByRole('button', { name: 'Toepassen' }).click();
    await applyResponse;

    // Discount should be visible in the footer
    await expect(drawer.getByText('SAVE10')).toBeVisible();
    const removeBtn = drawer.getByRole('button', { name: 'Verwijderen', exact: true });
    await expect(removeBtn).toBeVisible();

    // Remove discount
    const removeResponse = page.waitForResponse(
      (resp) => resp.url().includes('/remove-discount/') && resp.request().method() === 'DELETE',
    );
    await removeBtn.click();
    await removeResponse;

    // Input should reappear
    await expect(drawer.getByLabel('Kortingscode')).toBeVisible();
  });

  test('shows error for invalid discount code', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);
    const drawer = await openCartDrawer(page);

    const input = drawer.getByLabel('Kortingscode');
    await input.fill('INVALID');

    const applyResponse = page.waitForResponse(
      (resp) => resp.url().includes('/apply-discount/') && resp.request().method() === 'POST',
    );
    await drawer.getByRole('button', { name: 'Toepassen' }).click();
    await applyResponse;

    // Toast should show invalid code message (Dutch) — rendered outside drawer via portal
    await expect(page.getByText('Ongeldige kortingscode')).toBeVisible({ timeout: 5_000 });
  });
});
