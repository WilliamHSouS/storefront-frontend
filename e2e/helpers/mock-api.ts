/**
 * Mock API server for E2E tests.
 *
 * Runs as a standalone Node HTTP server on port 4322.
 * Serves fixture data for both SSR (Astro server-side) and browser-side SDK calls.
 * Cart state is kept in-memory and can be reset via POST /test/reset.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  products,
  categories,
  shawarmaDetail,
  falafelDetail,
  suggestions,
} from '../fixtures/products';
import { aboutPage, contactPage } from '../fixtures/cms';
import { emptyCart, type CartFixture } from '../fixtures/cart';
import { allSurfaceMessages } from '../fixtures/comms';

const PORT = 4322;
const ALLOWED_ORIGIN = 'http://localhost:4321';

// ── In-memory state (per-test isolation via x-test-cart-id header) ──

interface CartState {
  cart: CartFixture;
  nextLineItemId: number;
}

const carts = new Map<string, CartState>();

interface CheckoutState {
  id: string;
  cart_id: string;
  status: string;
  email: string | null;
  shipping_address: Record<string, string> | null;
  shipping_method_id: string | null;
  fulfillment_slot_id: string | null;
  line_items: Array<{
    product_id: string;
    title: string;
    quantity: number;
    unit_price: string;
    total_price: string;
  }>;
  subtotal: string;
  tax_total: string;
  shipping_cost: string;
  discount_amount: string;
  total: string;
  order_number: string | null;
}

const checkoutStates = new Map<string, CheckoutState>();

function checkoutToResponse(checkout: CheckoutState) {
  return {
    ...checkout,
    merchant_id: 1,
    channel_id: null,
    currency: 'EUR',
    display_currency: 'EUR',
    fx_rate_to_display: '1.00',
    billing_address: checkout.shipping_address,
    shipping_method: checkout.shipping_method_id ? { id: checkout.shipping_method_id } : null,
    payment_method: checkout.status === 'paid' || checkout.status === 'completed' ? 'stripe' : null,
    payment_status: checkout.status === 'paid' || checkout.status === 'completed' ? 'paid' : null,
    surcharge_total: '0.00',
    display_surcharge_total: '0.00',
    discount_code: null,
    applied_promotion_id: null,
    promotion_discount_amount: '0.00',
    display_subtotal: checkout.subtotal,
    display_tax_total: checkout.tax_total,
    display_shipping_cost: checkout.shipping_cost,
    display_discount_amount: checkout.discount_amount,
    display_promotion_discount_amount: '0.00',
    display_total: checkout.total,
    available_payment_gateways: [
      {
        id: 'stripe',
        name: 'Stripe',
        type: 'stripe',
        config: {
          publishable_key: 'pk_test_mock',
          stripe_account: 'acct_mock',
        },
      },
    ],
    gift_card_details: null,
    purpose: 'default',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function getCartId(req: IncomingMessage): string {
  return (req.headers['x-test-cart-id'] as string) ?? 'default';
}

function getCartState(req: IncomingMessage): CartState {
  const id = getCartId(req);
  if (!carts.has(id)) {
    carts.set(id, { cart: emptyCart(), nextLineItemId: 1 });
  }
  return carts.get(id)!;
}

function resetState() {
  carts.clear();
  checkoutStates.clear();
}

// ── Helpers ──────────────────────────────────────────────────────

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Vendor-ID, Accept-Language, Accept, Authorization, X-Vendor-Signature, x-test-cart-id',
  );
}

function json(res: ServerResponse, data: unknown, status = 200) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function notFound(res: ServerResponse) {
  json(res, { detail: 'Not found' }, 404);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
  });
}

function recalcCart(cart: CartFixture) {
  let subtotal = 0;
  let count = 0;
  for (const item of cart.line_items) {
    const modTotal = item.options.reduce(
      (s, m) => s + parseFloat(m.price_modifier) * m.quantity,
      0,
    );
    const lineTotal = (parseFloat(item.unit_price) + modTotal) * item.quantity;
    item.line_total = lineTotal.toFixed(2);
    subtotal += lineTotal;
    count += item.quantity;
  }
  cart.subtotal = subtotal.toFixed(2);
  // Test approximation: 9% BTW tax-inclusive. Real backend uses per-product
  // vat_rate and may use Stripe Tax or Avalara. This is sufficient for E2E.
  const taxRate = 0.09;
  cart.tax_total = ((subtotal * taxRate) / (1 + taxRate)).toFixed(2);
  cart.tax_included = true;
  cart.shipping_cost = cart.shipping_cost ?? '0.00';
  const discount = parseFloat(cart.discount_amount ?? '0');
  const promoDiscount = parseFloat(cart.promotion_discount_amount ?? '0');
  cart.cart_total = (subtotal + parseFloat(cart.shipping_cost) - discount - promoDiscount).toFixed(
    2,
  );
  cart.item_count = count;
  cart.estimated_total = cart.cart_total;

  // Auto-apply promotions: Buy 2 Falafel Wraps get 1 free
  const falafelItem = cart.line_items.find((li) => li.product_id === 'prod-1');
  if (falafelItem && falafelItem.quantity >= 2) {
    cart.promotion = {
      id: 1,
      name: 'Koop 2 Falafel Wraps, krijg 1 gratis!',
      discount_amount: parseFloat(falafelItem.unit_price).toFixed(2),
    };
  } else {
    cart.promotion = null;
  }
}

// ── Product detail lookup ────────────────────────────────────────

const productDetails: Record<string, unknown> = {
  'prod-1': falafelDetail,
  'prod-2': shawarmaDetail,
};

// ── Route handler ────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  cors(res);

  console.log(`[mock-api] ${method} ${path}`);

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Test control ──
  if (method === 'POST' && path === '/test/reset') {
    resetState();
    json(res, { ok: true });
    return;
  }

  // ── Fulfillment: address check ──
  if (method === 'POST' && path === '/api/v1/fulfillment/address-check/') {
    const body = JSON.parse(await readBody(req));
    const postalCode = (body.postal_code ?? '').toString();

    // Valid: starts with "1015" → in delivery zone
    if (postalCode.startsWith('1015')) {
      json(res, {
        latitude: '52.3702',
        longitude: '4.8952',
        available_fulfillment_types: ['local_delivery', 'pickup'],
        available_shipping_providers: [
          {
            id: 1,
            name: 'PostNL',
            delivery_model: 'postal',
            base_delivery_fee: '4.95',
            free_delivery_threshold: null,
          },
        ],
        pickup_locations: [{ id: 1, name: 'Amsterdam Centraal', distance_km: 1.2 }],
        delivery_unavailable: false,
        near_delivery_zone: false,
      });
      return;
    }

    // Valid, in delivery zone with free shipping: starts with "2000"
    if (postalCode.startsWith('2000')) {
      json(res, {
        latitude: '52.16',
        longitude: '4.49',
        available_fulfillment_types: ['local_delivery', 'pickup'],
        available_shipping_providers: [
          {
            id: 1,
            name: 'PostNL',
            delivery_model: 'postal',
            base_delivery_fee: '0.00',
            free_delivery_threshold: '25.00',
          },
        ],
        pickup_locations: [{ id: 3, name: 'Leiden Centraal', distance_km: 0.8 }],
        delivery_unavailable: false,
        near_delivery_zone: false,
      });
      return;
    }

    // Valid but out of area: starts with "9999"
    if (postalCode.startsWith('9999')) {
      json(res, {
        latitude: '53.2',
        longitude: '6.5',
        available_fulfillment_types: ['pickup'],
        available_shipping_providers: [],
        pickup_locations: [{ id: 2, name: 'Groningen Station', distance_km: 45.0 }],
        delivery_unavailable: true,
        near_delivery_zone: false,
      });
      return;
    }

    // Invalid postcode
    json(res, { detail: 'Postcode not found' }, 404);
    return;
  }

  // ── Products list ──
  if (method === 'GET' && path === '/api/v1/products/') {
    const categoryFilter = url.searchParams.get('category');
    const lat = url.searchParams.get('latitude');
    const lng = url.searchParams.get('longitude');
    const filtered = categoryFilter
      ? products.filter((p) => p.category_id === categoryFilter)
      : products;

    // When coordinates are present, add fulfillment metadata to products
    if (lat && lng) {
      const enriched = filtered.map((p) => {
        if (p.id === 'prod-3') {
          // Mint Lemonade: pickup only
          return {
            ...p,
            available_fulfillment_types: ['pickup'],
            pickup_only: true,
          };
        }
        return {
          ...p,
          available_fulfillment_types: ['local_delivery', 'pickup'],
          pickup_only: false,
        };
      });
      json(res, { results: enriched, count: enriched.length, next: null });
      return;
    }

    json(res, { results: filtered, count: filtered.length, next: null });
    return;
  }

  // ── Product search (must come BEFORE product detail to avoid
  //    the /products/{id}/ regex matching "search" as a product ID) ──
  if (method === 'GET' && path === '/api/v1/products/search/') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const results = products.filter(
      (p) => p.title.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
    );
    json(res, { results, count: results.length });
    return;
  }

  // ── Product suggestions (PDP surface) ──
  const productSuggestionsMatch = path.match(/^\/api\/v1\/products\/([^/]+)\/suggestions\/$/);
  if (method === 'GET' && productSuggestionsMatch) {
    const id = productSuggestionsMatch[1];
    json(res, suggestions[id] ?? []);
    return;
  }

  // ── Product detail ──
  const productDetailMatch = path.match(/^\/api\/v1\/products\/([^/]+)\/$/);
  if (method === 'GET' && productDetailMatch) {
    const id = productDetailMatch[1];
    const detail = productDetails[id];
    if (detail) {
      json(res, detail);
    } else {
      // Return basic product data if no detail fixture exists
      const product = products.find((p) => p.id === id);
      if (product) {
        json(res, { ...product, modifier_groups: [] });
      } else {
        notFound(res);
      }
    }
    return;
  }

  // ── Collections (empty — triggers category fallback) ──
  if (method === 'GET' && path === '/api/v1/collections/') {
    json(res, { results: [], count: 0, next: null });
    return;
  }

  // ── Categories ──
  if (method === 'GET' && path === '/api/v1/categories/') {
    json(res, { results: categories, count: categories.length });
    return;
  }

  // ── CMS pages ──
  const pageMatch = path.match(/^\/api\/v1\/pages\/([^/]+)\/$/);
  if (method === 'GET' && pageMatch) {
    const slug = pageMatch[1];
    const pages: Record<string, ReturnType<typeof aboutPage>> = {
      about: aboutPage(),
      contact: contactPage(),
    };
    if (pages[slug]) {
      json(res, pages[slug]);
    } else {
      notFound(res);
    }
    return;
  }

  // ── Cart: create ──
  if (method === 'POST' && path === '/api/v1/cart/') {
    const state = getCartState(req);
    json(res, state.cart, 201);
    return;
  }

  // ── Cart suggestions ──
  const cartSuggestionsMatch = path.match(/^\/api\/v1\/cart\/([^/]+)\/suggestions\/$/);
  if (method === 'GET' && cartSuggestionsMatch) {
    // Filter out suggestions for products already in cart
    const state = getCartState(req);
    const cartProductIds = new Set(state.cart.line_items.map((li) => li.product_id));
    const cartSuggestions = (suggestions['cart'] ?? []).filter(
      (s) => !cartProductIds.has(`prod-${s.id}`),
    );
    json(res, cartSuggestions);
    return;
  }

  // ── Cart: get by ID ──
  const cartGetMatch = path.match(/^\/api\/v1\/cart\/([^/]+)\/$/);
  if (method === 'GET' && cartGetMatch) {
    const state = getCartState(req);
    const lat = url.searchParams.get('latitude');
    const lng = url.searchParams.get('longitude');

    if (lat && lng && state.cart.line_items.length > 0) {
      // Free shipping for coordinates near Leiden (lat ~52.16)
      const isFreeShipping = Math.abs(parseFloat(lat) - 52.16) < 0.1;
      const shippingCost = isFreeShipping ? '0.00' : '4.95';
      const cartWithShipping = {
        ...state.cart,
        shipping_estimate: {
          groups: [
            {
              provider_name: 'PostNL',
              fulfillment_type: 'local_delivery',
              status: 'quoted',
              estimated_cost: shippingCost,
              items: state.cart.line_items.map((li) => li.product_id),
            },
          ],
          total_shipping: shippingCost,
          ships_in_parts: false,
        },
      };
      json(res, cartWithShipping);
      return;
    }

    json(res, state.cart);
    return;
  }

  // ── Cart: add item ──
  const cartAddMatch = path.match(/^\/api\/v1\/cart\/([^/]+)\/items\/$/);
  if (method === 'POST' && cartAddMatch) {
    const state = getCartState(req);
    const body = JSON.parse(await readBody(req));
    // Match by exact ID or by numeric suffix (suggestion IDs are numeric, fixture IDs are 'prod-N')
    const productId = body.product_id;
    const product = products.find(
      (p) => p.id === productId || p.id === `prod-${productId}` || p.id === String(productId),
    );
    if (!product) {
      json(res, { detail: 'Product not found' }, 400);
      return;
    }

    const options = (body.options ?? body.modifiers ?? []).map(
      (m: { option_id: string; option_group_id?: string; quantity: number }) => {
        const detail = productDetails[product.id] as typeof shawarmaDetail | undefined;
        const allGroups = detail?.modifier_groups ?? [];
        const optId = String(m.option_id);
        const allOpts = allGroups.flatMap((g) => g.options) ?? [];
        const opt = allOpts.find((o) => String(o.id) === optId);
        const group = allGroups.find((g) => g.options.some((o) => String(o.id) === optId));
        return {
          option_id: m.option_id,
          option_title: opt?.title ?? optId,
          option_group_title: group?.title ?? '',
          price_modifier: opt?.price_modifier ?? '0.00',
          quantity: m.quantity,
        };
      },
    );

    const lineItem = {
      id: `li-${state.nextLineItemId++}`,
      product_id: product.id,
      product_title: product.title,
      product_image: product.image ?? undefined,
      quantity: body.quantity ?? 1,
      unit_price: product.price,
      line_total: '0.00', // recalculated below
      options: options,
      notes: body.notes,
      fulfillment_type: 'local_delivery',
      fulfillment_date: new Date().toISOString().slice(0, 10),
      tax_rate: '0.09',
      tax_amount: '0.00',
      product_type: 'physical',
      surcharges: [] as unknown[],
      gift_card_details: null as Record<string, unknown> | null,
    };

    state.cart.line_items.push(lineItem);
    recalcCart(state.cart);
    json(res, state.cart, 201);
    return;
  }

  // ── Cart: update quantity ──
  const cartPatchMatch = path.match(/^\/api\/v1\/cart\/([^/]+)\/items\/([^/]+)\/$/);
  if (method === 'PATCH' && cartPatchMatch) {
    const state = getCartState(req);
    const id = cartPatchMatch[2];
    const body = JSON.parse(await readBody(req));
    const item = state.cart.line_items.find((li) => li.id === id);
    if (!item) {
      notFound(res);
      return;
    }
    item.quantity = body.quantity;
    recalcCart(state.cart);
    json(res, state.cart);
    return;
  }

  // ── Cart: remove item ──
  const cartDeleteMatch = path.match(/^\/api\/v1\/cart\/([^/]+)\/items\/([^/]+)\/$/);
  if (method === 'DELETE' && cartDeleteMatch) {
    const state = getCartState(req);
    const id = cartDeleteMatch[2];
    state.cart.line_items = state.cart.line_items.filter((li) => li.id !== id);
    recalcCart(state.cart);
    json(res, state.cart);
    return;
  }

  // ── Promotions: eligible ──
  if (method === 'POST' && path === '/api/v1/promotions/eligible/') {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, { detail: 'Invalid request body' }, 400);
      return;
    }
    const cartItems =
      (body.cart_items as Array<{ product_id: string; quantity: number; price: string }>) ?? [];
    const eligible: unknown[] = [];

    // Test promotion: Buy 2 Falafel Wraps get 1 free
    const falafelItem = cartItems.find((i) => i.product_id === 'prod-1');
    if (falafelItem && falafelItem.quantity >= 2) {
      eligible.push({
        id: 1,
        name: 'Buy 2 Falafel Wraps, get 1 free!',
        promotion_type: 'bogo',
        benefit_type: 'free',
        benefit_product_ids: [1],
        benefit_quantity: 1,
        discount_amount: falafelItem.price,
        is_best_deal: true,
      });
    }

    json(res, {
      eligible_promotions: eligible,
      best_promotion_id: eligible.length > 0 ? 1 : null,
    });
    return;
  }

  // ── Cart: apply discount code ──
  const cartDiscountApplyMatch = path.match(/^\/api\/v1\/cart\/([^/]+)\/apply-discount\/$/);
  if (method === 'POST' && cartDiscountApplyMatch) {
    const state = getCartState(req);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, { detail: 'Invalid request body' }, 400);
      return;
    }
    const code = (body.code as string)?.toUpperCase();

    const testDiscounts: Record<string, { id: string; name: string; type: string; value: number }> =
      {
        SAVE10: { id: 'disc-1', name: '10% Off', type: 'percentage', value: 10 },
        FLAT5: { id: 'disc-2', name: '€5 Off', type: 'fixed_amount', value: 5 },
        EXPIRED: { id: 'disc-3', name: 'Expired Code', type: 'percentage', value: 0 },
      };

    const discount = testDiscounts[code];
    if (!discount) {
      json(res, { error: { code: 'DISCOUNT_INVALID', message: 'Invalid discount code' } }, 400);
      return;
    }
    if (code === 'EXPIRED') {
      json(res, { error: { code: 'DISCOUNT_EXPIRED', message: 'Discount code expired' } }, 400);
      return;
    }

    const subtotal = parseFloat(state.cart.subtotal ?? state.cart.cart_total);
    const discountAmount =
      discount.type === 'percentage'
        ? (subtotal * discount.value) / 100
        : Math.min(discount.value, subtotal);

    state.cart.applied_discount = {
      id: discount.id,
      code,
      name: discount.name,
      discount_amount: discountAmount.toFixed(2),
    };
    state.cart.discount_amount = discountAmount.toFixed(2);
    recalcCart(state.cart);
    json(res, state.cart);
    return;
  }

  // ── Cart: remove discount code ──
  const cartDiscountRemoveMatch = path.match(/^\/api\/v1\/cart\/([^/]+)\/remove-discount\/$/);
  if (method === 'DELETE' && cartDiscountRemoveMatch) {
    const state = getCartState(req);
    delete state.cart.applied_discount;
    state.cart.discount_amount = '0.00';
    recalcCart(state.cart);
    json(res, state.cart);
    return;
  }

  // ── Pickup locations ──
  if (method === 'GET' && path === '/api/v1/pickup-locations/') {
    json(res, [
      {
        id: 1,
        name: 'Poke Perfect Amsterdam',
        address: {
          street: 'Damstraat 1',
          city: 'Amsterdam',
          postal_code: '1012LG',
        },
        pickup_instructions: 'Collect at the counter',
        lead_time_minutes: 15,
        max_advance_days: 7,
        time_slots: [],
      },
    ]);
    return;
  }

  // ── Comms: active messages ──
  if (method === 'GET' && path.startsWith('/api/v1/merchant-comms/storefront/active/')) {
    json(res, allSurfaceMessages());
    return;
  }

  // ── Comms: events ingest (fire-and-forget) ──
  if (method === 'POST' && path === '/api/v1/merchant-comms/storefront/events/') {
    await readBody(req); // consume body
    json(res, { status: 'ok' }, 202);
    return;
  }

  // ── Checkout: create ──
  if (method === 'POST' && path === '/api/v1/checkout/') {
    const state = getCartState(req);
    const body = JSON.parse(await readBody(req));
    const cartId = body.cart_id ?? state.cart.id;

    const lineItems = state.cart.line_items.map((li) => ({
      product_id: li.product_id,
      title: li.product_title,
      quantity: li.quantity,
      unit_price: li.unit_price,
      total_price: li.line_total,
    }));

    const subtotal = parseFloat(state.cart.subtotal ?? state.cart.cart_total);
    const taxRate = 0.09;
    const taxTotal = (subtotal * taxRate) / (1 + taxRate);
    const discount = parseFloat(state.cart.discount_amount ?? '0');

    const checkout: CheckoutState = {
      id: `chk-${Date.now()}`,
      cart_id: cartId,
      status: 'created',
      email: null,
      shipping_address: null,
      shipping_method_id: null,
      fulfillment_slot_id: null,
      line_items: lineItems,
      subtotal: subtotal.toFixed(2),
      tax_total: taxTotal.toFixed(2),
      shipping_cost: '0.00',
      discount_amount: discount.toFixed(2),
      total: (subtotal - discount).toFixed(2),
      order_number: null,
    };

    checkoutStates.set(checkout.id, checkout);
    json(res, checkoutToResponse(checkout), 201);
    return;
  }

  // ── Checkout: delivery update ──
  const checkoutDeliveryMatch = path.match(/^\/api\/v1\/checkout\/([^/]+)\/delivery\/$/);
  if (method === 'PATCH' && checkoutDeliveryMatch) {
    const id = checkoutDeliveryMatch[1];
    const checkout = checkoutStates.get(id);
    if (!checkout) {
      notFound(res);
      return;
    }
    const body = JSON.parse(await readBody(req));
    if (body.email != null) checkout.email = body.email;
    if (body.shipping_address != null) checkout.shipping_address = body.shipping_address;
    if (body.shipping_method_id != null) checkout.shipping_method_id = body.shipping_method_id;
    if (body.fulfillment_slot_id != null) checkout.fulfillment_slot_id = body.fulfillment_slot_id;

    checkout.status = 'delivery_set';

    // Recalculate shipping cost based on fulfillment method
    const isPickup =
      checkout.shipping_method_id === 'pickup' || checkout.shipping_method_id === 'store_pickup';
    checkout.shipping_cost = isPickup ? '0.00' : '5.00';
    const subtotal = parseFloat(checkout.subtotal);
    const discount = parseFloat(checkout.discount_amount);
    checkout.total = (subtotal + parseFloat(checkout.shipping_cost) - discount).toFixed(2);

    json(res, checkoutToResponse(checkout));
    return;
  }

  // ── Checkout: shipping groups ──
  const checkoutShippingMatch = path.match(/^\/api\/v1\/checkout\/([^/]+)\/shipping-groups\/$/);
  if (method === 'GET' && checkoutShippingMatch) {
    const id = checkoutShippingMatch[1];
    const checkout = checkoutStates.get(id);
    if (!checkout) {
      notFound(res);
      return;
    }
    // Generate a 15-minute expiry for Uber Direct rate
    const uberExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    json(res, [
      {
        id: 'grp-1',
        merchant_shipping_provider_id: 1,
        shipping_cost: '5.00',
        selected_rate_id: null,
        is_digital: false,
        available_rates: [
          {
            id: 'rate-local',
            name: 'Local Delivery',
            cost: '5.00',
            original_cost: '5.00',
            rate_id: 'local_delivery',
            expires_at: null,
          },
          {
            id: 'rate-uber',
            name: 'Uber Direct',
            cost: '6.50',
            original_cost: '6.50',
            rate_id: 'dqt_mock_quote_id',
            expires_at: uberExpiry,
          },
        ],
        line_items: [],
      },
    ]);
    return;
  }

  // ── Checkout: select shipping rate ──
  const selectRateMatch = path.match(
    /^\/api\/v1\/checkout\/([^/]+)\/shipping-groups\/select-rate\/$/,
  );
  if (method === 'POST' && selectRateMatch) {
    const id = selectRateMatch[1];
    const checkout = checkoutStates.get(id);
    if (!checkout) {
      notFound(res);
      return;
    }
    const body = JSON.parse(await readBody(req));
    const { rate_id } = body;

    // Simulate expired rate if rate_id starts with 'expired_'
    if (rate_id === 'expired_rate') {
      res.writeHead(410, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ error: { code: 'shipping_rate_expired', message: 'Rate has expired' } }),
      );
      return;
    }

    // Apply selected rate cost to checkout
    const rateCost = rate_id === 'dqt_mock_quote_id' ? '6.50' : '5.00';
    checkout.shipping_cost = rateCost;
    const subtotal = parseFloat(checkout.subtotal);
    const discount = parseFloat(checkout.discount_amount);
    checkout.total = (subtotal + parseFloat(rateCost) - discount).toFixed(2);

    json(res, { status: 'ok', selected_rate_id: rate_id });
    return;
  }

  // ── Checkout: payment gateways ──
  const checkoutGatewaysMatch = path.match(/^\/api\/v1\/checkout\/([^/]+)\/payment-gateways\/$/);
  if (method === 'GET' && checkoutGatewaysMatch) {
    const id = checkoutGatewaysMatch[1];
    const checkout = checkoutStates.get(id);
    if (!checkout) {
      notFound(res);
      return;
    }
    json(res, [
      {
        id: 'stripe',
        name: 'Stripe',
        config: [
          { key: 'publishable_key', value: 'pk_test_mock' },
          { key: 'stripe_account', value: 'acct_mock' },
        ],
      },
    ]);
    return;
  }

  // ── Checkout: initiate payment ──
  const checkoutPaymentMatch = path.match(/^\/api\/v1\/checkout\/([^/]+)\/payment\/$/);
  if (method === 'POST' && checkoutPaymentMatch) {
    const id = checkoutPaymentMatch[1];
    const checkout = checkoutStates.get(id);
    if (!checkout) {
      notFound(res);
      return;
    }
    checkout.status = 'paid';
    json(res, {
      ...checkoutToResponse(checkout),
      client_secret: 'pi_mock_secret',
      payment_intent_id: 'pi_mock_123',
    });
    return;
  }

  // ── Checkout: confirm payment (replaces polling) ──
  const checkoutConfirmMatch = path.match(/^\/api\/v1\/checkout\/([^/]+)\/confirm-payment\/$/);
  if (method === 'POST' && checkoutConfirmMatch) {
    const id = checkoutConfirmMatch[1];
    const checkout = checkoutStates.get(id);
    if (!checkout) {
      notFound(res);
      return;
    }
    if (checkout.status !== 'completed') {
      checkout.status = 'completed';
      checkout.order_number = `ORD-${Date.now()}`;
    }
    json(res, checkoutToResponse(checkout));
    return;
  }

  // ── Checkout: complete ──
  const checkoutCompleteMatch = path.match(/^\/api\/v1\/checkout\/([^/]+)\/complete\/$/);
  if (method === 'POST' && checkoutCompleteMatch) {
    const id = checkoutCompleteMatch[1];
    const checkout = checkoutStates.get(id);
    if (!checkout) {
      notFound(res);
      return;
    }
    if (checkout.status !== 'completed') {
      checkout.status = 'completed';
      checkout.order_number = `ORD-${Date.now()}`;
    }
    json(res, checkoutToResponse(checkout));
    return;
  }

  // ── Checkout: get by ID (must come after sub-routes) ──
  const checkoutGetMatch = path.match(/^\/api\/v1\/checkout\/([^/]+)\/$/);
  if (method === 'GET' && checkoutGetMatch) {
    const id = checkoutGetMatch[1];
    const checkout = checkoutStates.get(id);
    if (!checkout) {
      notFound(res);
      return;
    }
    json(res, checkoutToResponse(checkout));
    return;
  }

  // ── Fulfillment: time slots ──
  const fulfillmentSlotsMatch = path.match(/^\/api\/v1\/fulfillment\/locations\/([^/]+)\/slots\/$/);
  if (method === 'GET' && fulfillmentSlotsMatch) {
    const locationId = fulfillmentSlotsMatch[1];
    const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    json(res, {
      location_id: parseInt(locationId, 10) || 1,
      date,
      time_slots: [
        {
          id: 'slot-1',
          start_time: '12:00',
          end_time: '12:30',
          capacity: 10,
          reserved_count: 3,
          available: true,
          remaining_capacity: 7,
        },
        {
          id: 'slot-2',
          start_time: '12:30',
          end_time: '13:00',
          capacity: 10,
          reserved_count: 5,
          available: true,
          remaining_capacity: 5,
        },
        {
          id: 'slot-3',
          start_time: '13:00',
          end_time: '13:30',
          capacity: 10,
          reserved_count: 10,
          available: false,
          remaining_capacity: 0,
        },
        {
          id: 'slot-4',
          start_time: '13:30',
          end_time: '14:00',
          capacity: 10,
          reserved_count: 2,
          available: true,
          remaining_capacity: 8,
        },
      ],
    });
    return;
  }

  // ── Fallback ──
  notFound(res);
}

// ── Start server ─────────────────────────────────────────────────

const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`Mock API server running on http://localhost:${PORT}`);
});
