import { test, expect } from '@playwright/test';
import {
  resetMockApi,
  menuPage,
  blockAnalytics,
  waitForHydration,
  openSearchOverlay,
} from './helpers/test-utils';

test.describe('Search', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('search input accepts text and shows results', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const searchInput = await openSearchOverlay(page);
    await expect(searchInput).toBeVisible();

    // Type a query that matches multiple products (debounced 300ms)
    await searchInput.fill('al');
    await searchInput.press('a'); // "ala" — triggers at >= 2 chars after debounce

    // Wait for the listbox results to appear
    const listbox = page.getByRole('listbox', { name: 'Zoeken' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // At least one result should be present
    const options = listbox.getByRole('option');
    await expect(options.first()).toBeVisible();
  });

  test('search results match query', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const searchInput = await openSearchOverlay(page);
    await searchInput.fill('falafel');

    // Wait for results (300ms debounce + network)
    const listbox = page.getByRole('listbox', { name: 'Zoeken' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // Should show the Falafel Wrap product
    await expect(listbox.getByText('Falafel Wrap')).toBeVisible();

    // Should NOT show unrelated products
    await expect(listbox.getByText('Shawarma Bowl')).toBeHidden();
  });

  test('clicking result opens product detail', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const searchInput = await openSearchOverlay(page);
    await searchInput.fill('shawarma');

    const listbox = page.getByRole('listbox', { name: 'Zoeken' });
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // Click the result button — use force to bypass backdrop overlay stacking
    // eslint-disable-next-line playwright/no-force-option -- backdrop overlay intercepts pointer events
    await listbox.getByRole('button', { name: /Shawarma Bowl/ }).click({ force: true });

    // Clicking a search result navigates to the product page
    await page.waitForURL(/\/product\//, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Shawarma Bowl' })).toBeVisible();
  });

  test('no results shows empty state', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const searchInput = await openSearchOverlay(page);
    await searchInput.fill('xyznonexistent');

    // Wait for debounce + response, then check for empty state message (Dutch: "Geen resultaten gevonden")
    await expect(page.getByText('Geen resultaten gevonden')).toBeVisible({ timeout: 5_000 });

    // The listbox should not be present (no matching results)
    await expect(page.getByRole('listbox', { name: 'Zoeken' })).toBeHidden();
  });

  test('Escape clears search', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    const searchInput = await openSearchOverlay(page);
    await expect(searchInput).toBeVisible();

    // Type something, then press Escape
    await searchInput.fill('falafel');
    await page.keyboard.press('Escape');

    // The search overlay (including the input) should disappear
    await expect(searchInput).toBeHidden();
  });
});
