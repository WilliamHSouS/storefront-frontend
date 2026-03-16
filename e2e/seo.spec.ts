import { test, expect } from '@playwright/test';
import {
  resetMockApi,
  menuPage,
  productPage,
  cartPage,
  blockAnalytics,
} from './helpers/test-utils';
import { products, categories } from './fixtures/products';

test.describe('SEO', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
  });

  test('menu page has correct title from merchant config', async ({ page }) => {
    await page.goto(menuPage());

    // The menu page uses the merchant name as title (no %s template for menu)
    await expect(page).toHaveTitle('Bar Sumac');
  });

  test('menu page has meta description', async ({ page }) => {
    await page.goto(menuPage());

    const description = page.locator('meta[name="description"]').first();
    await expect(description).toHaveAttribute(
      'content',
      'Bestel online bij Bar Sumac — Mediterraans eten in Amsterdam',
    );
  });

  test('menu page has hreflang alternates for all languages', async ({ page }) => {
    await page.goto(menuPage());

    // Check nl alternate
    const nlAlternate = page.locator('link[rel="alternate"][hreflang="nl"]');
    await expect(nlAlternate).toHaveAttribute('href', /\/nl\//);

    // Check en alternate
    const enAlternate = page.locator('link[rel="alternate"][hreflang="en"]');
    await expect(enAlternate).toHaveAttribute('href', /\/en\//);

    // Check x-default alternate
    const xDefault = page.locator('link[rel="alternate"][hreflang="x-default"]');
    await expect(xDefault).toHaveAttribute('href', /\/nl\//);
  });

  test('menu page has JSON-LD Restaurant structured data', async ({ page }) => {
    await page.goto(menuPage());

    const jsonLd = page.locator('script[type="application/ld+json"]').first();
    await expect(jsonLd).toBeAttached();

    const text = await jsonLd.textContent();
    // eslint-disable-next-line playwright/prefer-web-first-assertions -- toHaveText uses innerText which excludes <script> content
    expect(text).toBeTruthy();
    const data = JSON.parse(text!);
    expect(data['@type']).toBe('Restaurant');
    expect(data.name).toBe('Bar Sumac');
  });

  test('product page has og:title and og:description', async ({ page }) => {
    // Non-bot UA gets redirected to menu page with product modal.
    // The menu page still has og:title set by the SEOHead component.
    // Verify the page renders and has valid og tags.
    await page.goto(productPage('falafel-wrap'));

    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toHaveAttribute('content', /.+/);

    const ogDescription = page.locator('meta[property="og:description"]');
    await expect(ogDescription).toHaveAttribute('content', /.+/);
  });

  test('cart page has noindex robots meta', async ({ page }) => {
    await page.goto(cartPage());

    const robots = page.locator('meta[name="robots"]');
    await expect(robots).toHaveAttribute('content', 'noindex, nofollow');
  });

  test('sitemap.xml contains product and category URLs', async ({ page }) => {
    const response = await page.goto('/sitemap.xml');
    expect(response?.status()).toBe(200);

    const body = await response!.text();

    // Should be valid XML with urlset
    expect(body).toContain('<urlset');

    // Should contain product URLs
    for (const product of products) {
      expect(body).toContain(`/product/${product.slug}`);
    }

    // Should contain collection URLs
    for (const category of categories) {
      expect(body).toContain(`/collection/${category.slug}`);
    }

    // Should contain the menu page root
    expect(body).toContain('/nl/');
  });

  test('sitemap.xml includes hreflang xhtml:link elements', async ({ page }) => {
    const response = await page.goto('/sitemap.xml');
    const body = await response!.text();

    // Should include xhtml namespace
    expect(body).toContain('xmlns:xhtml');

    // Should have hreflang alternates for nl and en
    expect(body).toContain('hreflang="nl"');
    expect(body).toContain('hreflang="en"');

    // Should have x-default
    expect(body).toContain('hreflang="x-default"');
  });

  test('robots.txt references sitemap URL', async ({ page }) => {
    const response = await page.goto('/robots.txt');
    expect(response?.status()).toBe(200);

    const body = await response!.text();

    // Should reference sitemap
    expect(body).toContain('Sitemap:');
    expect(body).toContain('/sitemap.xml');

    // Should allow crawling
    expect(body).toContain('Allow: /');

    // Should disallow cart
    expect(body).toContain('Disallow: /*/cart');
  });
});
