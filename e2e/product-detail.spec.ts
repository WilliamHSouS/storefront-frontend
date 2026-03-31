import { test, expect } from '@playwright/test';
import {
  resetMockApi,
  menuPage,
  waitForHydration,
  blockAnalytics,
  openProductDetailModal,
} from './helpers/test-utils';
import { products, shawarmaDetail } from './fixtures/products';

const shawarma = products[1]; // has modifiers (Size required, Extras optional)
const sizeGroup = shawarmaDetail.modifier_groups[0]; // Size — radio, required
const extrasGroup = shawarmaDetail.modifier_groups[1]; // Extras — checkbox, optional

test.describe('Product detail modal — open and close', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('modal opens for product with modifiers', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Verify product info is displayed
    await expect(modal.getByRole('heading', { name: shawarma.title })).toBeVisible();
    await expect(modal.getByText(shawarma.description)).toBeVisible();
    // Base price: €14.50 -> "€ 14,50" — use .first() to avoid matching the CTA button text
    await expect(modal.getByText('€ 14,50').first()).toBeVisible();
  });

  test('modal closes on backdrop click', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Click on the backdrop (the area outside the dialog panel).
    // On mobile the bottom sheet covers most of the viewport, so click at
    // the very top (y=5) which is always in the backdrop area.
    const vp = page.viewportSize()!;
    await page.mouse.click(vp.width / 2, 5);

    await expect(modal).toBeHidden();
  });

  test('modal closes on Escape', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');

    await expect(modal).toBeHidden();
  });

  test('product card click opens modal and updates URL', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Click the product card link (not the Add button)
    const productLink = page.locator('[data-product-modal]').first();
    const slug = await productLink.getAttribute('data-product-slug');
    await productLink.click();

    // Modal should appear
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // URL should contain the product slug — use waitForURL to handle async pushState
    await page.waitForURL(`**/product/${slug}`, { timeout: 5_000 });
    expect(page.url()).toContain(`/product/${slug}`);

    // Close modal via Escape
    await page.keyboard.press('Escape');

    // Modal should close and URL should revert
    await expect(modal).toBeHidden();
    await page.waitForURL(/.*\/(?:nl|en)\/$/, { timeout: 5_000 }).catch(() => {});
    expect(page.url()).not.toContain('/product/');
  });

  test('browser back button closes modal and reverts URL', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const productLink = page.locator('[data-product-modal]').first();
    await productLink.click();

    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5_000 });
    // Wait for URL push — the history.pushState happens async after modal opens
    await page.waitForURL(/\/product\//, { timeout: 3_000 });

    // Press browser back button
    await page.goBack();

    await expect(modal).toBeHidden();
    await page.waitForURL(/\/(?:nl|en)\/$/, { timeout: 3_000 }).catch(() => {});
    expect(page.url()).not.toContain('/product/');
  });

  test('focus is trapped inside modal', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Focus the first interactive element inside the modal before tabbing
    await modal.getByRole('button').first().focus();

    // Tab through all focusable elements repeatedly.
    // After enough tabs, focus should still be inside the modal (not escape to the page behind).
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
    }

    // The currently focused element should be within the modal
    const focusedInsideModal = await modal.evaluate((el) => {
      return el.contains(document.activeElement);
    });
    expect(focusedInsideModal).toBe(true);
  });
});

test.describe('Product detail modal — modifier groups', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('required modifier shows Required badge', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // The Size group is required and should show "Verplicht" badge
    const sizeSection = modal.locator(`#modifier-group-${sizeGroup.id}`);
    await expect(sizeSection.getByText('Verplicht')).toBeVisible();

    // The Extras group is optional — should NOT show the required badge
    const extrasSection = modal.locator(`#modifier-group-${extrasGroup.id}`);
    await expect(extrasSection.getByText('Verplicht')).toBeHidden();
  });

  test('selecting modifier updates CTA price', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // CTA button shows "Toevoegen" with the base price
    const ctaButton = modal.getByRole('button', { name: /Toevoegen/ });
    await expect(ctaButton).toBeVisible();
    // Base price: €14.50
    await expect(ctaButton).toContainText('€ 14,50');

    // Select "Large" (+€3.00) — total should become €17.50
    // The radio's accessible name includes the price suffix, so use a regex
    await modal.getByRole('radio', { name: /Large/ }).check();
    await expect(ctaButton).toContainText('€ 17,50');
  });

  test('submit without required modifier shows error', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Try to submit without selecting the required Size modifier.
    const ctaButton = modal.getByRole('button', { name: /Toevoegen/ });
    // eslint-disable-next-line playwright/no-force-option -- bypass pointer-event interception in modal
    await ctaButton.click({ force: true });

    // The required group should get the shake animation class
    const sizeSection = modal.locator(`#modifier-group-${sizeGroup.id}`);
    await expect(sizeSection).toHaveClass(/animate-shake/);

    // The modal should still be visible (submission was blocked)
    await expect(modal).toBeVisible();
  });

  test('selecting required modifier enables submit', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Select the required "Regular" option — use .first() because radio labels
    // may match multiple elements in preview mode
    await modal.getByRole('radio', { name: 'Regular' }).first().check();

    // The "Verplicht" badge should change to a checkmark
    const sizeSection = modal.locator(`#modifier-group-${sizeGroup.id}`);
    await expect(sizeSection.getByText('Verplicht')).toBeHidden();

    // Submit should now work — clicking the CTA should add to cart.
    const ctaButton = modal.getByRole('button', { name: /Toevoegen/ });
    // eslint-disable-next-line playwright/no-force-option -- bypass pointer-event interception in modal
    await ctaButton.click({ force: true });

    // Product has suggestions, so the modal transitions to the upsell step
    // instead of closing immediately. Dismiss via the Done button.
    await expect(modal.getByText('Toegevoegd')).toBeVisible({ timeout: 5_000 });
    await modal.getByRole('button', { name: 'Klaar' }).click();

    // Modal should close after dismissing upsell step
    await expect(modal).toBeHidden();

    // Cart state should be updated — a cart trigger should be visible.
    // CartBadge (desktop, hidden on mobile) and CartBar (mobile-only) both
    // have data-cart-trigger. Use `locator('visible=true')` to pick whichever
    // is visible in the current viewport.
    await expect(page.locator('[data-cart-trigger]').locator('visible=true').first()).toBeVisible();
  });

  test('optional checkbox toggles price correctly', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    const ctaButton = modal.getByRole('button', { name: /Toevoegen/ });

    // Base price: €14.50
    await expect(ctaButton).toContainText('€ 14,50');

    // Check "Halloumi" (+€2.50) -> total €17.00
    // Checkbox accessible names include the price suffix, so use regex
    await modal.getByRole('checkbox', { name: /Halloumi/ }).check();
    await expect(ctaButton).toContainText('€ 17,00');

    // Also check "Avocado" (+€2.00) -> total €19.00
    await modal.getByRole('checkbox', { name: /Avocado/ }).check();
    await expect(ctaButton).toContainText('€ 19,00');

    // Uncheck "Halloumi" -> total back to €16.50
    await modal.getByRole('checkbox', { name: /Halloumi/ }).uncheck();
    await expect(ctaButton).toContainText('€ 16,50');
  });
});

test.describe('Product detail modal — quantity and notes', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('quantity selector updates price in modal', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    const ctaButton = modal.getByRole('button', { name: /Toevoegen/ });

    // Base price at quantity 1: €14.50
    await expect(ctaButton).toContainText('€ 14,50');

    // Increase quantity to 2 via the quantity selector in the CTA area
    // The QuantitySelector in the modal footer has "Increase quantity" button
    await modal.getByRole('button', { name: 'Aantal verhogen' }).click();

    // Total should be 2 x €14.50 = €29.00
    await expect(ctaButton).toContainText('€ 29,00');
  });

  test('notes textarea accepts input', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Click the "Notitie toevoegen" button to reveal the textarea
    await modal.getByRole('button', { name: 'Notitie toevoegen' }).click();

    // Textarea should appear with the placeholder
    const textarea = modal.getByPlaceholder('Notitie toevoegen');
    await expect(textarea).toBeVisible();

    // Type a note
    await textarea.fill('Extra spicy please');
    await expect(textarea).toHaveValue('Extra spicy please');
  });
});
