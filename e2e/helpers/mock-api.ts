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
  let total = 0;
  let count = 0;
  for (const item of cart.line_items) {
    const modTotal = item.options.reduce(
      (s, m) => s + parseFloat(m.price_modifier) * m.quantity,
      0,
    );
    const lineTotal = (parseFloat(item.unit_price) + modTotal) * item.quantity;
    item.line_total = lineTotal.toFixed(2);
    total += lineTotal;
    count += item.quantity;
  }
  cart.cart_total = total.toFixed(2);
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
      (p) => p.title.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
    );
    json(res, { results });
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
        // Look up modifier title/price from product details
        const detail = productDetails[product.id] as typeof shawarmaDetail | undefined;
        const allGroups = detail?.modifier_groups ?? [];
        const allOpts = allGroups.flatMap((g) => g.options) ?? [];
        const opt = allOpts.find((o) => o.id === m.option_id);
        const group = allGroups.find((g) => g.options.some((o) => o.id === m.option_id));
        return {
          option_id: m.option_id,
          option_title: opt?.title ?? String(m.option_id),
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

  // ── Fallback ──
  notFound(res);
}

// ── Start server ─────────────────────────────────────────────────

const server = createServer(handleRequest);
server.listen(PORT, () => {
  console.log(`Mock API server running on http://localhost:${PORT}`);
});
