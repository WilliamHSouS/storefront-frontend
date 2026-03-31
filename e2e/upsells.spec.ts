import { test, expect } from '@playwright/test';
import {
  resetMockApi,
  menuPage,
  waitForHydration,
  blockAnalytics,
  openProductDetailModal,
  addSimpleProductToCart,
  openCartDrawer,
} from './helpers/test-utils';
import { products } from './fixtures/products';

const shawarma = products[1]; // prod-2, has modifiers + suggestions
const falafel = products[0]; // prod-1, simple product + suggestions

test.describe('Upsells — PDP suggestions', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('suggestions render with add buttons in product modal', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Wait for suggestions to load
    await expect(modal.getByText('Vaak gecombineerd met')).toBeVisible({ timeout: 5_000 });

    // Suggestion items should be visible with add buttons
    await expect(modal.getByText('Mint Lemonade')).toBeVisible();
    await expect(modal.getByText('Baklava')).toBeVisible();

    // Each suggestion should have an add button
    const addButtons = modal.getByRole('button', {
      name: /Toevoegen.*Mint Lemonade|Toevoegen.*Baklava/,
    });
    await expect(addButtons.first()).toBeVisible();
  });

  test('clicking add button on suggestion adds item to cart', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Wait for suggestions to load
    await expect(modal.getByText('Mint Lemonade')).toBeVisible({ timeout: 5_000 });

    // Click the add button for Mint Lemonade
    const addButton = modal.getByRole('button', { name: /Toevoegen.*Mint Lemonade/ });
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/items/') &&
        resp.url().includes('/api/v1/cart/') &&
        resp.request().method() === 'POST',
    );
    await addButton.click();
    const response = await responsePromise;

    // Verify the item was added (API returned 201)
    expect(response.status()).toBe(201);
  });
});

test.describe('Upsells — post-add upsell step', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('upsell step shows after adding product with suggestions', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Select required modifier and submit
    await modal.getByRole('radio', { name: 'Regular' }).check();
    const ctaButton = modal.getByRole('button', { name: /Toevoegen.*€/ });
    // eslint-disable-next-line playwright/no-force-option
    await ctaButton.click({ force: true });

    // Wait for the upsell step to appear
    await expect(modal.getByText('Toegevoegd')).toBeVisible({ timeout: 5_000 });
    await expect(modal.getByText(shawarma.title)).toBeVisible();

    // Suggestions should be shown
    await expect(modal.getByText('Vaak gecombineerd met')).toBeVisible();
    await expect(modal.getByText('Mint Lemonade')).toBeVisible();

    // Done button should be visible
    await expect(modal.getByRole('button', { name: 'Klaar' })).toBeVisible();

    // View cart link should be visible
    await expect(modal.getByRole('button', { name: 'Bekijk winkelwagen' })).toBeVisible();
  });

  test('clicking Done closes the modal', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Add product
    await modal.getByRole('radio', { name: 'Regular' }).check();
    const ctaButton = modal.getByRole('button', { name: /Toevoegen.*€/ });
    // eslint-disable-next-line playwright/no-force-option
    await ctaButton.click({ force: true });

    // Wait for upsell step
    await expect(modal.getByText('Toegevoegd')).toBeVisible({ timeout: 5_000 });

    // Click Done
    await modal.getByRole('button', { name: 'Klaar' }).click();

    // Modal should close
    await expect(modal).toBeHidden();
  });

  test('adding suggestion from upsell step adds to cart', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const modal = await openProductDetailModal(page, shawarma.id);
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Add product
    await modal.getByRole('radio', { name: 'Regular' }).check();
    const ctaButton = modal.getByRole('button', { name: /Toevoegen.*€/ });
    // eslint-disable-next-line playwright/no-force-option
    await ctaButton.click({ force: true });

    // Wait for upsell step
    await expect(modal.getByText('Toegevoegd')).toBeVisible({ timeout: 5_000 });

    // Add a suggestion
    const addSuggestion = modal.getByRole('button', { name: /Toevoegen.*Mint Lemonade/ });
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/items/') &&
        resp.url().includes('/api/v1/cart/') &&
        resp.request().method() === 'POST',
    );
    await addSuggestion.click();
    await responsePromise;

    // Close modal
    await modal.getByRole('button', { name: 'Klaar' }).click();
    await expect(modal).toBeHidden();

    // Verify cart has 2 items (shawarma + mint lemonade)
    const drawer = await openCartDrawer(page);
    await expect(drawer.getByText('Shawarma Bowl')).toBeVisible();
    await expect(drawer.getByText('Mint Lemonade')).toBeVisible();
  });

  test('no upsell step for products without suggestions', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // prod-3 (Mint Lemonade) has no suggestions in fixtures
    const card = page.locator(`[data-product-id="prod-3"]`).first();
    await card.scrollIntoViewIfNeeded();

    const addButton = card.getByRole('button', { name: 'Toevoegen' });
    await addButton.waitFor({ state: 'visible', timeout: 5_000 });
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(500);

    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/items/') &&
        resp.url().includes('/api/v1/cart/') &&
        resp.request().method() === 'POST',
    );
    await addButton.click();
    await responsePromise;

    // No modal should appear (simple product with no suggestions = direct add)
    const modal = page.getByRole('dialog');
    await expect(modal).toBeHidden();
  });
});

test.describe('Upsells — cart drawer suggestions', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('cart drawer shows suggestions after adding item', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Add a simple product first
    await addSimpleProductToCart(page, falafel.id);

    // Open cart drawer
    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Wait for suggestions to load from /api/v1/cart/{id}/suggestions/
    await expect(drawer.getByText('Maak je bestelling compleet')).toBeVisible({ timeout: 5_000 });

    // Suggestion should be visible
    await expect(drawer.getByText('Mint Lemonade')).toBeVisible();
  });

  test('adding cart suggestion updates cart', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Add a simple product
    await addSimpleProductToCart(page, falafel.id);

    // Open cart drawer
    const drawer = await openCartDrawer(page);
    await expect(drawer).toBeVisible({ timeout: 5_000 });

    // Wait for suggestions
    await expect(drawer.getByText('Maak je bestelling compleet')).toBeVisible({ timeout: 5_000 });

    // Click add on the suggestion
    const addButton = drawer.getByRole('button', { name: /Toevoegen.*Mint Lemonade/ });
    const responsePromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/items/') &&
        resp.url().includes('/api/v1/cart/') &&
        resp.request().method() === 'POST',
    );
    await addButton.click();
    await responsePromise;

    // Cart should now show both items
    await expect(drawer.getByText('Falafel Wrap')).toBeVisible();
    await expect(drawer.getByText('Mint Lemonade')).toBeVisible();
  });
});
