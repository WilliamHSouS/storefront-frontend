# Architecture Review: Checkout Flow Design (Round 1)

**Date:** 2026-03-18
**Reviewer:** Code Review Expert (AI-assisted)
**Document reviewed:** `docs/plans/2026-03-17-checkout-flow-design.md` (post-debate revision)
**Codebase grounding:** `src/stores/cart.ts`, `src/stores/cart-actions.ts`, `src/stores/address.ts`, `src/stores/merchant.ts`, `src/stores/ui.ts`, `src/lib/api.ts`, `src/lib/sdk-stub.ts`, `src/middleware.ts`, `src/layouts/BaseLayout.astro`, `src/components/interactive/CartDrawer.tsx`, `e2e/helpers/test-utils.ts`, `e2e/helpers/mock-api.ts`, `vercel.json`, `package.json`

---

## 1. Architecture & Maintainability

### R1 -- `ensureCart()` on checkout page uses server SDK but design calls client-side `getClient()`

**Severity:** Major
**Section:** 4 (API Flow), step 1

The design says: "await ensureCart() (do NOT assume $cart is populated)". The existing `ensureCart()` in `src/stores/cart.ts` (line 183) requires a `StorefrontClient` parameter: `ensureCart(client: StorefrontClient)`. On Preact islands, this means calling `getClient()` first.

However, the checkout page is a `client:load` island. The `getClient()` singleton in `src/lib/api.ts` depends on `$merchant.get()` being non-null (line 19-20), which is populated from `window.__MERCHANT__`. If the `CheckoutPage` island's mount callback fires before the `define:vars` script in `BaseLayout.astro` executes (a timing race documented in `src/stores/merchant.ts` lines 20-26), `getClient()` throws.

The existing `CartDrawer` avoids this because it uses `client:idle`, not `client:load`. The checkout island uses `client:load`, which is more aggressive.

**Recommendation:** Document that `CheckoutPage` must guard `ensureCart()` behind a `$merchant` subscription check, or use the same `DOMContentLoaded` safety net from `merchant.ts`. Alternatively, the `checkout.astro` page could pass the cart data as a prop from SSR (fetched via `Astro.locals.sdk`) and only use the client SDK for mutations, avoiding the race entirely.

---

### R2 -- PATCH queue `delay()` function is not defined

**Severity:** Minor
**Section:** 2 (PATCH Queue)

The PATCH queue pseudocode calls `await delay(500)` (line 102 of design doc) but `delay` is not an existing utility in the codebase. The cart store uses `setTimeout` patterns (e.g., `CartDrawer.tsx` line 258 for promotion check debounce).

**Recommendation:** Either define the `delay` helper in `src/lib/checkout.ts` (a simple `(ms: number) => new Promise(r => setTimeout(r, ms))`) or note in the design that this is pseudocode. The implementer should follow the `setTimeout` + `clearTimeout` pattern used in `CartDrawer` for the promotion eligibility check, which is cancellable and doesn't rely on promise-based delay.

---

### R3 -- `$checkout` store actions split across two files without clear ownership

**Severity:** Major
**Section:** 2 (Architecture), 13 (Files to Create)

The design specifies:
- `src/stores/checkout.ts` -- "Checkout nanostore + derived atoms + actions"
- `src/lib/checkout.ts` -- "Checkout API helpers, PATCH queue, ensurePaymentAndComplete"

The existing codebase has a clear pattern: `src/stores/cart.ts` holds atoms + derived state + low-level operations (`ensureCart`, `backgroundRefreshShipping`), while `src/stores/cart-actions.ts` holds mutation functions (`updateCartItemQuantity`, `applyDiscountCode`). There is no `src/lib/cart.ts`.

Having checkout actions in `src/lib/checkout.ts` instead of `src/stores/checkout-actions.ts` breaks this convention. Additionally, `ensurePaymentAndComplete()` mutates `$checkout` state and triggers redirects -- this is clearly store-action-level code, not a "lib" utility.

**Recommendation:** Follow the existing pattern:
- `src/stores/checkout.ts` -- atoms, computed stores, types, low-level helpers (checkout ID persistence, validation)
- `src/stores/checkout-actions.ts` -- all mutation functions (createCheckout, patchDelivery, initiatePayment, ensurePaymentAndComplete)

This keeps the separation consistent with `cart.ts` / `cart-actions.ts`.

---

### R4 -- Cart fingerprint comparison uses undefined fields

**Severity:** Major
**Section:** 4 (API Flow), step 1

The design says: "Compare cart fingerprint (item IDs + quantities + total) with checkout". The existing `CartDrawer` (line 241-242) computes a fingerprint as:
```typescript
cart?.line_items.map((li) => `${li.product_id}:${li.quantity}`).join(',')
```

But the checkout object returned by the backend is a different shape from the cart. The design does not define the `Checkout` type at all -- it references `checkout.subtotal`, `checkout.shipping_cost`, `checkout.tax_total`, etc. in the computed stores but never specifies how checkout line items map to cart line items. Specifically:
- Does the checkout object have a `line_items` array?
- Do checkout line items use the same `product_id` field name as cart line items?
- Is `checkout.total` comparable to `cart.cart_total`?

Without this, the fingerprint comparison cannot be implemented.

**Recommendation:** Add a `Checkout` TypeScript interface to the design (Section 2), analogous to the `Cart` interface in `src/stores/cart.ts`. At minimum, define the fields used by `$checkoutTotals` and the fingerprint comparison. This is the most important missing type in the document.

---

### R5 -- `hideSharedIslands` prop exists but design does not use it

**Severity:** Minor
**Section:** 2 (Component Tree)

`BaseLayout.astro` (line 25) accepts `hideSharedIslands` which suppresses `CartDrawer`, `ProductDetail`, and `SearchBar`. The checkout page should almost certainly set `hideSharedIslands={true}` -- having the cart drawer and product detail modal available on the checkout page is confusing UX and adds unnecessary JS.

However, the `CartBar` (mobile bottom bar, line 181) is NOT gated by `hideSharedIslands` and renders on every page. On the checkout page, this would overlap with the sticky "Place Order" button which also uses `md:hidden`.

**Recommendation:** The `checkout.astro` page should pass `hideSharedIslands={true}` to `BaseLayout`. Additionally, either: (a) extend `hideSharedIslands` to also suppress `CartBar`, or (b) add a separate `hideCartBar` prop, or (c) have the `CartBar` component check if the current path is `/checkout` and self-suppress.

---

### R6 -- No `Checkout` type definition anywhere in the design

**Severity:** Critical
**Section:** 2 (Architecture)

The design references a `Checkout` type in `$checkout = atom<Checkout | null>(null)` (Section 2, line 55) but never defines it. The computed stores reference `c?.subtotal`, `c?.shipping_cost`, `c?.tax_total`, `c?.discount_amount`, `c?.total`, `c?.status` -- these are the only fields we can infer. But implementers also need:
- Line items structure (for order summary rendering)
- Fulfillment method / type field
- Selected shipping rate
- Reserved slot reference
- Customer contact fields (or are those only in the PATCH request, not the response?)
- Checkout ID field name

This is the single largest ambiguity in the document. Every component in the tree depends on this type.

**Recommendation:** Add a complete `Checkout` interface to Section 2, either based on the backend API schema or as a normalized frontend type (following the `normalizeProduct` / `normalizeCart` pattern). Include a `normalizeCheckout()` function if the backend response shape differs from the frontend type.

---

### R7 -- Express checkout creates checkout + patches + pays in sequence without error recovery

**Severity:** Major
**Section:** 5 (Stripe Integration, Express Checkout)

The express checkout flow (lines 375-378) says:
1. `POST /checkout/` (create)
2. `PATCH /delivery/` (set address from payment method)
3. `POST /payment/` (initiate payment)
4. Confirm and `/complete/`

This is a 4-step sequential chain triggered from a single Apple Pay/Google Pay tap. If step 2 fails (e.g., delivery not available at the Apple Pay address), the user has already authenticated with Face ID / fingerprint. The design does not describe:
- How to cancel the Payment Request if delivery PATCH fails
- What error UI shows inside the Apple Pay / Google Pay sheet
- Whether the checkout should be rolled back or abandoned

**Recommendation:** Add error handling for each step in the express checkout sequence. Specifically:
- If `PATCH /delivery/` returns delivery-unavailable, call `ev.complete('fail')` on the payment request event to cancel the Apple Pay/Google Pay sheet and show an inline error explaining why.
- If `POST /payment/` fails, same approach.
- Document that express checkout is only available when the merchant supports delivery (since Apple Pay provides a shipping address but not a pickup location selection).

---

### R8 -- `$addressCoords` has postal code and coordinates but design needs full street address

**Severity:** Minor
**Section:** 6 (Fulfillment & Scheduling)

The design says: "If `$addressCoords` exists (user entered postcode on menu page), pre-populate the address form." But `$addressCoords` (from `src/stores/address.ts` and `src/types/address.ts`) only stores `postalCode`, `country`, `latitude`, and `longitude` -- not street, city, or house number.

The checkout delivery form requires street, city, and postal code. Only postal code can be pre-populated from `$addressCoords`.

**Recommendation:** Clarify that "pre-populate" means filling postal code only and using the coordinates to evaluate delivery eligibility immediately (which is the correct behavior). The street and city fields remain empty. Optionally, mention that a geocoding reverse-lookup to pre-fill city from coordinates could be a future enhancement.

---

## 2. Security

### R9 -- CSP `style-src 'unsafe-inline'` undermines XSS protection

**Severity:** Major
**Section:** 9 (Security, CSP)

The proposed CSP includes `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`. While `'unsafe-inline'` for styles is less dangerous than for scripts, it allows CSS injection attacks that can exfiltrate data via `background-image: url(...)` selectors targeting input values. On a payment page, this is a meaningful risk.

The `'unsafe-inline'` is likely needed because:
1. `BaseLayout.astro` uses `<style set:html={...}>` for theme CSS (line 98)
2. `CartFooter` uses inline `style` props (line 127, 449)
3. Stripe Elements inject inline styles

**Recommendation:** Use nonce-based CSP for inline styles as well (`'nonce-{random}'`), or accept the risk and document why: Stripe Elements require `'unsafe-inline'` for styles (this is documented in Stripe's CSP guide). If accepting, add a comment in the CSP header explaining the Stripe constraint. Do NOT extend this acceptance to `script-src` -- the nonce approach for scripts is correct.

---

### R10 -- CSP `connect-src` missing PostHog and WebSocket endpoints

**Severity:** Major
**Section:** 9 (Security, CSP)

The proposed `connect-src` is `'self' https://api.stripe.com {API_BASE_URL}`. But `BaseLayout.astro` loads PostHog analytics on every page (lines 209-222), which makes `fetch` calls to PostHog's API. If the CSP is enforced without PostHog's domain in `connect-src`, analytics will silently fail on checkout pages.

Additionally, if Astro dev mode uses WebSocket for HMR, `ws://localhost:*` would be needed in development. The design says "Start with Content-Security-Policy-Report-Only" which mitigates this, but the final enforced policy needs to be complete.

**Recommendation:** Add PostHog's ingest domain to `connect-src`:
```
connect-src 'self' https://api.stripe.com {API_BASE_URL} https://*.posthog.com;
```
Or, if PostHog should be disabled on checkout pages (mentioned as an option in Section 9), document that the analytics `boot()` script in `BaseLayout.astro` needs a path check to skip initialization on `/checkout` routes.

---

### R11 -- HMAC resolution deferred but design proceeds as if resolved

**Severity:** Major
**Section:** Backend Requirements (item 4), Section 9

The design states the HMAC issue as a backend requirement to resolve: "Either (a) backend does not enforce HMAC, or (b) implement alternative CSRF mechanism." But the rest of the design (PATCH queue, payment flow, express checkout) proceeds as if client-side API calls work. The `getClient()` function in `src/lib/api.ts` (line 27) reads `merchant.hmacSecret` -- which is `undefined` on the client because `BaseLayout.astro` strips it (line 32).

Looking at `sdk-stub.ts` (line 131), when `hmacSecret` is undefined, the signing fetch wrapper is skipped entirely. So client-side requests are already unsigned. If the backend enforces HMAC, **all existing client-side cart mutations are also broken** (add to cart, update quantity, etc.) -- not just checkout.

**Recommendation:** This is likely already working in production with unsigned client requests (cart mutations work from CartDrawer). The design should state definitively: "Client-side requests are unsigned. The backend does not enforce HMAC on storefront API endpoints. CSRF protection relies on SameSite cookies and Origin header validation." Remove the ambiguity -- this is a factual question about current backend behavior, not a design decision.

---

### R12 -- Success page `checkout_id` in URL enables enumeration

**Severity:** Minor
**Section:** 5 (Success Page)

The success page URL is `/{lang}/checkout/success?checkout_id={id}`. If checkout IDs are sequential integers (common in Django), an attacker could enumerate completed orders by iterating IDs. The `ensurePaymentAndComplete()` function fetches the checkout and potentially returns order details.

**Recommendation:** Verify that checkout IDs are UUIDs (not sequential). If they are sequential, the `GET /checkout/{id}/` endpoint must enforce authorization (e.g., session cookie, cart-id correlation, or a separate signed token). Alternatively, add a `signature` query parameter to the success URL that the backend validates.

---

### R13 -- `no-store` cache headers not applied to checkout API responses

**Severity:** Minor
**Section:** 9 (Security), `src/middleware.ts`

The design says middleware should add `private, no-store, no-cache, must-revalidate` for `/checkout` routes (Section 13, Modified Files). The current middleware (line 107-119) only applies cache headers to `CACHEABLE_PATTERNS`, and `/checkout` does not match any pattern, so it gets **no Cache-Control header at all**.

No `Cache-Control` is not the same as `no-store`. Without an explicit `no-store`, CDN edge caches (Vercel's edge network) and browser caches may cache the HTML response. For a page that will contain PII in pre-filled form fields (via sessionStorage restoration), this is a gap.

**Recommendation:** Add an explicit block to middleware for checkout routes:
```typescript
if (url.pathname.match(/^\/[a-z]{2}\/checkout/)) {
  response.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
}
```
This should run before the `isCacheable` block, not as an else-if.

---

## 3. Performance

### R14 -- Bundle budget at 62-65 KB is at the wall, not safely under it

**Severity:** Critical
**Section:** 12 (Bundle Impact)

The design estimates "Current budget usage is ~45 KB" with checkout adding ~17-20 KB, landing at 62-65 KB against a hard limit of 65 KB. The `size-limit` config in `package.json` enforces this:
```json
{ "path": "dist/client/**/*.js", "limit": "65 KB", "gzip": true }
```

This is dangerously tight. The estimates are likely optimistic:

1. **`libphonenumber-js` is estimated at ~3 KB** but the commonly used `libphonenumber-js/min` is ~37 KB gzipped for the full library. Even the `/mobile` build is ~7 KB. The "~3 KB" figure may be the metadata-only build which cannot validate phone numbers against country patterns (only parses). If the design requires "validated with `libphonenumber-js` against merchant country" (Section 8), the minimum viable import is larger.

2. **CheckoutPage at 12-15 KB** includes 13 sub-components with form logic, validation, debounce persistence, fulfillment toggle, scheduling picker (7-day date strip + time slot radio groups), shipping rate selector, and order summary with collapsible line items. For comparison, `CartDrawer.tsx` alone is ~14 KB of source (455 lines) and it has fewer interactive elements.

3. **The estimate does not account for Preact's `lazy()` overhead** or the dynamic import wrapper for `StripePaymentForm`. While small, it adds up.

4. **`@stripe/stripe-js` loader** (`loadStripe`) is listed as external, but the `loadStripe` function itself (the npm package that injects the script tag) is ~2 KB gzipped and would be bundled.

**Recommendation:** Before implementation begins, run an experiment: create a minimal `CheckoutPage.tsx` with the form skeleton (no logic, just the JSX structure for all 13 components) and measure the actual gzipped output with `pnpm size:check`. If the skeleton alone exceeds 10 KB, the 65 KB budget is not achievable without one of:
- Raising the budget to 75 KB (requires team agreement)
- Code-splitting the checkout to a separate entry point that is not measured against the global budget (checkout-only JS)
- Using `client:only="preact"` instead of `client:load` and measuring checkout pages separately

The `libphonenumber-js` size needs a specific import path documented (e.g., `libphonenumber-js/mobile` or a custom metadata build).

---

### R15 -- API call waterfall in step 3 has three sequential requests that could be parallelized

**Severity:** Major
**Section:** 4 (API Flow), step 3

After delivery is complete, the design fires:
1. `GET /checkout/{id}/shipping/` -- shipping rates
2. `GET /checkout/{id}/payment-gateways/` -- Stripe config
3. `POST /checkout/{id}/payment/` -- create PaymentIntent

Requests 1 and 2 are independent reads and should be parallelized. Request 3 depends on 2 (needs gateway ID). Additionally, request 2 could be fired earlier -- payment gateway config does not depend on the delivery address.

The slot fetch (`GET /fulfillment/locations/{id}/slots/`) is also independent and can run in parallel with 1 and 2.

**Recommendation:** Restructure step 3:
```
After delivery section complete:
  Promise.all([
    GET /checkout/{id}/shipping/,
    GET /checkout/{id}/payment-gateways/,  // if not already fetched
    GET /fulfillment/locations/{id}/slots/,  // if pickup + scheduled
  ])
  Then: POST /checkout/{id}/payment/ (needs gateway_id from payment-gateways)
```
This saves 200-400ms on typical API latency, which matters for perceived checkout speed.

---

### R16 -- Stripe.js loaded on page mount even when user may bounce

**Severity:** Minor
**Section:** 5 (Stripe Integration)

The design says "Lazy-load Stripe on page mount (doesn't block rendering)" via `loadStripe()`. While it does not block rendering, it triggers a ~40 KB external script download from `js.stripe.com` immediately. For users who land on checkout, see the total, and hit "Back to cart" (a significant percentage), this is wasted bandwidth and a wasted TLS handshake.

**Recommendation:** Defer `loadStripe()` until the checkout object is created (step 2 -- first form section complete). At that point, the user has demonstrated purchase intent. The `stripePromise` can still be awaited later when mounting the Payment Element. The design already defers checkout creation for the same reason ("prevents wasted backend resources from accidental visits") -- apply the same logic to Stripe.js loading.

---

### R17 -- `sessionStorage` persistence on every keystroke is excessive

**Severity:** Minor
**Section:** 2 (Architecture)

The design says form state is "debounce-persisted to `sessionStorage` every 500ms on change". If `useReducer` fires on every keystroke (as it would with controlled inputs), this means serializing the entire form state to JSON and writing to `sessionStorage` every 500ms during active typing. For a form with 8+ fields, this is frequent serialization on the main thread.

**Recommendation:** Persist on blur (field exit) rather than on a debounced timer. This matches the PATCH timing (PATCHes fire on section completion / blur) and reduces `sessionStorage` writes from ~2/second during typing to ~1 per field. The risk of data loss between keystrokes within a single field is negligible (the user would need to crash mid-word in a single field).

---

## 4. Test Coverage

### R18 -- No E2E test for the PATCH queue race condition

**Severity:** Major
**Section:** 11 (E2E Testing)

The PATCH queue (debounce + AbortController + generation counter) is one of the most complex pieces of client-side logic in the checkout. The E2E test scenarios do not include:
- Rapid fulfillment method toggles (delivery -> pickup -> delivery)
- Address field changes while a PATCH is in-flight
- Slot selection immediately after fulfillment toggle

These are the exact scenarios the PATCH queue is designed to handle. Without tests, regressions here produce silent data corruption (checkout has wrong fulfillment method).

**Recommendation:** Add test scenarios:
```
e2e/checkout.spec.ts
  + rapid fulfillment toggle does not corrupt checkout state
  + address change during in-flight PATCH uses latest values
```
The mock API can add a configurable delay (`POST /test/set-delay`) to make PATCHes take 1-2 seconds, then the test rapidly fires two changes and verifies the final state.

---

### R19 -- Stripe mock strategy via `page.addInitScript()` may not intercept module imports

**Severity:** Major
**Section:** 11 (Stripe Mocking)

The design says: "The `loadStripe` import is intercepted via `page.addInitScript()` to return a mock Stripe instance."

`page.addInitScript()` runs before page scripts, but `loadStripe` is imported as an ES module (`import { loadStripe } from '@stripe/stripe-js'`). In a production build (which E2E tests use via `E2E_BUILD=1`), this import is bundled into the chunk at build time. `addInitScript` cannot intercept an already-bundled ES module import -- it can only set globals.

The typical Playwright approach for Stripe is:
1. `page.route('https://js.stripe.com/**', ...)` to intercept the external script load
2. Return a mock script that sets `window.Stripe` to a mock constructor
3. The `loadStripe` wrapper from `@stripe/stripe-js` detects `window.Stripe` and uses it

**Recommendation:** Replace the `addInitScript` approach with `page.route()` interception of `js.stripe.com`. This is the standard Playwright pattern for mocking externally-loaded payment SDKs and works reliably with bundled code. Document the mock Stripe object shape (at minimum: `elements()`, `confirmPayment()`, `retrievePaymentIntent()`, `paymentRequest()`).

---

### R20 -- No test for checkout ID validation / injection

**Severity:** Minor
**Section:** 11 (E2E Testing)

The design specifies `CART_ID_PATTERN` validation on checkout IDs from `sessionStorage` and URL parameters (Section 2). This is a security control preventing path traversal. But there is no E2E test verifying:
- Invalid checkout IDs in `sessionStorage` are rejected
- Invalid `checkout_id` URL params on the success page are rejected
- The `validateStorageId()` utility works correctly

**Recommendation:** Add to `e2e/checkout-security.spec.ts`:
```
+ rejects invalid checkout_id in URL (path traversal attempt)
+ rejects invalid checkout_id from sessionStorage
```
These can use `page.evaluate()` to inject a malicious value into `sessionStorage` before navigation.

---

### R21 -- No unit test plan for `src/stores/checkout.ts` or `src/stores/checkout-actions.ts`

**Severity:** Major
**Section:** 11 (E2E Testing), 13 (Files to Create)

The design lists E2E tests but no unit tests. The existing codebase has extensive unit tests:
- `src/stores/cart.test.ts`
- `src/stores/cart-actions.test.ts`
- `src/stores/address.test.ts`
- `src/stores/address-actions.test.ts`
- `src/stores/comms.test.ts`
- `src/stores/toast.test.ts`

The checkout store and actions are at least as complex as the cart store. The PATCH queue, generation counter, `ensurePaymentAndComplete`, cart fingerprint comparison, and session storage persistence all need unit tests with mocked SDK clients (following the `client?: StorefrontClient` injection pattern in `cart-actions.ts`).

**Recommendation:** Add to Section 13 (New Files):
```
src/stores/checkout.test.ts       -- atom derivations, checkout ID persistence, validation
src/stores/checkout-actions.test.ts -- PATCH queue, createCheckout, ensurePaymentAndComplete
src/lib/validate-id.test.ts       -- shared ID validation utility
```

---

### R22 -- E2E test for cross-tab cart change detection is unreliable in Playwright

**Severity:** Minor
**Section:** 11 (E2E Testing)

The test scenario "cart change detection across tabs" requires listening for `storage` events on `localStorage`. Playwright's `BrowserContext` shares storage across pages, but `storage` events only fire on **other** tabs, not the tab that made the change. Testing this requires:
1. Opening two pages in the same context
2. Modifying cart in page 2
3. Verifying the banner appears in page 1

This is a valid Playwright pattern but is notoriously flaky due to timing. The `storage` event is asynchronous and may not fire before the assertion.

**Recommendation:** Document the two-page approach explicitly in the test scenario. Use `page1.waitForSelector('[data-cart-changed-banner]')` with a generous timeout rather than a timing-based assertion. Consider whether this test should be marked as `test.slow()` or skipped in CI if it proves flaky.

---

### R23 -- Missing E2E scenario for delivery ineligibility auto-switch to pickup

**Severity:** Minor
**Section:** 11 (E2E Testing)

Section 6 describes: "If the delivery PATCH returns an ineligibility error after the user enters their full address, switch to pickup automatically with a clear inline message." This is a key user-facing behavior with non-trivial logic (automatic fulfillment toggle + message display). No E2E test covers it.

**Recommendation:** Add:
```
e2e/checkout.spec.ts
  + auto-switches to pickup when delivery is unavailable at entered address
```
The mock API should return a delivery-ineligible error for a specific postal code (e.g., `00000`).

---

## Summary Table

| ID | Severity | Area | Section | Issue |
|----|----------|------|---------|-------|
| R1 | Major | Architecture | 4 | `ensureCart()` + `getClient()` race with `client:load` hydration timing |
| R2 | Minor | Architecture | 2 | `delay()` not defined in codebase |
| R3 | Major | Architecture | 2, 13 | Checkout actions in `src/lib/` breaks `stores/` convention |
| R4 | Major | Architecture | 4 | Cart-checkout fingerprint comparison undefined without `Checkout` type |
| R5 | Minor | Architecture | 2 | `hideSharedIslands` not used; `CartBar` overlaps sticky CTA |
| R6 | Critical | Architecture | 2 | No `Checkout` TypeScript interface defined |
| R7 | Major | Architecture | 5 | Express checkout error recovery undefined for multi-step sequence |
| R8 | Minor | Architecture | 6 | `$addressCoords` only has postal code, not full address for pre-fill |
| R9 | Major | Security | 9 | `style-src 'unsafe-inline'` weakens CSP on payment page |
| R10 | Major | Security | 9 | CSP `connect-src` missing PostHog domain |
| R11 | Major | Security | BR#4, 9 | HMAC resolution deferred but likely already resolved by current behavior |
| R12 | Minor | Security | 5 | Checkout ID in URL may enable enumeration if sequential |
| R13 | Minor | Security | 9 | Checkout routes get no `Cache-Control` header (not same as `no-store`) |
| R14 | Critical | Performance | 12 | Bundle budget at 62-65 KB is not achievable with stated dependencies |
| R15 | Major | Performance | 4 | Three sequential API calls in step 3 should be parallelized |
| R16 | Minor | Performance | 5 | Stripe.js loaded on mount; defer to checkout creation |
| R17 | Minor | Performance | 2 | `sessionStorage` persistence on debounced timer; prefer blur |
| R18 | Major | Testing | 11 | No E2E test for PATCH queue race condition |
| R19 | Major | Testing | 11 | `addInitScript` Stripe mock will not work with bundled ES modules |
| R20 | Minor | Testing | 11 | No test for checkout ID validation / path traversal prevention |
| R21 | Major | Testing | 11, 13 | No unit tests planned for checkout stores/actions |
| R22 | Minor | Testing | 11 | Cross-tab cart detection test needs explicit two-page approach |
| R23 | Minor | Testing | 11 | Missing E2E for delivery-ineligible auto-switch to pickup |

### Severity Distribution

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Major | 11 |
| Minor | 10 |

---

## Overall Assessment: PASS WITH CONDITIONS

The design is thorough and well-considered. The debate process clearly improved it -- the revised document addresses the original 8 critical issues effectively. The architecture (single island, deferred checkout creation, PATCH queue, webhook-first completion) is sound and follows the codebase conventions in most areas.

**Conditions for implementation to proceed:**

1. **R6 (Critical):** Define the `Checkout` TypeScript interface. Without this, no component can be implemented. This blocks all work.

2. **R14 (Critical):** Validate the bundle budget with a skeleton build before committing to the 65 KB limit. If `libphonenumber-js` alone is 7 KB instead of 3 KB, the budget is blown. Determine the exact import path and measure. Have a fallback plan (raise budget or code-split).

3. **R19 (Major):** Fix the Stripe mocking strategy before writing E2E tests. The `addInitScript` approach will not work and discovering this late will require rewriting all payment tests.

The remaining Major issues (R1, R3, R4, R7, R9, R10, R11, R15, R18, R21) should be addressed in the design revision but will not block a determined implementer who reads the codebase carefully. The Minor issues can be resolved during implementation.
