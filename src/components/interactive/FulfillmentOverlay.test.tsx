import { describe, it, expect, beforeEach } from 'vitest';
import { getBadgeForProduct, shouldHideProduct, applyFulfillmentToDOM } from './FulfillmentOverlay';

// ── Pure logic tests ───────────────────────────────────────────

describe('getBadgeForProduct', () => {
  it('returns null when no address is set', () => {
    expect(getBadgeForProduct(null, ['local_delivery'], false)).toBeNull();
  });

  it('returns null for local delivery products (happy path)', () => {
    const coords = { postalCode: '1015', country: 'NL', latitude: 0, longitude: 0 };
    expect(getBadgeForProduct(coords, ['local_delivery'], false)).toBeNull();
  });

  it('returns "pickupOnly" for pickup-only products', () => {
    const coords = { postalCode: '1015', country: 'NL', latitude: 0, longitude: 0 };
    expect(getBadgeForProduct(coords, ['pickup'], true)).toBe('pickupOnly');
  });

  it('returns "shipsSeparately" for nationwide-only products', () => {
    const coords = { postalCode: '1015', country: 'NL', latitude: 0, longitude: 0 };
    expect(getBadgeForProduct(coords, ['nationwide_delivery'], false)).toBe('shipsSeparately');
  });
});

describe('shouldHideProduct', () => {
  it('does not hide when no address is set', () => {
    expect(shouldHideProduct(null, ['local_delivery'])).toBe(false);
  });

  it('does not hide products with local delivery', () => {
    const coords = { postalCode: '1015', country: 'NL', latitude: 0, longitude: 0 };
    expect(shouldHideProduct(coords, ['local_delivery'])).toBe(false);
  });

  it('hides products with empty fulfillment types', () => {
    const coords = { postalCode: '1015', country: 'NL', latitude: 0, longitude: 0 };
    expect(shouldHideProduct(coords, [])).toBe(true);
  });
});

// ── DOM integration tests (happy-dom) ──────────────────────────
// Note: document.body.innerHTML is used here only for test fixture setup,
// NOT in production code. The component itself uses safe DOM methods.

describe('applyFulfillmentToDOM', () => {
  beforeEach(() => {
    document.body.textContent = '';
  });

  function setupDOM(html: string) {
    // Using DOMParser for test fixture setup only
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    while (doc.body.firstChild) {
      document.body.appendChild(document.adoptNode(doc.body.firstChild));
    }
  }

  it('adds pickup-only badge to badge slot', () => {
    setupDOM(`
      <div data-menu-section>
        <article data-product-id="42">
          <span data-fulfillment-badge></span>
        </article>
      </div>
    `);

    const coords = { postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 };
    const fulfillmentMap = new Map([
      ['42', { productId: '42', availableFulfillmentTypes: ['pickup'], pickupOnly: true }],
    ]);

    applyFulfillmentToDOM(fulfillmentMap, coords, 'en');

    const badge = document.querySelector('[data-fulfillment-badge]');
    expect(badge?.textContent).toContain('Pickup only');
  });

  it('shows products not in fulfillment map without badge (may be beyond page_size)', () => {
    setupDOM(`
      <div data-menu-section>
        <article data-product-id="99" class="hidden">
          <span data-fulfillment-badge><span>Old badge</span></span>
        </article>
      </div>
    `);

    const coords = { postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 };
    const fulfillmentMap = new Map();

    applyFulfillmentToDOM(fulfillmentMap, coords, 'en');

    const card = document.querySelector('[data-product-id="99"]');
    expect(card?.classList.contains('hidden')).toBe(false);
    const badge = card?.querySelector('[data-fulfillment-badge]');
    expect(badge?.children.length).toBe(0);
  });

  it('hides menu sections when all products have empty fulfillment types', () => {
    setupDOM(`
      <div data-menu-section>
        <article data-product-id="99">
          <span data-fulfillment-badge></span>
        </article>
      </div>
    `);

    const coords = { postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 };
    // Product explicitly in the map with no fulfillment types → hidden
    const fulfillmentMap = new Map([
      ['99', { productId: '99', availableFulfillmentTypes: [] as string[], pickupOnly: false }],
    ]);
    applyFulfillmentToDOM(fulfillmentMap, coords, 'en');

    const section = document.querySelector('[data-menu-section]');
    expect(section?.classList.contains('hidden')).toBe(true);
  });

  it('clears badges for local delivery products', () => {
    setupDOM(`
      <div data-menu-section>
        <article data-product-id="42">
          <span data-fulfillment-badge><span>Old badge</span></span>
        </article>
      </div>
    `);

    const coords = { postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 };
    const fulfillmentMap = new Map([
      ['42', { productId: '42', availableFulfillmentTypes: ['local_delivery'], pickupOnly: false }],
    ]);

    applyFulfillmentToDOM(fulfillmentMap, coords, 'en');

    const badge = document.querySelector('[data-fulfillment-badge]');
    expect(badge?.children.length).toBe(0);
  });
});
