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

    // Clicking a search result opens the product detail modal.
    // On mobile, the product card heading (h3) is still visible behind the modal,
    // so scope to the dialog to avoid strict mode violations.
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal.getByRole('heading', { name: 'Shawarma Bowl' })).toBeVisible({
      timeout: 10_000,
    });
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

  test('shows popular items when search opens with no query', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await openSearchOverlay(page);

    // Should show "Populaire items" section (default lang is nl)
    await expect(page.getByText('Populaire items')).toBeVisible({ timeout: 5_000 });

    // Should show product items in the zero-state
    const popularList = page.getByRole('listbox', { name: 'Populaire items' });
    await expect(popularList.getByRole('option').first()).toBeVisible({ timeout: 5_000 });
  });

  test('navigates results with arrow keys', async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    await openSearchOverlay(page);

    // Wait for featured products to load and keyboard handlers to attach
    const popularList = page.getByRole('listbox', { name: 'Populaire items' });
    await expect(popularList.getByRole('option').first()).toBeVisible({ timeout: 5_000 });
    // eslint-disable-next-line playwright/no-wait-for-timeout -- keyboard handler attaches after render; settle time needed on CI
    await page.waitForTimeout(500);

    // Press ArrowDown — first item should be highlighted
    await page.keyboard.press('ArrowDown');
    const firstOption = popularList.getByRole('option').first();
    await expect(firstOption).toHaveAttribute('aria-selected', 'true', { timeout: 3_000 });

    // Press ArrowDown again — second item highlighted, first deselected
    await page.keyboard.press('ArrowDown');
    const secondOption = popularList.getByRole('option').nth(1);
    await expect(secondOption).toHaveAttribute('aria-selected', 'true');
    await expect(firstOption).toHaveAttribute('aria-selected', 'false');
  });

  test('saves and shows recent searches', { timeout: 60_000 }, async ({ page }) => {
    await page.goto(menuPage());
    await waitForHydration(page);

    // Open search, type a query, select a result
    const searchInput = await openSearchOverlay(page);
    await searchInput.fill('falafel');

    // Wait for search results — use longer timeout on CI
    const listbox = page.getByRole('listbox', { name: 'Zoeken' });
    await expect(listbox.getByRole('option').first()).toBeVisible({ timeout: 10_000 });

    // Click the first result (use force due to backdrop overlay)
    // eslint-disable-next-line playwright/no-force-option -- backdrop overlay intercepts pointer events
    await listbox.getByRole('button').first().click({ force: true });

    // Wait for search to close
    await expect(searchInput).toBeHidden({ timeout: 5_000 });

    // Dismiss the product detail modal (it opens after clicking a search result).
    // The backdrop intercepts pointer events, so press Escape to close it and wait
    // for the modal to fully close before reopening search.
    await page.keyboard.press('Escape');
    await page.waitForURL(/\/nl\/$/, { timeout: 5_000 });
    // Allow modal close animation and DOM cleanup to settle on CI.
    // Preview mode (pre-bundled JS) can be slower to re-hydrate after navigation.
    // eslint-disable-next-line playwright/no-wait-for-timeout -- modal close animation needs time on CI preview mode
    await page.waitForTimeout(2500);

    // Reopen search — should show "Recente zoekopdrachten" with "falafel"
    await openSearchOverlay(page);
    await expect(page.getByText('Recente zoekopdrachten')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'falafel', exact: true })).toBeVisible();
  });
});
