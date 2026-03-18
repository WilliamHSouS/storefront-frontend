# Plan Review Round 1: Checkout Implementation Plan

**Date:** 2026-03-18
**Reviewer:** Claude Code (Opus 4.6)
**Plan:** `docs/plans/2026-03-18-checkout-implementation-plan.md`
**Design doc:** `docs/plans/2026-03-17-checkout-flow-design.md`

---

## Issues

### P1 — Critical: CartBar suppression returns `null`, violating DOM stability invariant

**Severity:** Critical
**Task:** 8

The plan adds an early return in `CartBar.tsx` that returns a `<div>` wrapper, which is correct. However, the existing code at line 49-51 already returns `null` when the cart is empty or drawers are open. The plan's snippet adds the checkout check *before* the existing early return, which is good. But the plan's recommended `<div>` wrapper has different classes (`class="fixed bottom-0 left-0 right-0 z-40 md:hidden"`) than needed for a truly empty wrapper.

The real issue: the existing `CartBar` already returns `null` on line 49-51 (when `itemCount === 0 || isCartOpen || isCategoryDrawerOpen`). This violates the CLAUDE.md gotcha about island DOM stability ("Preact islands mounted before `<slot/>` in BaseLayout must never return `null`"). The design doc Section 2 explicitly calls this out: "render empty wrapper `<div class="md:hidden" />` (not `null`) for DOM stability." The plan only addresses checkout suppression but does not fix the pre-existing `null` return, which means CartBar already has a DOM stability bug. The plan should note this.

**Recommendation:** The checkout suppression is fine as written. Add a note that the existing `null` return on line 49-51 should also be converted to an empty stable wrapper div in the same commit, matching the design doc's instruction. This prevents a pre-existing bug from being carried forward.

---

### P2 — Critical: `afterEach` used without import in Task 4 test

**Severity:** Critical
**Task:** 4

The test file `src/stores/checkout-actions.test.ts` uses `afterEach` on line 499 but does not import it from vitest. The import on line 479 is:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
```

Missing: `afterEach`. This test will fail at runtime with `ReferenceError: afterEach is not defined`.

**Recommendation:** Change the import to:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
```

---

### P3 — Major: `cartFingerprint` function missing from plan, present in design doc

**Severity:** Major
**Task:** 3, 4

The design doc Section 2 defines both `checkoutFingerprint()` and `cartFingerprint()` as a pair for detecting cart staleness. The plan includes `checkoutFingerprint()` in Task 3 (checkout store) but never implements `cartFingerprint()`. The design doc Section 4 describes cart change detection across tabs using fingerprint comparison, and Section 11 lists it as an E2E test scenario.

The plan's Task 4 test file references "cart fingerprint comparison" in the design doc's test scenarios (Section 11), but neither the test nor the implementation appears in the plan.

**Recommendation:** Add `cartFingerprint()` to Task 3 alongside `checkoutFingerprint()`. Add unit tests for both functions (matching vs divergent). These are needed before Task 10 (CheckoutPage skeleton) where the cross-tab detection UI is wired up.

---

### P4 — Major: `ensurePaymentAndComplete` missing from implementation

**Severity:** Major
**Task:** 4, 19

The design doc Section 5 defines `ensurePaymentAndComplete()` as a critical shared function used by both the inline payment flow and the success page bank redirect flow. The plan's Task 4 implementation of `checkout-actions.ts` includes `createCheckout`, `fetchCheckout`, `patchDelivery`, `initiatePayment`, and `completeCheckout` but does NOT include `ensurePaymentAndComplete()`.

Task 19 mentions it in passing ("Success -> `ensurePaymentAndComplete()` -> redirect to success page") but Task 19 is a summary task with no implementation code. The design doc's unit test list (Section 11) explicitly includes three test cases for this function.

**Recommendation:** Add `ensurePaymentAndComplete()` to Task 4's `checkout-actions.ts` implementation. It requires Stripe's `retrievePaymentIntent()`, so it either needs Stripe as a parameter or should be implemented in Task 19. Either way, specify it explicitly with full code and tests rather than leaving it implicit in a summary task.

---

### P5 — Major: i18n keys use `{{count}}` (Mustache syntax) but codebase uses `{count}` (single braces)

**Severity:** Major
**Task:** 5

The design doc Section 10 defines two interpolated keys:

```json
"errorSummary_one": "There is {{count}} error",
"errorSummary_other": "There are {{count}} errors",
"itemCount_one": "{{count}} item",
"itemCount_other": "{{count}} items"
```

The existing `t()` function in `src/i18n/index.ts` uses single-brace interpolation: `text.replace(`{${k}}`, String(v))`. Existing keys use `{count}` (e.g., `"items_one": "{count} item"`). Double-brace values will NOT be interpolated and will render literally as `{{count}}`.

**Recommendation:** Use `{count}` (single braces) for all new keys, matching the existing convention. The plan's Task 5 should explicitly state this correction from the design doc.

---

### P6 — Major: Checkout page references `t('checkoutTitle')` but key does not exist yet when Task 6 runs

**Severity:** Major
**Task:** 6

Task 6 creates the Astro page that calls `t('checkoutTitle', langValue)`. Task 5 adds the i18n keys. The dependency graph says Tasks 6-9 all depend on "Phase 1" which includes Task 5. However, the dependency graph also states Tasks 6, 7, 8, 9 can run as "parallel subagents." If Task 6 runs before Task 5 completes, `t('checkoutTitle')` will return the raw key string `"checkoutTitle"` (the `t()` fallback behavior), which is not a build failure but produces broken output.

This is not technically a circular dependency, but the parallelization claim is misleading.

**Recommendation:** Add an explicit note that Tasks 6 and 7 have a soft dependency on Task 5 (i18n keys). If parallelized, the implementer must ensure Task 5 merges first. Alternatively, mark Task 5 as a hard prerequisite for Tasks 6 and 7.

---

### P7 — Major: Task 4 test mocks SDK differently from codebase convention

**Severity:** Major
**Task:** 4

The existing test convention (seen in `cart.test.ts` and `cart-actions.test.ts`) creates mock clients using the `StorefrontClient` type with all four methods (`GET`, `POST`, `PATCH`, `DELETE`):

```typescript
function makeClient(overrides: Partial<StorefrontClient> = {}): StorefrontClient {
  return {
    GET: vi.fn().mockResolvedValue({ data: null, error: null }),
    POST: vi.fn().mockResolvedValue({ data: null, error: null }),
    PATCH: vi.fn().mockResolvedValue({ data: null, error: null }),
    DELETE: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
}
```

Task 4's test defines an incompatible helper:

```typescript
function createMockClient(responses: Record<string, unknown> = {}) {
  return {
    POST: vi.fn().mockResolvedValue({ data: responses.POST ?? {}, error: null }),
    PATCH: vi.fn().mockResolvedValue({ data: responses.PATCH ?? {}, error: null }),
    GET: vi.fn().mockResolvedValue({ data: responses.GET ?? {}, error: null }),
  };
}
```

Issues: (1) Missing `DELETE` method; (2) Uses `as any` type cast instead of proper typing; (3) Default response is `{}` instead of `null` for missing data, which diverges from the SDK's `ApiResult` pattern where error responses have `data: null`; (4) Naming convention differs (`createMockClient` vs `makeClient`).

**Recommendation:** Use the established `makeClient` pattern with proper `StorefrontClient` typing. Keeps test conventions consistent and avoids `as any` casts.

---

### P8 — Major: Tasks 11-16 are insufficiently specified for zero-context implementers

**Severity:** Major
**Task:** 11-16

These six tasks are described in three lines each. For a team member with zero codebase context, the following is missing:

1. **No file paths** for test files. Where do `ContactForm.test.tsx`, `FulfillmentToggle.test.tsx` etc. go?
2. **No test code** at all. Tasks 1-4 have full test implementations. Tasks 11-16 say "write component -> integrate into CheckoutPage -> test manually -> commit." This violates the TDD pattern established by every earlier task.
3. **No props interfaces.** What props does each component receive? `CheckoutFormState`? A dispatch function? Individual field values? The design doc specifies `useReducer` for form state but the plan never shows the reducer or how state flows to child components.
4. **No validation logic.** The design doc Section 8 specifies field-level validation (email format, phone via `libphonenumber-js`, required fields). None of this appears in Tasks 11-16.
5. **No PATCH trigger logic.** The design doc Section 4 specifies exactly when PATCHes fire (e.g., "Contact section fields are all populated and user moves to next section"). This critical behavior is unspecified.
6. **No accessibility markup.** The design doc Section 6 specifies `role="radiogroup"` for time slots, `aria-disabled`, `role="listbox"` for date selector. None mentioned.

**Recommendation:** Expand each of Tasks 11-16 to the same level of detail as Tasks 1-4. At minimum provide: (a) file paths including test files, (b) props interface, (c) failing test code, (d) implementation skeleton with key logic, (e) integration point in CheckoutPage. This is the most significant gap in the plan.

---

### P9 — Major: `FormDivider` component listed in design doc but missing from plan

**Severity:** Major
**Task:** 10-16

The design doc Section 2 component tree includes `FormDivider` ("or fill in details below") between `ExpressCheckout` and `FulfillmentToggle`. It should be conditionally rendered (hidden when express checkout is unavailable, per Section 5). No task in the plan creates this component.

**Recommendation:** Add `FormDivider` to Task 10 (CheckoutPage skeleton) since it is a simple presentational component. Include the conditional rendering logic tied to express checkout availability.

---

### P10 — Major: Checkout page does not include Header/Footer like cart.astro does

**Severity:** Major
**Task:** 6

The existing `cart.astro` page includes `<Header>` and `<Footer>` components explicitly. The plan's `checkout.astro` only renders `<BaseLayout>` with `<CheckoutPage>` inside it. While `CheckoutHeader` (inside the island) provides a back-to-cart link and merchant name, there is no site-wide header or footer.

This may be intentional (checkout pages often strip navigation to reduce abandonment) but it is not stated. The design doc does not address this either.

**Recommendation:** Add a comment in the plan explicitly noting that the checkout page intentionally omits the site header and footer for conversion optimization, or add them. Either way, make the decision explicit so an implementer does not second-guess it.

---

### P11 — Major: Plan does not handle the `useReducer` form state architecture from design doc

**Severity:** Major
**Task:** 10-16

The design doc Section 2 specifies: "Form field state (email, phone, address, etc.) is local to the Preact island via `useReducer`." The plan's Task 3 includes `CheckoutFormState` type and `persistFormState`/`restoreFormState` utilities, but no task defines the actual `useReducer` setup, the action types, or the reducer function.

This is load-bearing architecture: every form section component needs to dispatch actions and read state from this reducer. Without it, Tasks 11-16 cannot be implemented independently.

**Recommendation:** Add the reducer definition (state shape, action union type, reducer function) to Task 10 as part of the CheckoutPage skeleton. This enables Tasks 11-16 to be implemented in parallel since each form section only needs to know the dispatch interface.

---

### P12 — Minor: Task 1 refactor logic is inverted

**Severity:** Minor
**Task:** 1

The plan says to replace:
```typescript
if (id && !CART_ID_PATTERN.test(id)) {
```
with:
```typescript
if (id && !validateStorageId(id)) {
```

Looking at the existing `cart.ts` line 146: `if (id && !CART_ID_PATTERN.test(id))` triggers when the ID is *invalid*. The replacement `if (id && !validateStorageId(id))` is semantically correct since `validateStorageId` returns `true` for valid IDs. The logic is fine, but the existing code also has a `typeof window === 'undefined'` guard (line 143) that the checkout store's `getStoredCheckoutId` omits. The checkout store uses `sessionStorage` without a `typeof window` check, relying on try/catch instead. This is acceptable since sessionStorage throws in SSR, but it is a style divergence.

**Recommendation:** No action needed on the logic inversion (it is correct). Optionally add a comment in Task 3 noting the intentional difference in SSR guard approach between cart (explicit window check) and checkout (try/catch).

---

### P13 — Minor: Task 9 middleware placement may not work as described

**Severity:** Minor
**Task:** 9

The plan says to add the checkout cache header check "before the existing `isCacheable` block (around line 106)." The actual code at line 106 is:

```typescript
// 6. Add cache headers with auth/personalization guards
const isCacheable = CACHEABLE_PATTERNS.some((p) => p.test(url.pathname));
```

The plan's `url.pathname.match(/^\/[a-z]{2}\/checkout/)` will work correctly placed before this block, and it correctly returns early after setting headers. However, the plan does not account for the `Vary: Cookie` header set on line 121, which applies to ALL responses. By returning early, the checkout response will NOT get `Vary: Cookie`. This is probably fine (no-store responses don't need Vary) but should be noted.

**Recommendation:** Either set `Vary: Cookie` before the checkout early return, or add a comment noting it is intentionally omitted for no-store responses.

---

### P14 — Minor: Task 3 test uses `sessionStorage.clear()` but vitest uses happy-dom

**Severity:** Minor
**Task:** 3

The test's `beforeEach` calls `sessionStorage.clear()`. The project uses `happy-dom` for Vitest (per CLAUDE.md: "Vitest + happy-dom"). Happy-dom provides `sessionStorage`, so this will work. However, the existing `cart.test.ts` creates a manual `localStorageMock` rather than using happy-dom's built-in. The checkout tests use happy-dom's native `sessionStorage` directly.

This is a style inconsistency but not a bug. The happy-dom approach is arguably cleaner.

**Recommendation:** No change needed, but add a brief comment noting that the checkout store tests intentionally use happy-dom's built-in sessionStorage rather than manual mocks, as a modernization of the pattern.

---

### P15 — Minor: Task 7 `CheckoutSuccess` does not read `payment_intent_client_secret` from URL

**Severity:** Minor
**Task:** 7

The design doc Section 5 success page logic reads four URL parameters:

```typescript
const checkoutId = urlParams.get('checkout_id');
const orderNumber = urlParams.get('order');
const paymentIntent = urlParams.get('payment_intent');
const clientSecret = urlParams.get('payment_intent_client_secret');
```

The plan's Task 7 implementation reads only three (missing `payment_intent_client_secret`). The `clientSecret` is needed for the `ensurePaymentAndComplete()` call on bank redirect returns. Without it, the success page cannot verify payment status via `stripe.retrievePaymentIntent(clientSecret)`.

The plan's implementation uses a placeholder comment ("Temporary -- will be replaced with real order polling") instead of the actual bank redirect handling logic.

**Recommendation:** Either implement the full bank redirect handling in Task 7, or add a follow-up task that wires `ensurePaymentAndComplete()` into the success page. Currently this is a silent gap that would result in broken iDEAL/Bancontact payment flows.

---

### P16 — Minor: Dependency graph claims Tasks 1, 2, 3, 5 are independent but Task 3 imports from Task 1 and Task 2

**Severity:** Minor
**Task:** Dependency graph

The plan states: "Task 1 (validate-id), Task 2 (types), Task 3 (store), Task 5 (i18n) -- all independent, can parallelize."

But Task 3's implementation imports:
- `import { validateStorageId } from '@/lib/validate-id';` (Task 1)
- `import type { Checkout, CheckoutStatus } from '@/types/checkout';` (Task 2)

These are compile-time dependencies. If Task 3 runs before Tasks 1 and 2 complete, it will fail type checking. The type import from Task 2 is soft (TypeScript `import type` is erased at runtime), but the runtime import from Task 1 is a hard dependency.

**Recommendation:** Correct the dependency graph: Task 3 depends on Tasks 1 and 2. Tasks 1, 2, and 5 are truly independent and can parallelize.

---

### P17 — Minor: Plan does not define `SdkClient` type correctly for testability

**Severity:** Minor
**Task:** 4

The plan defines:
```typescript
type SdkClient = ReturnType<typeof getClient>;
```

But `getClient()` throws if `$merchant` is not initialized. This type is correct at the TypeScript level, but the plan's implementation uses `as any` casts everywhere when constructing SDK URL paths:

```typescript
await sdk.PATCH(`/api/v1/checkout/${checkoutId}/delivery/` as any, ...)
await sdk.POST('/api/v1/checkout/' as any, ...)
```

The `as any` is needed because checkout endpoints are not in the SDK's OpenAPI types yet. This is a reasonable workaround but should be noted as tech debt to clean up when the SDK adds checkout types.

**Recommendation:** Add a brief comment in Task 4 noting the `as any` casts are temporary until `@poweredbysous/storefront-sdk` adds checkout endpoint types. Consider defining a `CheckoutClient` interface locally to reduce the blast radius of `any`.

---

### P18 — Minor: Design doc Section 9 CSP specifies nonce-based script-src but plan uses no nonce

**Severity:** Minor
**Task:** 22

The design doc Section 9 specifies `script-src 'self' https://js.stripe.com 'nonce-{random}'` with nonce-based CSP for inline scripts. The plan's Task 22 CSP header uses `script-src 'self' https://js.stripe.com` with no nonce mechanism. This means inline scripts in BaseLayout (PostHog stub, merchant JSON `define:vars`) will be blocked when CSP is enforced.

Since the plan starts with `Content-Security-Policy-Report-Only`, this is not immediately breaking but will prevent eventual enforcement.

**Recommendation:** Note in Task 22 that nonce support requires Astro middleware integration (generating a per-request nonce and injecting it into both the CSP header and inline script tags). This is non-trivial and may warrant its own task. At minimum, document it as a follow-up before enforcement.

---

### P19 — Minor: Design doc specifies discount code input in order summary but plan does not mention it

**Severity:** Minor
**Task:** 10

The design doc Section 3 desktop layout shows `[discount code]` in the order summary sidebar. The plan's Task 10 describes OrderSummary as rendering "cart items and always-visible price breakdown" with no mention of a discount code input. The existing cart page already has discount code functionality.

**Recommendation:** Clarify whether the OrderSummary component should include a discount code input (matching the design doc) or whether this is deferred. If included, add it to Task 10's OrderSummary specification.

---

### P20 — Minor: Cross-tab cart change detection not covered in any specific task

**Severity:** Minor
**Task:** 10-16, 21

The design doc Section 8 specifies: "Cart modified in another tab -- Detect via `storage` event on `localStorage`. Compare cart fingerprint. If diverged, show banner." This requires a `storage` event listener, fingerprint comparison UI, and "Update checkout / Keep current" buttons. The E2E tests (Task 21) list "cart change detection across tabs" as a scenario.

No task in the plan implements this feature. It is not in Task 10 (skeleton), not in Tasks 11-16 (form sections), and not in Tasks 17-19 (Stripe).

**Recommendation:** Add cross-tab detection to Task 10 (CheckoutPage skeleton) since it affects the overall page state, not a specific form section. Include the `storage` event listener, fingerprint comparison, and stale-cart banner.

---

### P21 — Nit: Task 2 has no TDD step

**Severity:** Nit
**Task:** 2

Task 2 (types) runs `pnpm check` to validate types compile, but has no test file. This is acceptable for a types-only file, but differs from the explicit TDD pattern in every other task. Since TypeScript interfaces are erased at runtime, there is nothing meaningful to test.

**Recommendation:** No change needed. The `pnpm check` validation is sufficient for a types-only task.

---

### P22 — Nit: Task 6 commits code that references a non-existent component

**Severity:** Nit
**Task:** 6

Task 6 imports `CheckoutPage from '@/components/interactive/CheckoutPage'` which does not exist until Task 10. The plan acknowledges this ("CheckoutPage doesn't exist yet but the page structure is correct") but still says to commit. A commit with a broken import will fail `pnpm check` and `pnpm build`.

**Recommendation:** Either (a) create a minimal placeholder `CheckoutPage.tsx` in Task 6 that exports a default function returning a `<div>`, or (b) merge Tasks 6 and 10 so the page and component are committed together. Option (a) is simpler and preserves task granularity.

---

### P23 — Nit: Task 7 commits success page that also references non-existent i18n keys

**Severity:** Nit
**Task:** 7

The `CheckoutSuccess` component references `t('confirmingOrder')`, `t('orderConfirmed')`, `t('thankYou')`, `t('orderNumber')`, `t('backToMenu')`. The `backToMenu` key already exists in `en.json`, but the others do not exist until Task 5 adds them. If Task 7 runs before Task 5, these will silently return the raw key strings.

**Recommendation:** Same as P6 -- ensure Task 5 is completed before Tasks 6 and 7.

---

### P24 — Nit: Design doc mentions `client:only="preact"` as a bundle optimization but plan does not consider it

**Severity:** Nit
**Task:** 23

Design doc Section 12 mitigation option 4 mentions `client:only="preact"` for the checkout island. The plan's Task 23 lists three mitigation options but omits this one.

**Recommendation:** Add `client:only="preact"` as an option in Task 23 for completeness.

---

## Summary Table

| ID | Severity | Task | Issue |
|----|----------|------|-------|
| P1 | Critical | 8 | CartBar existing `null` return violates DOM stability; plan only fixes checkout case |
| P2 | Critical | 4 | `afterEach` not imported from vitest -- test will crash |
| P3 | Major | 3, 4 | `cartFingerprint()` missing from plan (design doc Section 2) |
| P4 | Major | 4, 19 | `ensurePaymentAndComplete()` not implemented anywhere |
| P5 | Major | 5 | i18n keys use `{{count}}` but codebase uses `{count}` |
| P6 | Major | 6 | Parallelization claim wrong -- Task 6 soft-depends on Task 5 |
| P7 | Major | 4 | Test mock pattern diverges from established `makeClient` convention |
| P8 | Major | 11-16 | Six tasks lack file paths, tests, props, validation, a11y -- insufficient for implementation |
| P9 | Major | 10-16 | `FormDivider` component missing from plan |
| P10 | Major | 6 | No Header/Footer -- intentional or oversight? Not stated |
| P11 | Major | 10-16 | `useReducer` form state architecture from design doc not defined in any task |
| P12 | Minor | 1 | Refactor logic correct but SSR guard style differs (acceptable) |
| P13 | Minor | 9 | Early return skips `Vary: Cookie` header (acceptable but undocumented) |
| P14 | Minor | 3 | sessionStorage mock style differs from cart.test.ts (acceptable) |
| P15 | Minor | 7 | Success page missing `payment_intent_client_secret` handling for bank redirects |
| P16 | Minor | Graph | Dependency graph claims T1/T2/T3/T5 independent but T3 depends on T1 and T2 |
| P17 | Minor | 4 | `as any` SDK casts should be documented as tech debt |
| P18 | Minor | 22 | CSP nonce mechanism not implemented (design doc requires it for enforcement) |
| P19 | Minor | 10 | Discount code input in order summary not mentioned |
| P20 | Minor | 10-16 | Cross-tab cart change detection not in any task |
| P21 | Nit | 2 | No TDD for types-only file (acceptable) |
| P22 | Nit | 6 | Commit imports non-existent CheckoutPage component -- build will fail |
| P23 | Nit | 7 | Success page uses i18n keys that do not exist until Task 5 |
| P24 | Nit | 23 | `client:only="preact"` optimization option omitted |

**Severity counts:** 2 Critical, 9 Major, 9 Minor, 4 Nit

---

## Overall Verdict: NEEDS REVISION

The plan's foundation (Phase 1: Tasks 1-4) is well-structured with proper TDD, correct code, and good test coverage -- aside from two critical bugs (P1, P2) that are straightforward fixes. The core architecture (PATCH queue, store design, type definitions) faithfully implements the design doc.

However, the plan has two structural problems that prevent an implementer from executing it end-to-end:

1. **Tasks 11-16 are stubs, not plans (P8, P11).** These six tasks represent the bulk of the user-facing checkout UI and contain zero implementation detail. An engineer following this plan would hit a wall after Task 10. The `useReducer` architecture, validation logic, PATCH trigger points, and accessibility markup are all unspecified. These tasks need the same level of detail as Tasks 1-4.

2. **Several design doc features are not mapped to any task (P3, P4, P9, P20).** `cartFingerprint`, `ensurePaymentAndComplete`, `FormDivider`, and cross-tab detection are all specified in the design doc but fall through the cracks in the plan. An implementer who only reads the plan would ship an incomplete checkout.

**Required before implementation:**
- Fix P1 and P2 (critical bugs in code snippets)
- Expand Tasks 11-16 with full specifications (P8, P11)
- Add missing features to specific tasks (P3, P4, P9, P20)
- Correct the dependency graph (P16) and parallelization claims (P6)
- Fix i18n interpolation syntax (P5)
