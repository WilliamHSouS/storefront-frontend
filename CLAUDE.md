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
$checkout, $checkoutTotals     — checkout state + computed display totals
$addressCoords, $addressEligibility — address location + fulfillment eligibility
$toasts                        — toast notification queue
```

### SDK / API Client

**Server-side:** `Astro.locals.sdk` (created in middleware)
**Client-side:** `getClient()` from `src/lib/api.ts` (lazy singleton)

Both return `ApiResult<T> = { data: T; error: null } | { data: null; error: Error }`.

### API Contract & Type Safety

**The SDK is the contract.** `@poweredbysous/storefront-sdk` is generated from the backend's OpenAPI spec (`openapi.storefront.v1.json`). TypeScript enforces the contract at compile time — but only if we don't bypass it.

**Rules:**

1. **Never use `as any` on SDK paths.** If a path isn't recognized, the SDK needs updating — not a cast. File an issue or regenerate the SDK. Targeted `as any` on the `opts` parameter is acceptable when the SDK's per-path options type is too strict.
2. **Use path literals, not interpolated strings.** `'/api/v1/checkout/{checkout_id}/'` with `params: { path: { checkout_id } }` — not `` `/api/v1/checkout/${id}/` ``.
3. **Type response data from the SDK, not local interfaces.** The SDK's response types are the source of truth. If a local type diverges, update the local type or cast through `unknown`.
4. **`sdk-stub.ts` preserves SDK generics.** The `StorefrontClient` interface uses the SDK's `paths` type so method calls are type-checked against the OpenAPI spec. Do not weaken the interface.

**When adding new API calls:**

```typescript
// ✅ Correct — typed path, typed params
const { data, error } = await sdk.GET('/api/v1/checkout/{checkout_id}/', {
  params: { path: { checkout_id: id } },
});

// ❌ Wrong — interpolated string bypasses type checking
const { data, error } = await sdk.GET(`/api/v1/checkout/${id}/` as any);
```

**Mock API contract tests:** `e2e/contract.spec.ts` validates that `e2e/helpers/mock-api.ts` responses match the backend's OpenAPI schema. When adding new mock endpoints, add a corresponding contract test. Run `npx playwright test e2e/contract.spec.ts` to verify.

**SDK update process:**

1. Backend team updates API → regenerates `openapi.storefront.v1.json`
2. SDK is regenerated from the spec → `@poweredbysous/storefront-sdk` version bump
3. Frontend updates SDK dep → `pnpm check` catches any breaking changes at compile time
4. Contract tests catch mock drift → update `e2e/helpers/mock-api.ts` to match

### Cart API Endpoints

```
POST   /api/v1/cart/                       # Create cart
GET    /api/v1/cart/{cart_id}/              # Fetch cart
POST   /api/v1/cart/{cart_id}/items/        # Add item
PATCH  /api/v1/cart/{cart_id}/items/{id}/   # Update quantity
DELETE /api/v1/cart/{cart_id}/items/{id}/   # Remove item
```

Cart ID persisted in `localStorage`. The e2e mock server (`e2e/helpers/mock-api.ts`) must match these exact paths.

### Checkout API Endpoints

```
POST   /api/v1/checkout/                              # Create checkout from cart
GET    /api/v1/checkout/{id}/                          # Fetch checkout
PATCH  /api/v1/checkout/{id}/delivery/                 # Update delivery details (address, contact, shipping method)
GET    /api/v1/checkout/{id}/payment-gateways/         # List payment gateways (Stripe config)
POST   /api/v1/checkout/{id}/payment/                  # Initiate payment (returns client_secret)
POST   /api/v1/checkout/{id}/complete/                 # Complete checkout after payment
GET    /api/v1/checkout/{id}/shipping/                 # Shipping rate groups
GET    /api/v1/fulfillment/locations/{id}/slots/       # Time slots for a location + date
POST   /api/v1/fulfillment/address-check/              # Check address eligibility + available fulfillment types
GET    /api/v1/pickup-locations/                        # List merchant pickup locations
```

Checkout ID persisted in `sessionStorage`. Cleared on successful order completion.

### Checkout Flow

The checkout is a multi-step progression driven by status transitions:

1. **Cart → Checkout** (`createCheckout`): POST creates checkout from cart ID
2. **Delivery PATCH** (`patchDelivery`): Debounced 500ms. Sends contact info, address, `fulfillment_type`, and `shipping_method_id`. Backend transitions status from `created` → `delivery_set`
3. **Payment Gateway**: Effect watches for `delivery_set` status → fetches gateway config → calls `initiatePayment` to get Stripe `client_secret` → mounts Payment Element
4. **Place Order**: `confirmPayment` with Stripe → `completeCheckout` or redirect for bank payments (iDEAL)
5. **Success**: Poll checkout status for bank redirects. Clear cart + checkout on confirmation

**Address eligibility** (`$addressEligibility`): The address-check API returns `available_fulfillment_types` (e.g. `['local_delivery', 'pickup']`) and `available_shipping_providers`. The checkout derives `fulfillment_type` and `shipping_method_id` from this data — never hardcode these values.

### Multi-Merchant

Merchant configs live in `src/merchants/{slug}.json`, loaded statically via `import.meta.glob()`. Hostname resolution (`src/lib/resolve-merchant.ts`):

- `{slug}.{PLATFORM_SUFFIX}` → slug (suffix configured via `PLATFORM_SUFFIXES` env var)
- Custom domains via `CUSTOM_DOMAINS` env var (JSON map)
- Fallback: `DEFAULT_MERCHANT` env var
- Local dev default: `.poweredbysous.localhost` (when `PLATFORM_SUFFIXES` is unset)

Each merchant defines: theme (HSL colors, fonts, radius), languages, currency, layout (grid/list), contact info, SEO settings.

### Data Normalization

Always normalize API responses at the boundary (`src/lib/normalize.ts`):

- `normalizeProduct()` — maps `title→name`, `images[]→image`, generates `--` slug
- `normalizeCollection()` — maps collections to `NormalizedCategory` shape
- `flattenCategories()` — flattens hierarchical categories to leaf nodes
- `parseMetadataMap()` — converts `[{key, value}]` arrays to `Map`

### Translation Management (Lokalise)

Translations are managed via [Lokalise](https://app.lokalise.com). JSON files in `src/i18n/messages/` are the source of truth in the repo.

**Workflow:**

1. Developers add new keys to `en.json` / `nl.json` / `de.json` and commit
2. Upload to Lokalise: `lokalise2 file upload --config .lokalise.yml --file src/i18n/messages/en.json --lang-iso en`
3. Translators work in the Lokalise UI
4. A weekly GitHub Actions workflow pulls updates and opens a PR

**Adding new translation keys:**

- Add the key to ALL 3 locale files (`en.json`, `nl.json`, `de.json`)
- Use `camelCase` key names
- Use `{param}` for interpolation (e.g. `"greeting": "Hello {name}"`)
- Use `_one` / `_other` suffixes for plurals (e.g. `items_one`, `items_other`)
- Source language is `nl` (Dutch) — the TypeScript `MessageKey` type is derived from `nl.json`

**Environment variables for CI:**

- `LOKALISE_API_TOKEN` — set in GitHub repository secrets
- `LOKALISE_PROJECT_ID` — set in GitHub repository secrets

### Caching

Middleware applies cache headers after page execution:

- Products/collections: `s-maxage=300` (5 min)
- CMS pages: `s-maxage=3600` (1 hour)
- Authenticated/cookie responses: `private, no-store`

## E2E Testing Conventions

- **CI uses `astro build` + `astro preview`** with `@astrojs/node` adapter (via `E2E_BUILD=1`). Local dev uses `astro dev`. Preview mode serves pre-built pages instantly but behaves differently from dev mode (no Vite proxy, no HMR, middleware redirects are internal rewrites).
- Mock API server runs on port 4322, Astro preview/dev on 4321
- Per-test cart isolation via `x-test-cart-id` header (set by `resetMockApi()`)
- Use `.first()` on `[data-product-id]` locators — products appear in multiple category sections
- Cart trigger button uses `data-cart-trigger` attribute (on both `CartBadge` and `CartBar`)
- Hydration wait: `waitForHydration()` checks `window.__MERCHANT__`, falls back to `networkidle`, then auto-dismisses the comms modal
- Block analytics in tests via `blockAnalytics()`
- **Island hydration timing.** When waiting for `client:idle` islands, allow at least 2.5s on CI. Hydration is faster in dev mode (HMR) than preview mode (pre-bundled JS cold load).
- **Viewport-specific elements.** `CartBadge` is desktop-only (`hidden md:inline-flex`), `CartBar` is mobile-only (`md:hidden`). Use `locator('visible=true').first()` when targeting elements that exist in both viewports.

## Environment Variables

| Variable              | Purpose                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `API_BASE_URL`        | Server-side API base                                                            |
| `PUBLIC_API_BASE_URL` | Client-side API base (browser)                                                  |
| `DEFAULT_MERCHANT`    | Fallback merchant slug                                                          |
| `CUSTOM_DOMAINS`      | JSON map: custom domain → merchant slug                                         |
| `PLATFORM_SUFFIXES`   | Comma-separated platform domain suffixes (fallback: `.poweredbysous.localhost`) |
| `PUBLIC_POSTHOG_KEY`  | PostHog analytics key                                                           |
| `AUTH_COOKIE_DOMAIN`  | Auth cookie domain                                                              |

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
- **Checkout delivery PATCH is opt-in partial update.** The backend's `set_delivery()` guards each field with `if field is not None` — only fields present in the request body get updated. The backend auto-resolves `shipping_method_id` from `fulfillment_type`, so the frontend only needs to send `fulfillment_type` (not the shipping method). However, other fields like `email`, `shipping_address`, etc. are still silently skipped if omitted.
- **`eslint-disable` blocks must have justification on both open and close.** Every `eslint-disable` comment needs a `--` reason. Every `eslint-enable` must also include a justification explaining what workaround is ending (e.g. `/* eslint-enable @typescript-eslint/no-explicit-any -- end confirm-payment SDK workaround */`). Bare `eslint-enable` without context is not allowed.
- **Never `as any` SDK paths.** The SDK types ARE the API contract. If TypeScript rejects a path literal, the path is wrong or the SDK needs updating — don't cast it away. See "API Contract & Type Safety" above.
- **Mock API drift.** The hand-maintained `e2e/helpers/mock-api.ts` can silently diverge from the real backend. Always run `npx playwright test e2e/contract.spec.ts` after modifying mock endpoints.

## Agent Bus

See sous-bus://instructions for cross-repo coordination protocol.
