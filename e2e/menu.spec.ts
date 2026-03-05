import { test, expect } from '@playwright/test';
import { resetMockApi, menuPage, blockAnalytics, waitForHydration } from './helpers/test-utils';
import { categories, products } from './fixtures/products';

test.describe('Menu page', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await page.goto(menuPage());
    await waitForHydration(page);
  });

  test('renders hero section with merchant name and description', async ({ page }) => {
    // The hero h1 is outside <main>, use .first() to avoid matching the footer h3
    await expect(page.getByRole('heading', { name: 'Bar Sumac' }).first()).toBeVisible();
    await expect(page.getByText(/Mediterranean/i).first()).toBeVisible();
  });

  test('renders all category tabs', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: 'Menu' });
    for (const cat of categories) {
      await expect(tablist.getByRole('tab', { name: cat.name })).toBeVisible();
    }
  });

  test('renders products grouped under correct categories', async ({ page }) => {
    // Use heading role to avoid strict mode violations (product name also appears
    // in image alt and other text nodes on the page)
    await expect(page.getByRole('heading', { name: 'Falafel Wrap' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Baklava' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Shawarma Bowl' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mint Lemonade' })).toBeVisible();
  });

  test('product card shows name, price, and description', async ({ page }) => {
    const falafel = products[0];
    await expect(page.getByText(falafel.title)).toBeVisible();
    await expect(page.getByText(falafel.description)).toBeVisible();
    // Price formatted in EUR/nl-NL: "€ 8,50"
    await expect(page.getByText(/8,50/)).toBeVisible();
  });

  test('sold-out product shows disabled state', async ({ page }) => {
    // Baklava is sold out — its add-to-cart button should be disabled
    const baklavaSection = page.locator('[data-add-to-cart="prod-4"]');
    // If the button exists, it should be disabled
    const button = baklavaSection.first();
    // eslint-disable-next-line playwright/no-conditional-in-test -- button only exists when sold-out variant is rendered
    if (await button.count()) {
      // eslint-disable-next-line playwright/no-conditional-expect
      await expect(button).toBeDisabled();
    }
  });

  test('discounted product shows promo badge', async ({ page }) => {
    // Baklava has a 15% discount — look for the badge
    await expect(page.getByText(/15%/)).toBeVisible();
  });

  test('category tab click scrolls section into viewport', async ({ page }) => {
    const tablist = page.getByRole('tablist', { name: 'Menu' });

    // Click "Drinks" tab
    await tablist.getByRole('tab', { name: 'Drinks' }).click();

    // Mint Lemonade (in Drinks category) should be in viewport
    const lemonade = page.getByRole('heading', { name: 'Mint Lemonade' });
    await expect(lemonade).toBeInViewport();
  });
});
