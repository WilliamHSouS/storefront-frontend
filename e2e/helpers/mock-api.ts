/**
 * Mock API server for E2E tests.
 *
 * Runs as a standalone Node HTTP server on port 4322.
 * Serves fixture data for both SSR (Astro server-side) and browser-side SDK calls.
 * Cart state is kept in-memory and can be reset via POST /test/reset.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { products, categories, shawarmaDetail, falafelDetail } from '../fixtures/products';
import { aboutPage, contactPage } from '../fixtures/cms';
import { emptyCart, type CartFixture } from '../fixtures/cart';

const PORT = 4322;
const ALLOWED_ORIGIN = 'http://localhost:4321';

// ── In-memory state (per-test isolation via x-test-cart-id header) ──

interface CartState {
  cart: CartFixture;
  nextLineItemId: number;
}

const carts = new Map<string, CartState>();

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
}

// ── Helpers ──────────────────────────────────────────────────────

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Vendor-ID, Accept-Language, Accept, Authorization',
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
    const modTotal = item.selected_options.reduce(
      (s, m) => s + parseFloat(m.price) * m.quantity,
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

  // ── Products list ──
  if (method === 'GET' && path === '/api/v1/products/') {
    const categoryFilter = url.searchParams.get('category');
    const filtered = categoryFilter
      ? products.filter((p) => p.category_id === categoryFilter)
      : products;
    json(res, { results: filtered, next: null });
    return;
  }

  // ── Product search (must come BEFORE product detail to avoid
  //    the /products/{id}/ regex matching "search" as a product ID) ──
  if (method === 'GET' && path === '/api/v1/products/search/') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const results = products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
    );
    json(res, { results });
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
        json(res, { ...product, modifier_groups: [], cross_sells: [] });
      } else {
        notFound(res);
      }
    }
    return;
  }

  // ── Collections (empty — triggers category fallback) ──
  if (method === 'GET' && path === '/api/v1/collections/') {
    json(res, { results: [], next: null });
    return;
  }

  // ── Categories ──
  if (method === 'GET' && path === '/api/v1/categories/') {
    json(res, { results: categories });
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

  // ── Cart: get by ID ──
  const cartGetMatch = path.match(/^\/api\/v1\/cart\/([^/]+)\/$/);
  if (method === 'GET' && cartGetMatch) {
    const state = getCartState(req);
    json(res, state.cart);
    return;
  }

  // ── Cart: add item ──
  const cartAddMatch = path.match(/^\/api\/v1\/cart\/([^/]+)\/items\/$/);
  if (method === 'POST' && cartAddMatch) {
    const state = getCartState(req);
    const body = JSON.parse(await readBody(req));
    const product = products.find((p) => p.id === body.product_id);
    if (!product) {
      json(res, { detail: 'Product not found' }, 400);
      return;
    }

    const selectedOptions = (body.options ?? []).map(
      (m: { option_id: string | number; option_group_id: string | number; quantity: number }) => {
        const detail = productDetails[product.id] as typeof shawarmaDetail | undefined;
        // The frontend sends Number(opt.id). Match by converting both sides to
        // strings so "202" === String(202) works with numeric fixture IDs.
        const optId = String(m.option_id);
        const groupId = String(m.option_group_id);
        const group = detail?.modifier_groups?.find(
          (g) => g.options.some((o) => o.id === optId) || g.id === groupId,
        );
        const opt = group?.options.find((o) => o.id === optId);
        return {
          id: optId,
          name: opt?.name ?? optId,
          group_name: group?.name,
          price: opt?.price ?? '0.00',
          quantity: m.quantity,
        };
      },
    );

    const lineItem = {
      id: `li-${state.nextLineItemId++}`,
      product_id: product.id,
      product_title: product.name,
      product_image: product.image ?? undefined,
      quantity: body.quantity ?? 1,
      unit_price: product.price,
      line_total: '0.00', // recalculated below
      selected_options: selectedOptions,
      notes: body.notes,
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
        benefit_product_ids: ['prod-1'],
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
      json(res, { detail: 'Invalid discount code' }, 400);
      return;
    }
    if (code === 'EXPIRED') {
      json(res, { detail: 'Discount code expired' }, 400);
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

  // ── Fallback ──
  notFound(res);
}

// ── Start server ─────────────────────────────────────────────────

const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`Mock API server running on http://localhost:${PORT}`);
});
