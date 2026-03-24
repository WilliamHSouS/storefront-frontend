# Architecture Review: Checkout Flow Design (Round 2)

**Date:** 2026-03-18
**Reviewer:** Code Review Expert (AI-assisted)
**Document reviewed:** `docs/plans/2026-03-17-checkout-flow-design.md` (post-Round 1 revision)
**Round 1 review:** `docs/plans/debates/2026-03-18-checkout-design/review-round-1.md`
**Codebase grounding:** `src/stores/cart.ts`, `src/stores/cart-actions.ts`, `src/stores/address.ts`, `src/stores/merchant.ts`, `src/lib/api.ts`, `src/lib/sdk-stub.ts`, `src/middleware.ts`, `src/layouts/BaseLayout.astro`, `src/components/interactive/CartBar.tsx`, `src/types/merchant.ts`, `src/types/address.ts`, `vercel.json`, `package.json`

---

## Round 1 Fix Verification (R1-R23)

| ID | Severity | Fix Status | Notes |
|----|----------|------------|-------|
| R1 | Major | FIXED | Section 2 (Component Tree, "Hydration safety") now explicitly documents the `$merchant.subscribe()` guard and SSR-prop alternative. Accurately references the `merchant.ts` DOMContentLoaded safety net. |
| R2 | Minor | FIXED | PATCH queue pseudocode (Section 2) now uses `setTimeout` + `clearTimeout` pattern and cites the CartDrawer promotion check as precedent. No more undefined `delay()`. |
| R3 | Major | FIXED | Section 2 PATCH queue header says "Lives in `src/stores/checkout-actions.ts` (following `cart.ts` / `cart-actions.ts` convention)". Section 13 file listing is consistent: `checkout.ts` for atoms/derived, `checkout-actions.ts` for mutations. |
| R4 | Major | FIXED | Section 2 now includes explicit `checkoutFingerprint()` and `cartFingerprint()` functions using `product_id:quantity` pairs. Both use `.sort()` for order independence. |
| R5 | Minor | FIXED | Section 2 (Component Tree) now says `checkout.astro` passes `hideSharedIslands={true}` and documents that CartBar must self-suppress on `/checkout` via path check. Section 13 lists `CartBar.tsx` as a modified file. |
| R6 | Critical | FIXED | Section 2 adds a complete `Checkout` TypeScript interface (lines 76-148) derived from backend `SerializedCheckoutDict`, with `CheckoutLineItem`, `CheckoutAddress`, `CheckoutStatus`, and `PaymentResult`. Section 13 lists `src/types/checkout.ts`. |
| R7 | Major | FIXED | Section 5 (Express Checkout) now documents per-step error handling: `ev.complete('fail')` on delivery PATCH failure, inline error messages, and express-only-for-delivery-merchants note. |
| R8 | Minor | FIXED | Section 6 now explicitly says "pre-populate the **postal code field only**" and notes coordinates are used for delivery eligibility evaluation, not full address pre-fill. |
| R9 | Major | FIXED | Section 9 CSP now includes a comment explaining `'unsafe-inline'` is required by Stripe Elements per Stripe's CSP guide, and explicitly states it does NOT extend to `script-src`. |
| R10 | Major | FIXED | Section 9 CSP `connect-src` now includes `https://*.posthog.com`. PostHog section discusses masking and optional disabling on checkout. |
| R11 | Major | FIXED | Backend Requirement #4 now definitively states: "Client-side write requests are unsigned... The backend does not enforce HMAC on storefront API endpoints. CSRF protection relies on `SameSite=Lax` cookies." Correctly references `sdk-stub.ts` skip behavior. |
| R12 | Minor | FIXED | Section 9 (Success Page URL Hygiene) confirms checkout IDs are UUIDv4 from backend model `id = models.UUIDField(primary_key=True, default=uuid.uuid4)`. Not enumerable. |
| R13 | Minor | FIXED | Section 13 (Modified Files, `src/middleware.ts`) specifies explicit `Cache-Control: private, no-store, no-cache, must-revalidate` for checkout routes with the exact regex pattern. Notes it must run BEFORE the `isCacheable` block. |
| R14 | Critical | FIXED | Section 12 now acknowledges the budget is exceeded (~68-72 KB) and includes a mitigation strategy with four ranked options. `libphonenumber-js/mobile` corrected to ~7 KB. Includes the skeleton-build validation step before implementation. |
| R15 | Major | FIXED | Section 4, step 3 now shows `Promise.all([shipping, payment-gateways, slots])` followed by sequential `POST /payment/`. Matches the recommended parallel fetch structure exactly. |
| R16 | Minor | FIXED | Section 4, step 1 explicitly says "Do NOT load Stripe.js yet (deferred to checkout creation)". Section 5 code comments reinforce: "Load Stripe when checkout is created (not on page mount)". |
| R17 | Minor | FIXED | Section 2 now says "persisted to `sessionStorage` on field blur (not on every keystroke -- avoids excessive serialization on the main thread)". |
| R18 | Major | FIXED | Section 11 E2E scenarios now include "rapid fulfillment toggle does not corrupt checkout state (PATCH queue test)" and "address change during in-flight PATCH uses latest values". |
| R19 | Major | FIXED | Section 11 (Stripe Mocking) now describes `page.route()` interception of `js.stripe.com/**`, explains why `addInitScript` fails with bundled imports, specifies mock object shape, and lists `e2e/helpers/stripe-mock.ts` as a new file. |
| R20 | Minor | FIXED | Section 11 E2E scenarios now include `e2e/checkout-security.spec.ts` with "rejects invalid checkout_id in URL" and "rejects invalid checkout_id from sessionStorage". |
| R21 | Major | FIXED | Section 11 now has a dedicated "Unit Tests" subsection with `checkout.test.ts`, `checkout-actions.test.ts`, and `validate-id.test.ts` with specific test case listings. |
| R22 | Minor | FIXED | Section 11 E2E scenario now says "cart change detection across tabs (two-page approach with waitForSelector)" -- referencing the recommended approach. |
| R23 | Minor | FIXED | Section 11 E2E scenario now includes "auto-switches to pickup when delivery is unavailable at entered address". |

**All 23 Round 1 issues are FIXED.**

---

## New Issues Introduced by Round 1 Fixes

### N1 -- Duplicate `$checkoutTotals` definitions use different fields

**ID:** N1
**Severity:** Major

The design document contains two definitions of `$checkoutTotals`. The first (Section 2, line ~60) uses raw amount fields:

```typescript
subtotal: c?.subtotal ?? '0.00',
shipping: c?.shipping_cost ?? '0.00',
```

The second (Section 2, line ~161) uses `display_*` fields:

```typescript
subtotal: c?.display_subtotal ?? '0.00',
shipping: c?.display_shipping_cost ?? '0.00',
```

The prose at line 158 says "The `$checkoutTotals` computed store uses these [display fields] for rendering" -- indicating the second definition is the intended one. But the first definition still appears earlier and would be the one an implementer encounters first.

The distinction matters: `display_*` fields are pre-formatted for the customer-facing currency (handling FX for multi-currency merchants), while the raw fields are in the base currency. Using the wrong one would show incorrect prices for merchants with currency conversion.

**Recommendation:** Remove the first `$checkoutTotals` definition entirely. Keep only the `display_*` version. If both base-currency and display-currency totals are needed, give them distinct names (e.g., `$checkoutTotals` for display, `$checkoutBaseTotals` for internal calculations like amount verification).

---

### N2 -- `product_id` type mismatch between `CartLineItem` and `CheckoutLineItem`

**ID:** N2
**Severity:** Major

The existing `CartLineItem` in `src/stores/cart.ts` (line 19) defines:
```typescript
product_id: number | string;
```

The new `CheckoutLineItem` in the design (Section 2, line 79) defines:
```typescript
product_id: number;
```

The fingerprint functions use `li.product_id` from both types and compare the resulting strings. If the cart has `product_id: "prod-1"` (string) and the checkout has `product_id: 42` (number), the fingerprints will never match, triggering a false "cart has changed" banner on every page load.

**Recommendation:** Either align `CheckoutLineItem.product_id` to `number | string` to match `CartLineItem`, or confirm with the backend team that the checkout serializer always returns numeric product IDs. If the types genuinely differ, the fingerprint functions need type coercion (e.g., `String(li.product_id)`).

---

### N3 -- CartBar self-suppression returns `null`, violating the island DOM stability gotcha

**ID:** N3
**Severity:** Major

The design (Section 2 and Section 13) says CartBar should "self-suppress when on `/checkout`". The current `CartBar.tsx` already returns `null` when `itemCount === 0` (line 49-51). However, the project's CLAUDE.md documents a critical gotcha:

> **Island DOM stability.** Preact islands mounted before `<slot/>` in BaseLayout must never return `null`. Always render a stable wrapper element to prevent Astro from re-evaluating sibling islands on state changes.

`CartBar` is mounted AFTER `<slot/>` in `BaseLayout.astro` (line 181), so the gotcha about "before `<slot/>`" may not apply to it. But the existing `CartBar` already returns `null` (line 49-51) without apparent issues, suggesting the constraint is specifically about pre-slot islands. This should be verified.

The safer approach is to render an empty wrapper `<div class="md:hidden" />` instead of `null` for the checkout suppression, consistent with the documented guidance.

**Recommendation:** Document that the CartBar checkout suppression should use an empty hidden wrapper (`<div class="fixed bottom-0 left-0 right-0 z-40 md:hidden" />`) rather than `null`, following the DOM stability principle. Note that this is a pre-existing pattern in CartBar (already returns `null` for empty carts) that has not caused issues because it is post-slot, but defensive coding is preferred on a payment page.

---

### N4 -- Timezone field referenced but missing from `MerchantConfig`

**ID:** N4
**Severity:** Major

Section 6 (Scheduling Picker) states: "API times converted to merchant's configured timezone (from `MerchantConfig`), not the user's browser timezone."

The `MerchantConfig` interface in `src/types/merchant.ts` has no timezone field. There is no `timezone`, `time_zone`, or `tz` field anywhere in the merchant type or the merchant JSON config files.

Without a timezone field, the frontend cannot convert API slot times. It would default to the browser's timezone, which is exactly what the design says to avoid (a Dutch merchant's 14:00 slot would display as 15:00 for a user in Berlin).

**Recommendation:** Either: (a) add `timezone: string` (IANA format, e.g., `"Europe/Amsterdam"`) to `MerchantConfig` and the merchant JSON files -- this is a backend requirement to include in the checkout serialization or a static config addition; or (b) have the slot API return times in UTC with a timezone identifier in the response, and let the frontend convert. Option (a) is simpler since it's a static config value. Add this to the Backend Requirements section.

---

### N5 -- `display_*` fields not used anywhere in existing codebase

**ID:** N5
**Severity:** Minor

The `Checkout` interface includes `display_subtotal`, `display_tax_total`, `display_shipping_cost`, `display_discount_amount`, `display_promotion_discount_amount`, and `display_total`. The `$checkoutTotals` computed store (corrected version) uses these for rendering.

A grep for `display_` across the entire `src/` directory returns zero matches. These fields are entirely new to the frontend. This is not inherently a problem -- the checkout is new functionality -- but it means:

1. There is no existing pattern for how to handle `display_*` fields (the cart store uses `formatPrice()` on raw amounts instead).
2. The `formatPrice()` utility in `src/lib/currency.ts` would be bypassed, creating two different price formatting paths in the codebase.

**Recommendation:** Clarify in the design whether `display_*` fields are pre-formatted strings (e.g., `"EUR 19,99"`) or raw decimal strings in the display currency (e.g., `"19.99"` in EUR). If pre-formatted, they can be rendered directly. If raw decimals, they still need `formatPrice()` and the distinction from the base fields is only the currency/amount, not the formatting. Document which it is so the implementer knows whether to call `formatPrice()` on these values.

---

### N6 -- `Referrer-Policy: no-referrer` on success page conflicts with global `strict-origin-when-cross-origin`

**ID:** N6
**Severity:** Minor

Section 9 specifies `Referrer-Policy: no-referrer` on the checkout success page. Section 13 says to add this in `vercel.json`. The current `vercel.json` sets `Referrer-Policy: strict-origin-when-cross-origin` globally on all routes (`source: "/(.*)"` at line 24).

Vercel applies headers in order and the most specific route wins for matching headers. Adding a second `headers` entry for the success page path should work:

```json
{
  "source": "/:lang/checkout/success",
  "headers": [{ "key": "Referrer-Policy", "value": "no-referrer" }]
}
```

However, Vercel's header merging behavior means the global `Referrer-Policy` and the page-specific one may both be sent, resulting in duplicate headers. The browser uses the most restrictive policy when multiple are present, so `no-referrer` would win -- but this should be tested.

**Recommendation:** Add a note that the Vercel header override should be tested in preview deployment to confirm the success page receives `no-referrer` and not the global value. This is a deployment-time verification, not a design change.

---

### N7 -- Payment gateway fetch timing is ambiguous across two sections

**ID:** N7
**Severity:** Minor

Section 4, step 1 says:
> "Fetch payment gateways -> GET /checkout/{id}/payment-gateways/ (or defer until checkout exists -- see step 2)"

Section 4, step 3 includes the same fetch in the `Promise.all`:
> `GET /api/v1/checkout/{id}/payment-gateways/`

Step 1 implies the fetch could happen on page load (if a checkout already exists from a previous session). Step 3 implies it happens after the delivery section is complete. Both are valid depending on whether a checkout exists, but the "(or defer)" phrasing in step 1 is ambiguous -- it's unclear when to choose which path.

**Recommendation:** Clarify step 1: "If restoring an existing checkout, fetch payment gateways immediately (the delivery address is already set). If creating a new checkout, defer payment gateway fetch to step 3." This removes the ambiguity by tying the decision to the checkout restoration vs. creation path.

---

### N8 -- Express checkout `totalInCents` requires conversion not documented

**ID:** N8
**Severity:** Minor

Section 5 (Express Checkout) shows:
```typescript
total: { label: merchant.name, amount: totalInCents },
```

Stripe's Payment Request API requires amounts in the smallest currency unit (cents for EUR, pennies for GBP). The `$cart` store has `cart_total` as a decimal string (e.g., `"33.18"`). The `Checkout` type has `total` as a decimal string. Neither is in cents.

The conversion (`parseFloat(total) * 100`) is straightforward but error-prone with floating point (e.g., `33.18 * 100 = 3317.9999...`). The design does not document a `toCents()` utility or specify the rounding strategy.

**Recommendation:** Add a note that a `toCents(decimalString: string): number` utility is needed (e.g., `Math.round(parseFloat(amount) * 100)` or using integer arithmetic on split decimal parts). This utility should be unit tested, especially for edge cases like `"0.10"` and `"19.99"`. Add it to `src/lib/currency.ts` alongside `formatPrice`.

---

### N9 -- `CheckoutLineItem.fulfillment_type` is a `string` but `AddressEligibility` uses a union type

**ID:** N9
**Severity:** Nit

`CheckoutLineItem.fulfillment_type` is typed as `string` with a comment `// "local_delivery" | "pickup" | "nationwide_delivery"`. The existing `AddressEligibility` in `src/types/address.ts` (line 9) uses a proper union type:
```typescript
availableFulfillmentTypes: ('local_delivery' | 'pickup' | 'nationwide_delivery')[];
```

**Recommendation:** Use the same union type for `CheckoutLineItem.fulfillment_type` for type safety. Extract it to a shared `FulfillmentType` alias in `src/types/checkout.ts` or `src/types/address.ts`.

---

### N10 -- `CheckoutStatus` type does not include all states needed by `ensurePaymentAndComplete`

**ID:** N10
**Severity:** Minor

The `CheckoutStatus` type is defined as:
```typescript
type CheckoutStatus = 'created' | 'delivery_set' | 'shipping_pending' | 'paid' | 'completed';
```

The `ensurePaymentAndComplete()` function (Section 5) checks `checkout.status === 'completed'`. But the function also handles `paymentIntent.status === 'processing'` -- does this correspond to a checkout status? If the webhook fires and sets the checkout to `'paid'` before the frontend calls `/complete/`, the function needs to handle that state too. The current switch statement only checks Stripe's `paymentIntent.status`, not the checkout's `status` field, after the initial `'completed'` check.

Additionally, the design mentions 409 Conflict responses (Section 8 error table) but does not describe what checkout status would cause a 409.

**Recommendation:** Add a brief state machine description: which checkout statuses allow which transitions, and which status values can the frontend expect to see at each point in the flow. This prevents the implementer from having to reverse-engineer the backend state machine.

---

### N11 -- CSP nonce generation mechanism not specified

**ID:** N11
**Severity:** Minor

Section 9 specifies `script-src 'self' https://js.stripe.com 'nonce-{random}'` and notes that inline scripts in `BaseLayout.astro` will use nonce-based CSP. But the design does not describe how the nonce is generated or injected.

In the current `BaseLayout.astro`, inline scripts use either `<script is:inline>` (which Astro does not process for nonces) or `<script>` (which Astro bundles). The `is:inline` scripts (PostHog stub at line 100, SSR banner dismissal at line 163, product modal handler at line 188) would need nonce attributes.

Astro does not have built-in CSP nonce support. The nonce would need to be generated in middleware, injected into `Astro.locals`, and applied to each `<script is:inline>` tag manually. This is a non-trivial implementation detail.

**Recommendation:** Add a brief note on the nonce strategy: (a) middleware generates a crypto-random nonce per request, (b) nonce is set on `Astro.locals.cspNonce`, (c) `BaseLayout.astro` applies `nonce={Astro.locals.cspNonce}` to all `is:inline` scripts, (d) middleware sets the CSP header using the same nonce. Alternatively, if the complexity is too high for launch, document that CSP enforcement is deferred and `Content-Security-Policy-Report-Only` is used indefinitely until nonce infrastructure is built.

---

## Summary Table

| ID | Severity | Area | Section | Issue |
|----|----------|------|---------|-------|
| N1 | Major | Architecture | 2 | Duplicate `$checkoutTotals` definitions use conflicting fields (raw vs. `display_*`) |
| N2 | Major | Architecture | 2 | `product_id` type mismatch: `number \| string` in cart vs. `number` in checkout breaks fingerprint |
| N3 | Major | Architecture | 2, 13 | CartBar `null` return on checkout may violate island DOM stability; use empty wrapper |
| N4 | Major | Architecture | 6 | Timezone field referenced in scheduling but absent from `MerchantConfig` |
| N5 | Minor | Architecture | 2 | `display_*` fields are novel to codebase; format semantics (pre-formatted vs. raw decimal) unclear |
| N6 | Minor | Security | 9 | `Referrer-Policy` override may produce duplicate headers in Vercel; needs deployment test |
| N7 | Minor | Architecture | 4 | Payment gateway fetch timing ambiguous between step 1 (restore) and step 3 (new) |
| N8 | Minor | Performance | 5 | `totalInCents` conversion not documented; floating point rounding risk |
| N9 | Nit | Types | 2 | `fulfillment_type` as `string` vs. existing union type in `AddressEligibility` |
| N10 | Minor | Architecture | 2, 5 | `CheckoutStatus` enum may be incomplete; no state machine documentation |
| N11 | Minor | Security | 9 | CSP nonce generation and injection mechanism not specified for `is:inline` scripts |

### Severity Distribution

| Severity | Count |
|----------|-------|
| Major | 4 |
| Minor | 6 |
| Nit | 1 |

---

## Overall Assessment: PASS WITH CONDITIONS

All 23 Round 1 issues have been adequately addressed. The revised design is substantially improved -- the `Checkout` type definition, corrected bundle estimates, `page.route()` Stripe mocking, parallel API fetches, and unit test plan all bring the document to implementation-ready quality.

The Round 1 fixes did introduce 4 new Major issues, but none are structural -- they are contradictions and missing details that are straightforward to resolve:

**Conditions for implementation to proceed:**

1. **N1 (Major):** Remove the first `$checkoutTotals` definition. Only the `display_*` version should remain. This is a 5-line edit.

2. **N2 (Major):** Align `CheckoutLineItem.product_id` type with `CartLineItem.product_id` (`number | string`), or add explicit `String()` coercion in the fingerprint functions. Without this, cart-change detection will false-positive on every load.

3. **N4 (Major):** Add timezone to `MerchantConfig` or document an alternative. Without this, scheduled pickup slots will display in the wrong timezone for cross-timezone users.

4. **N3 (Major):** Clarify CartBar suppression approach. Given the existing `null`-return pattern already works post-slot, this is low risk but should be explicitly documented as safe.

The remaining Minor and Nit issues (N5-N11) can be resolved during implementation without further design revision.

**Compared to Round 1:** The document has moved from "PASS WITH CONDITIONS (2 Critical, 11 Major)" to "PASS WITH CONDITIONS (0 Critical, 4 Major)". The remaining issues are localized fixes, not architectural concerns. Implementation can begin once the 4 Major items are addressed.
