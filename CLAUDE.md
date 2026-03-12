# CLAUDE.md — Storefront Frontend

## Quick Reference

```bash
pnpm dev                # Astro dev server (port 4321)
pnpm build              # Production build
pnpm check              # Astro type checking
pnpm test               # Unit tests (Vitest + happy-dom)
pnpm test:watch         # Unit tests in watch mode
pnpm test:e2e           # E2E tests (Playwright)
pnpm test:e2e:ui        # E2E tests with UI inspector
pnpm size:check         # Bundle size limit enforcement (65 KB gzipped)
```

## Project Overview

Multi-merchant, multi-language restaurant ordering storefront. Astro 5 SSR with Preact islands for interactivity. Deployed on Vercel.

**Stack:** Astro 5 + Preact + Nanostores + Tailwind CSS + TypeScript
**API client:** `@poweredbysous/storefront-sdk` wrapped via `src/lib/sdk-stub.ts`
**Testing:** Vitest (unit), Playwright (e2e with mock API on port 4322)

## Directory Structure

```
src/
  pages/[lang]/           # Language-prefixed routes (nl/, en/, de/)
  components/astro/       # Server-rendered Astro components
  components/interactive/ # Preact islands (client:load / client:idle)
  stores/                 # Nanostores atoms (cart, merchant, ui, auth)
  lib/                    # Shared utilities (normalize, pricing, currency, sdk)
  merchants/              # Merchant config JSON files (loaded via import.meta.glob)
  types/                  # TypeScript interfaces
  i18n/messages/          # Translation JSON files (en, nl, de)
  middleware.ts           # Core request pipeline (merchant + lang + SDK injection)
e2e/
  fixtures/               # Test data (products, cart, cms)
  helpers/mock-api.ts     # In-memory mock API server
  helpers/test-utils.ts   # Shared page/cart helpers
  *.spec.ts               # Test suites
```

## Architecture Decisions

### Middleware Pipeline (`src/middleware.ts`)

All requests flow through middleware in this order:

1. Skip `/404` (prevent rewrite loops)
2. Skip static assets — **except** SEO endpoints (`/sitemap.xml`, `/robots.txt`)
3. Resolve merchant from hostname → load `MerchantConfig`
4. SEO endpoints: inject merchant context, skip language routing
5. Extract + validate language prefix from path (redirect if invalid)
6. Create SDK client with language, inject into `Astro.locals`
7. Execute page, then apply cache headers

**Critical:** SEO endpoints must be checked _before_ the static-asset bypass. Both `.xml` and `.txt` match the static-asset regex, so `LANG_EXEMPT_PATHS` guards them.

### Product Slug Format: `{name}--{id}`

Slugs use a **double-hyphen `--`** separator between the human-readable name and the product ID:

```
falafel-wrap--prod-1
bitterballen--42
```

- `normalizeProduct()` in `src/lib/normalize.ts` generates slugs in this format
- `extractIdFromSlug()` splits on the last `--` to recover the ID
- Product detail pages fetch by ID: `/api/v1/products/{id}/`
- The sitemap (`src/pages/sitemap.xml.ts`) must also use `--` format

**Why `--`?** Product IDs can be non-numeric (`prod-1`). A single `-` is ambiguous since slugified text contains hyphens. `slugify()` never produces `--`, so the separator is unambiguous.

### Islands Architecture

**Server-rendered** (`src/components/astro/`): ProductCard, Header, Footer, MenuSection, SEOHead
**Interactive islands** (`src/components/interactive/`): CartBadge, CartDrawer, CartBar, ProductDetail, AddToCartButton, SearchBar

Shared islands (CartDrawer, ProductDetail, SearchBar, FreshnessProvider) are mounted in `BaseLayout.astro` on every page. They communicate via nanostores:

```
$cart, $itemCount, $cartTotal  — cart state
$isCartOpen                    — cart drawer visibility
$selectedProduct               — product detail modal
$activeCategory                — category filter
$merchant                      — merchant config (bridged from SSR via window.__MERCHANT__)
```

### SDK / API Client

**Server-side:** `Astro.locals.sdk` (created in middleware)
**Client-side:** `getClient()` from `src/lib/api.ts` (lazy singleton)

Both return `ApiResult<T> = { data: T; error: null } | { data: null; error: Error }`.

### Cart API Endpoints

```
POST   /api/v1/cart/                       # Create cart
GET    /api/v1/cart/{cart_id}/              # Fetch cart
POST   /api/v1/cart/{cart_id}/items/        # Add item
PATCH  /api/v1/cart/{cart_id}/items/{id}/   # Update quantity
DELETE /api/v1/cart/{cart_id}/items/{id}/   # Remove item
```

Cart ID persisted in `localStorage`. The e2e mock server (`e2e/helpers/mock-api.ts`) must match these exact paths.

### Multi-Merchant

Merchant configs live in `src/merchants/{slug}.json`, loaded statically via `import.meta.glob()`. Hostname resolution (`src/lib/resolve-merchant.ts`):

- `{slug}.poweredbysous.com` → slug
- Custom domains via `CUSTOM_DOMAINS` env var (JSON map)
- Fallback: `DEFAULT_MERCHANT` env var

Each merchant defines: theme (HSL colors, fonts, radius), languages, currency, layout (grid/list), contact info, SEO settings.

### Data Normalization

Always normalize API responses at the boundary (`src/lib/normalize.ts`):

- `normalizeProduct()` — maps `title→name`, `images[]→image`, generates `--` slug
- `normalizeCollection()` — maps collections to `NormalizedCategory` shape
- `flattenCategories()` — flattens hierarchical categories to leaf nodes
- `parseMetadataMap()` — converts `[{key, value}]` arrays to `Map`

### Caching

Middleware applies cache headers after page execution:

- Products/collections: `s-maxage=300` (5 min)
- CMS pages: `s-maxage=3600` (1 hour)
- Authenticated/cookie responses: `private, no-store`

## E2E Testing Conventions

- Mock API server runs on port 4322, Astro dev on 4321
- Per-test cart isolation via `x-test-cart-id` header (set by `resetMockApi()`)
- Use `.first()` on `[data-product-id]` locators — products appear in multiple category sections
- Cart trigger button uses `data-cart-trigger` attribute (on CartBadge)
- Hydration wait: `waitForHydration()` checks `window.__MERCHANT__` or falls back to `networkidle`
- Block analytics in tests via `blockAnalytics()`

## Environment Variables

| Variable              | Purpose                                 |
| --------------------- | --------------------------------------- |
| `API_BASE_URL`        | Server-side API base                    |
| `PUBLIC_API_BASE_URL` | Client-side API base (browser)          |
| `DEFAULT_MERCHANT`    | Fallback merchant slug                  |
| `CUSTOM_DOMAINS`      | JSON map: custom domain → merchant slug |
| `PUBLIC_POSTHOG_KEY`  | PostHog analytics key                   |
| `AUTH_COOKIE_DOMAIN`  | Auth cookie domain                      |

## Common Patterns

```typescript
// Fetch + normalize product
const { data } = await sdk.GET('/api/v1/products/{id}/', {
  params: { path: { id: productId } },
});
const product = normalizeProduct(data);

// Format price for locale
import { formatPrice, langToLocale } from '@/lib/currency';
formatPrice('19.99', 'EUR', langToLocale('nl')); // "€ 19,99"

// Translation
import { t } from '@/i18n';
t('cart', lang); // "Winkelwagen" (nl)

// Nanostores in Preact island
import { useStore } from '@nanostores/preact';
const cart = useStore($cart);
```

## Gotchas

- **Merchant loading is static.** `import.meta.glob()` runs at build time. No dynamic imports.
- **Island hydration timing.** `client:visible` islands need scroll + JS download before event handlers work. E2E tests must wait for hydration.
- **Slug round-trip invariant.** Any code that generates product URLs must use `--` separator. Any code that reads product IDs from URLs must use `extractIdFromSlug()`.
- **Import alias.** Use `@/` prefix for `src/` imports (configured in tsconfig).
- **Bundle budget.** Total client JS must stay under 65 KB gzipped. Run `pnpm size:check` before merging.
- **Falsy value checks on API data.** Use `== null` or `=== undefined` instead of `!value` when checking API string values that could be `"0"` or `"0.00"`. JavaScript truthiness conflates "missing" with "zero", hiding valid data like free shipping.
- **Island DOM stability.** Preact islands mounted before `<slot/>` in BaseLayout must never return `null`. Always render a stable wrapper element to prevent Astro from re-evaluating sibling islands on state changes.
