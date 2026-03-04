import { test, expect } from '@playwright/test';
import {
  resetMockApi,
  menuPage,
  cartPage,
  productPage,
  cmsPage,
  blockAnalytics,
  collectPageErrors,
} from './helpers/test-utils';

test.describe('Smoke tests', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('menu page loads and shows merchant name', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(menuPage());
    await expect(page.getByRole('heading', { name: /Bar Sumac/i }).first()).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('category page loads', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(menuPage());
    // Category sections are rendered on the menu page
    await expect(page.getByRole('heading', { name: 'Starters' })).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('product detail page loads', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(productPage('falafel-wrap'));
    await expect(page.getByRole('heading', { name: 'Falafel Wrap' })).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('cart page loads with inline content', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(cartPage());
    await expect(page).toHaveTitle(/Cart/);
    expect(errors).toHaveLength(0);
  });

  test('CMS page loads and renders content', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto(cmsPage('about'));
    await expect(page.getByRole('heading', { name: 'About Bar Sumac' })).toBeVisible();
    await expect(page.locator('main').getByText('Mediterranean-inspired kitchen')).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test('404 page renders for unknown routes', async ({ page }) => {
    const errors = collectPageErrors(page);
    const response = await page.goto('/nl/this-does-not-exist');
    expect(response?.status()).toBe(404);
    expect(errors).toHaveLength(0);
  });

  test('sitemap.xml returns valid XML with product URLs', async ({ page }) => {
    const response = await page.goto('/sitemap.xml');
    expect(response?.status()).toBe(200);
    const contentType = response?.headers()['content-type'] ?? '';
    expect(contentType).toContain('xml');
    const body = await response?.text();
    expect(body).toContain('<urlset');
    expect(body).toContain('/product/falafel-wrap');
  });

  test('robots.txt returns content with Sitemap reference', async ({ page }) => {
    const response = await page.goto('/robots.txt');
    expect(response?.status()).toBe(200);
    const body = await response?.text();
    expect(body).toContain('Sitemap:');
    expect(body).toContain('sitemap.xml');
  });
});
