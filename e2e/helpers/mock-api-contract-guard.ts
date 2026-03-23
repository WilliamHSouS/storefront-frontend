/**
 * Mock API contract guard — registry of all mock endpoints for schema validation.
 *
 * Exports MOCK_ENDPOINTS: a complete list of every route handler in mock-api.ts,
 * annotated with the OpenAPI spec path, expected status, request body, and any
 * setup steps needed. Used by contract.spec.ts to data-drive schema validation.
 *
 * Can also run standalone: `npx tsx e2e/helpers/mock-api-contract-guard.ts`
 */

const MOCK_BASE = 'http://localhost:4322';

export interface MockEndpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Actual URL to hit on the mock server (with concrete IDs). */
  mockPath: string;
  /** OpenAPI spec path template (e.g. /api/v1/cart/{cart_id}/). */
  specPath: string;
  expectedStatus: number;
  /** Setup function — runs before this endpoint (e.g. create cart, add item). */
  setup?: () => Promise<void>;
  /** Request body for POST/PATCH. */
  body?: Record<string, unknown>;
  /** Known divergence error substrings to filter out during validation. */
  knownDivergences?: string[];
  /** If set, skip this endpoint with this reason. */
  skipReason?: string;
  /** Human-readable label for test output. */
  label?: string;
}

// ── Shared setup helpers ──────────────────────────────────────────

async function postJson(path: string, body: Record<string, unknown> = {}) {
  const res = await fetch(`${MOCK_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function resetMock() {
  await postJson('/test/reset');
}

async function createCart() {
  await resetMock();
  await postJson('/api/v1/cart/');
}

async function createCartWithItem() {
  await createCart();
  await postJson('/api/v1/cart/cart-test-001/items/', {
    product_id: 'prod-1',
    quantity: 1,
  });
}

/** Creates cart + item + checkout. Returns the checkout ID via a side-channel global. */
let lastCheckoutId = '';

async function createCheckout() {
  await createCartWithItem();
  const data = await postJson('/api/v1/checkout/', {
    cart_id: 'cart-test-001',
  });
  lastCheckoutId = data.id;
}

async function createCheckoutWithDelivery() {
  await createCheckout();
  await fetch(`${MOCK_BASE}/api/v1/checkout/${lastCheckoutId}/delivery/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test@example.com',
      shipping_address: {
        first_name: 'Test',
        last_name: 'User',
        address1: 'Damstraat 1',
        city: 'Amsterdam',
        postal_code: '1012LG',
        country: 'NL',
      },
      shipping_method_id: 'local_delivery',
    }),
  });
}

/**
 * Returns the last checkout ID created by setup helpers.
 * Used by endpoints that need a dynamic checkout ID in the path.
 */
export function getLastCheckoutId(): string {
  return lastCheckoutId;
}

// ── Endpoint registry ─────────────────────────────────────────────

/** Complete registry of all mock API endpoints. */
export const MOCK_ENDPOINTS: MockEndpoint[] = [
  // ── Products ──
  {
    method: 'GET',
    mockPath: '/api/v1/products/',
    specPath: '/api/v1/products/',
    expectedStatus: 200,
    knownDivergences: ['product_id must be integer'],
    label: 'list products',
  },
  {
    method: 'GET',
    mockPath: '/api/v1/products/search/?q=falafel',
    specPath: '/api/v1/products/search/',
    expectedStatus: 200,
    knownDivergences: ['product_id must be integer'],
    label: 'search products',
  },
  {
    method: 'GET',
    mockPath: '/api/v1/products/prod-1/',
    specPath: '/api/v1/products/{id}/',
    expectedStatus: 200,
    knownDivergences: ['product_id must be integer'],
    label: 'product detail',
  },
  {
    method: 'GET',
    mockPath: '/api/v1/products/prod-1/suggestions/',
    specPath: '/api/v1/products/{id}/suggestions/',
    expectedStatus: 200,
    label: 'product suggestions',
  },

  // ── Collections / Categories ──
  {
    method: 'GET',
    mockPath: '/api/v1/collections/',
    specPath: '/api/v1/collections/',
    expectedStatus: 200,
    label: 'list collections',
  },
  {
    method: 'GET',
    mockPath: '/api/v1/categories/',
    specPath: '/api/v1/categories/',
    expectedStatus: 200,
    label: 'list categories',
  },

  // ── CMS ──
  {
    method: 'GET',
    mockPath: '/api/v1/pages/about/',
    specPath: '/api/v1/pages/{slug}/',
    expectedStatus: 200,
    label: 'CMS page',
  },

  // ── Cart ──
  {
    method: 'POST',
    mockPath: '/api/v1/cart/',
    specPath: '/api/v1/cart/',
    expectedStatus: 201,
    setup: resetMock,
    knownDivergences: ['product_id must be integer'],
    label: 'create cart',
  },
  {
    method: 'GET',
    mockPath: '/api/v1/cart/cart-test-001/',
    specPath: '/api/v1/cart/{cart_id}/',
    expectedStatus: 200,
    setup: createCart,
    knownDivergences: ['product_id must be integer'],
    label: 'get cart',
  },
  {
    method: 'POST',
    mockPath: '/api/v1/cart/cart-test-001/items/',
    specPath: '/api/v1/cart/{cart_id}/items/',
    expectedStatus: 201,
    setup: createCart,
    body: { product_id: 'prod-1', quantity: 1 },
    knownDivergences: ['product_id must be integer'],
    label: 'add cart item',
  },
  {
    method: 'PATCH',
    mockPath: '/api/v1/cart/cart-test-001/items/li-1/',
    specPath: '/api/v1/cart/{cart_id}/items/{id}/',
    expectedStatus: 200,
    setup: createCartWithItem,
    body: { quantity: 3 },
    knownDivergences: ['product_id must be integer'],
    label: 'update cart item quantity',
  },
  {
    method: 'DELETE',
    mockPath: '/api/v1/cart/cart-test-001/items/li-1/',
    specPath: '/api/v1/cart/{cart_id}/items/{id}/',
    expectedStatus: 200,
    setup: createCartWithItem,
    knownDivergences: ['product_id must be integer'],
    label: 'remove cart item',
  },
  {
    method: 'GET',
    mockPath: '/api/v1/cart/cart-test-001/suggestions/',
    specPath: '/api/v1/cart/{cart_id}/suggestions/',
    expectedStatus: 200,
    setup: createCart,
    label: 'cart suggestions',
  },
  {
    method: 'POST',
    mockPath: '/api/v1/cart/cart-test-001/apply-discount/',
    specPath: '/api/v1/cart/{cart_id}/apply-discount/',
    expectedStatus: 200,
    setup: createCartWithItem,
    body: { code: 'SAVE10' },
    knownDivergences: ['product_id must be integer'],
    label: 'apply discount — valid code',
  },
  {
    method: 'POST',
    mockPath: '/api/v1/cart/cart-test-001/apply-discount/',
    specPath: '/api/v1/cart/{cart_id}/apply-discount/',
    expectedStatus: 400,
    setup: createCartWithItem,
    body: { code: 'INVALID_CODE' },
    label: 'apply discount — invalid code (400)',
  },
  {
    method: 'DELETE',
    mockPath: '/api/v1/cart/cart-test-001/remove-discount/',
    specPath: '/api/v1/cart/{cart_id}/remove-discount/',
    expectedStatus: 200,
    setup: async () => {
      await createCartWithItem();
      await postJson('/api/v1/cart/cart-test-001/apply-discount/', { code: 'SAVE10' });
    },
    knownDivergences: ['product_id must be integer'],
    label: 'remove discount',
  },

  // ── Promotions ──
  {
    method: 'POST',
    mockPath: '/api/v1/promotions/eligible/',
    specPath: '/api/v1/promotions/eligible/',
    expectedStatus: 200,
    body: {
      cart_items: [{ product_id: 'prod-1', quantity: 2, price: '8.50' }],
    },
    label: 'eligible promotions',
  },

  // ── Fulfillment ──
  {
    method: 'POST',
    mockPath: '/api/v1/fulfillment/address-check/',
    specPath: '/api/v1/fulfillment/address-check/',
    expectedStatus: 200,
    body: { postal_code: '1015AB', house_number: '1', country: 'NL' },
    label: 'address check — in zone',
  },
  {
    method: 'GET',
    mockPath: '/api/v1/fulfillment/locations/1/slots/?date=2026-03-23',
    specPath: '/api/v1/fulfillment/locations/{location_id}/slots/',
    expectedStatus: 200,
    label: 'fulfillment time slots',
  },
  {
    method: 'GET',
    mockPath: '/api/v1/pickup-locations/',
    specPath: '/api/v1/pickup-locations/',
    expectedStatus: 200,
    label: 'pickup locations',
  },

  // ── Checkout ──
  {
    method: 'POST',
    mockPath: '/api/v1/checkout/',
    specPath: '/api/v1/checkout/',
    expectedStatus: 201,
    setup: createCartWithItem,
    body: { cart_id: 'cart-test-001' },
    label: 'create checkout',
  },
  {
    method: 'GET',
    // Path is dynamic — resolved at test time via getLastCheckoutId()
    mockPath: '__DYNAMIC_CHECKOUT__',
    specPath: '/api/v1/checkout/{checkout_id}/',
    expectedStatus: 200,
    setup: createCheckout,
    label: 'get checkout',
  },
  {
    method: 'PATCH',
    mockPath: '__DYNAMIC_CHECKOUT_DELIVERY__',
    specPath: '/api/v1/checkout/{checkout_id}/delivery/',
    expectedStatus: 200,
    setup: createCheckout,
    body: {
      email: 'test@example.com',
      shipping_address: {
        first_name: 'Test',
        last_name: 'User',
        address1: 'Damstraat 1',
        city: 'Amsterdam',
        postal_code: '1012LG',
        country: 'NL',
      },
      shipping_method_id: 'local_delivery',
    },
    label: 'set delivery',
  },
  {
    method: 'GET',
    mockPath: '__DYNAMIC_CHECKOUT_SHIPPING__',
    specPath: '/api/v1/checkout/{checkout_id}/shipping/',
    expectedStatus: 200,
    setup: createCheckout,
    label: 'checkout shipping groups',
  },
  {
    method: 'GET',
    mockPath: '__DYNAMIC_CHECKOUT_GATEWAYS__',
    specPath: '/api/v1/checkout/{checkout_id}/payment-gateways/',
    expectedStatus: 200,
    setup: createCheckout,
    label: 'payment gateways',
  },
  {
    method: 'POST',
    mockPath: '__DYNAMIC_CHECKOUT_PAYMENT__',
    specPath: '/api/v1/checkout/{checkout_id}/payment/',
    expectedStatus: 200,
    setup: createCheckoutWithDelivery,
    body: { payment_gateway: 'stripe' },
    label: 'initiate payment',
  },
  {
    method: 'POST',
    mockPath: '__DYNAMIC_CHECKOUT_CONFIRM__',
    specPath: '/api/v1/checkout/{checkout_id}/confirm-payment/',
    expectedStatus: 200,
    setup: createCheckoutWithDelivery,
    body: { payment_intent_id: 'pi_mock_123' },
    label: 'confirm payment',
  },
  {
    method: 'POST',
    mockPath: '__DYNAMIC_CHECKOUT_COMPLETE__',
    specPath: '/api/v1/checkout/{checkout_id}/complete/',
    expectedStatus: 200,
    setup: createCheckoutWithDelivery,
    body: {},
    label: 'complete checkout',
  },

  // ── Comms ──
  {
    method: 'GET',
    mockPath: '/api/v1/merchant-comms/storefront/active/banner/',
    specPath: '/api/v1/merchant-comms/storefront/active/{surface}/',
    expectedStatus: 200,
    skipReason: 'Comms API not in storefront OpenAPI spec',
    label: 'merchant comms — active messages',
  },
  {
    method: 'POST',
    mockPath: '/api/v1/merchant-comms/storefront/events/',
    specPath: '/api/v1/merchant-comms/storefront/events/',
    expectedStatus: 202,
    body: { event_type: 'dismiss', message_id: 'msg-1' },
    label: 'merchant comms — ingest event',
  },

  // ── Test control (not in OpenAPI spec) ──
  {
    method: 'POST',
    mockPath: '/test/reset',
    specPath: '/test/reset',
    expectedStatus: 200,
    skipReason: 'Test control endpoint — not in OpenAPI spec',
    label: 'test reset',
  },
];

/**
 * Resolve dynamic checkout paths at runtime.
 * Call this after running the endpoint's setup function.
 */
export function resolveMockPath(endpoint: MockEndpoint): string {
  const checkoutId = getLastCheckoutId();
  switch (endpoint.mockPath) {
    case '__DYNAMIC_CHECKOUT__':
      return `/api/v1/checkout/${checkoutId}/`;
    case '__DYNAMIC_CHECKOUT_DELIVERY__':
      return `/api/v1/checkout/${checkoutId}/delivery/`;
    case '__DYNAMIC_CHECKOUT_SHIPPING__':
      return `/api/v1/checkout/${checkoutId}/shipping/`;
    case '__DYNAMIC_CHECKOUT_GATEWAYS__':
      return `/api/v1/checkout/${checkoutId}/payment-gateways/`;
    case '__DYNAMIC_CHECKOUT_PAYMENT__':
      return `/api/v1/checkout/${checkoutId}/payment/`;
    case '__DYNAMIC_CHECKOUT_CONFIRM__':
      return `/api/v1/checkout/${checkoutId}/confirm-payment/`;
    case '__DYNAMIC_CHECKOUT_COMPLETE__':
      return `/api/v1/checkout/${checkoutId}/complete/`;
    default:
      return endpoint.mockPath;
  }
}

// ── Standalone runner ─────────────────────────────────────────────

async function main() {
  const { validateResponse } = await import('./validate-mock-responses.js');

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const endpoint of MOCK_ENDPOINTS) {
    const label = `${endpoint.method} ${endpoint.specPath}`;

    if (endpoint.skipReason) {
      console.log(`SKIP  ${label} — ${endpoint.skipReason}`);
      skipped++;
      continue;
    }

    try {
      if (endpoint.setup) await endpoint.setup();

      const resolvedPath = resolveMockPath(endpoint);
      const url = `${MOCK_BASE}${resolvedPath}`;

      const fetchOpts: RequestInit = {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
      };
      if (endpoint.body && endpoint.method !== 'GET') {
        fetchOpts.body = JSON.stringify(endpoint.body);
      }

      const res = await fetch(url, fetchOpts);
      const data = await res.json();

      if (res.status !== endpoint.expectedStatus) {
        console.log(`FAIL  ${label} — expected ${endpoint.expectedStatus}, got ${res.status}`);
        failed++;
        continue;
      }

      const result = validateResponse(
        endpoint.specPath,
        endpoint.method,
        endpoint.expectedStatus,
        data,
      );

      const errors = endpoint.knownDivergences
        ? result.errors.filter((e) => !endpoint.knownDivergences!.some((d) => e.includes(d)))
        : result.errors;

      if (errors.length > 0) {
        console.log(`FAIL  ${label}`);
        for (const err of errors) console.log(`      ${err}`);
        failed++;
      } else {
        console.log(`PASS  ${label}`);
        passed++;
      }
    } catch (err) {
      console.log(`FAIL  ${label} — ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
}

// Run standalone when executed directly
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].includes('mock-api-contract-guard') ||
    process.argv[1].includes('mock-api-contract-guard.ts'));

if (isMainModule) {
  main().catch((err) => {
    console.error('Contract guard failed:', err);
    process.exit(1);
  });
}
