/** Shared test helpers for E2E tests. */
import type { Page } from '@playwright/test';

const MOCK_API_URL = 'http://localhost:4322';
const DEFAULT_LANG = 'nl';

/**
 * Set up per-test cart isolation.
 *
 * Each test gets a unique cart ID transmitted via an `x-test-cart-id` header.
 * A `page.route()` interceptor adds this header to all browser-side requests
 * to the mock API. The mock API lazily creates a fresh empty cart for each
 * new cart ID, so parallel tests never share cart state.
 *
 * SSR requests (Astro server → mock API) bypass the interceptor but only
 * fetch read-only product/category data, so they don't need cart isolation.
 */
export async function resetMockApi(page: Page) {
  const cartId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Intercept browser-side requests to the mock API and tag them with this
  // test's unique cart ID so the mock API returns the correct cart state.
  await page.route(`${MOCK_API_URL}/**`, async (route) => {
    const headers = route.request().headers();
    headers['x-test-cart-id'] = cartId;
    await route.continue({ headers });
  });
}

// ── URL helpers ──────────────────────────────────────────────────

export function menuPage(lang = DEFAULT_LANG) {
  return `/${lang}/`;
}

export function cartPage(lang = DEFAULT_LANG) {
  return `/${lang}/cart`;
}

export function productPage(slug: string, lang = DEFAULT_LANG) {
  return `/${lang}/product/${slug}`;
}

export function categoryPage(slug: string, lang = DEFAULT_LANG) {
  return `/${lang}/category/${slug}`;
}

export function cmsPage(slug: string, lang = DEFAULT_LANG) {
  return `/${lang}/pages/${slug}`;
}

// ── Page helpers ─────────────────────────────────────────────────

/**
 * Wait for Preact islands to hydrate.
 * On the menu page, checks for window.__MERCHANT__ (set via SSR script).
 * On other pages, falls back to waiting for network idle.
 *
 * Also hides the Astro dev toolbar which can intercept pointer events
 * in preview builds and cause click failures.
 */
export async function waitForHydration(page: Page, { dismissModal = true } = {}) {
  // Hide the Astro dev toolbar to prevent it from intercepting pointer events
  await page.addStyleTag({
    content: 'astro-dev-toolbar { display: none !important; pointer-events: none !important; }',
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- waitForFunction runs in serialized browser context; Window augmentation unavailable
    await page.waitForFunction(() => !!(window as any).__MERCHANT__, null, {
      timeout: 5_000,
    });
  } catch {
    // Not all pages inject __MERCHANT__ — wait for load state instead
    // eslint-disable-next-line playwright/no-networkidle -- intentional fallback for pages without __MERCHANT__
    await page.waitForLoadState('networkidle');
  }

  // Dismiss the merchant comms modal if it appears (e.g. "Welcome!" promo).
  // In preview/build mode, pre-bundled JS hydrates faster so the modal may
  // appear before test interactions begin, blocking clicks on the menu page.
  if (dismissModal) {
    await dismissCommsModal(page);
  }
}

/**
 * Dismiss the comms modal if it appears. Safe to call even if no modal shows.
 *
 * The CommsModal uses requestIdleCallback with a 2 000 ms timeout before
 * opening, so on slow CI the overlay can appear well after hydration completes.
 * The default wait is 4 s to cover that delay. Pass a shorter timeout for
 * follow-up calls where the modal would already be visible if it was going to
 * appear at all.
 */
async function dismissCommsModal(page: Page, { timeout = 4_000 } = {}) {
  const modal = page.locator('[data-comms-modal]');
  try {
    await modal.waitFor({ state: 'visible', timeout });
  } catch {
    // Modal didn't appear — that's fine
    return;
  }

  // Press Escape and wait for the overlay to disappear. Retry once if the
  // first keypress was consumed by a different handler (e.g. search overlay).
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.keyboard.press('Escape');
    try {
      await modal.waitFor({ state: 'hidden', timeout: 3_000 });
      return;
    } catch {
      // Retry
    }
  }
}

/**
 * Block analytics/tracking requests to prevent noise in tests.
 * Aborts requests to PostHog and common analytics domains.
 */
export async function blockAnalytics(page: Page) {
  await page.route(
    (url) => {
      const host = url.hostname;
      return (
        host.includes('posthog') ||
        host.includes('analytics') ||
        host.includes('google-analytics') ||
        host.includes('googletagmanager')
      );
    },
    (route) => route.abort(),
  );
}

/**
 * Open the search overlay via the header search button.
 *
 * Retries clicking up to 3 times because the SearchBar island uses
 * client:load — hydration may not be complete on the first click.
 */
export async function openSearchOverlay(page: Page) {
  const searchInput = page.getByRole('searchbox', { name: 'Zoeken' });

  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'Zoeken' }).click();
    try {
      await searchInput.waitFor({ state: 'visible', timeout: 2_000 });
      return searchInput;
    } catch {
      // Island may not have hydrated yet — retry
    }
  }

  return searchInput;
}

/** Collect page errors for assertions. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

// ── Cart interaction helpers ─────────────────────────────────────

/**
 * Add a simple product (no modifiers) to cart and wait for the API response.
 * Scrolls the product card into view first to trigger client:visible hydration,
 * then waits for the Preact island to mount before clicking.
 */
export async function addSimpleProductToCart(page: Page, productId: string) {
  // Dismiss the comms modal overlay if it appeared after initial hydration.
  const commsOverlay = page.locator('[data-comms-modal]');
  if (await commsOverlay.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await commsOverlay.waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => {});
  }

  const card = page.locator(`[data-product-id="${productId}"]`).first();
  await card.scrollIntoViewIfNeeded();

  // Detect language from URL to match the correct button text
  const url = page.url();
  const lang = url.includes('/en/') ? 'en' : url.includes('/de/') ? 'de' : 'nl';
  const addToCartLabel: Record<string, string> = {
    nl: 'Toevoegen',
    en: 'Add to cart',
    de: 'In den Warenkorb',
  };
  const addButton = card.getByRole('button', { name: addToCartLabel[lang] });

  // Wait for the client:visible island to hydrate. After scrolling into view,
  // the IntersectionObserver fires, then Preact JS is downloaded and executed.
  // We wait for the button to be visible, then add a small delay for Preact
  // event handlers to be registered. Using a single click (no retry) to avoid
  // sending duplicate POST requests that create multiple cart items.
  await addButton.waitFor({ state: 'visible', timeout: 15_000 });
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

  // Dismiss the upsell dialog if it appears (added by upsells feature).
  // The dialog has "Klaar" and "Bekijk winkelwagen" buttons; pressing Escape
  // is the most reliable way to close it without side effects.
  const upsellLabel: Record<string, string> = { nl: 'Toegevoegd', en: 'Added', de: 'Hinzugefügt' };
  const upsellDialog = page
    .getByRole('dialog')
    .filter({ hasText: upsellLabel[lang] ?? 'Toegevoegd' });
  await upsellDialog.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
  if (await upsellDialog.isVisible()) {
    await page.keyboard.press('Escape');
    await upsellDialog.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  }
}

/**
 * Open the cart drawer via the header cart trigger button.
 * Works on all viewports (unlike CartBar which is mobile-only).
 */
export async function openCartDrawer(page: Page) {
  // CartBadge (desktop header) and CartBar (mobile bottom bar) both have
  // data-cart-trigger. Click whichever is visible in the current viewport.
  const trigger = page.locator('[data-cart-trigger]').locator('visible=true').first();
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Winkelwagen' });
  return drawer;
}

/**
 * Open the product detail modal for a product with modifiers.
 * Scrolls the card into view and clicks its "Toevoegen" button.
 *
 * Dismisses the MerchantComms modal first if it's blocking interactions —
 * on CI the comms modal can appear after waitForHydration has already run,
 * because CommsModal defers opening via requestIdleCallback.
 *
 * Retries clicking up to 3 times because the AddToCartButton island uses
 * client:visible — hydration may not be complete on the first click.
 */
export async function openProductDetailModal(page: Page, productId: string) {
  // Dismiss the comms modal overlay if it appeared after initial hydration.
  // Short timeout — waitForHydration already waited the full 4 s window.
  await dismissCommsModal(page, { timeout: 1_000 });

  const card = page.locator(`[data-product-id="${productId}"]`).first();
  await card.scrollIntoViewIfNeeded();

  const modal = page.getByRole('dialog');

  for (let attempt = 0; attempt < 3; attempt++) {
    // Check again before each click — the modal can appear between retries
    const commsOverlay = page.locator('[data-comms-modal]');
    if (await commsOverlay.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await commsOverlay.waitFor({ state: 'hidden', timeout: 2_000 }).catch(() => {});
    }

    await card.getByRole('button', { name: 'Toevoegen' }).click();
    try {
      await modal.waitFor({ state: 'visible', timeout: 2_000 });
      return modal;
    } catch {
      // Island may not have hydrated yet — retry
    }
  }

  return modal;
}
