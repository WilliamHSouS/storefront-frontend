# Plan Review Round 2: Checkout Implementation Plan

**Date:** 2026-03-18
**Reviewer:** Claude Code (Opus 4.6)
**Plan:** `docs/plans/2026-03-18-checkout-implementation-plan.md`
**Round 1:** `docs/plans/debates/2026-03-18-checkout-design/plan-review-round-1.md`

---

## Part 1: Round 1 Fix Verification

| ID | Round 1 Issue | Status | Notes |
|----|---------------|--------|-------|
| P1 | CartBar `null` return violates DOM stability | **FIXED** | Task 8 (lines 932-956) now replaces both the checkout suppression AND the existing `null` return with a stable `emptyWrapper` div. Exactly what was recommended. |
| P2 | `afterEach` not imported from vitest | **FIXED** | Task 4 import (line 487) now reads `import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';`. |
| P3 | `cartFingerprint()` missing from plan | **FIXED** | Task 3 (lines 463-468) now includes `cartFingerprint()` alongside `checkoutFingerprint()`. Both use the same `product_id:quantity` sorted join pattern. |
| P4 | `ensurePaymentAndComplete()` not implemented | **FIXED** | Task 4 (lines 679-716) now includes full implementation with `stripe.retrievePaymentIntent()`, status switch, and redirect logic. Stripe instance passed as parameter to avoid module-level coupling. |
| P5 | i18n keys use `{{count}}` instead of `{count}` | **FIXED** | Task 5 (lines 754-758) explicitly calls out the conversion from double to single braces with corrected examples. |
| P6 | Parallelization claim wrong for Tasks 5/6/7 | **FIXED** | Dependency graph (lines 1627-1629) now states Task 5 must complete before Tasks 6 and 7. Task 6 depends on "Task 5, 10." |
| P7 | Test mock diverges from `makeClient` convention | **FIXED** | Task 4 (lines 492-498) now uses `makeClient` naming, includes `DELETE` method, and uses `null` instead of `{}` as default data. Still uses `as any` cast on line 517, but that is the same pattern throughout the file due to missing SDK types -- acceptable given the P17 note. |
| P8 | Tasks 11-16 lack detail | **FIXED** | All six tasks now include: file paths with test files, props interfaces, failing test code with specific assertions, implementation guidance with key behaviors (validation, PATCH triggers, a11y markup), and integration points. Tasks 11-15 have 4-6 test cases each. Task 16 is presentational-only, appropriately lighter. |
| P9 | `FormDivider` missing from plan | **FIXED** | Task 10 (lines 1027-1048) now creates `FormDivider` with a `visible` prop tied to express checkout availability. |
| P10 | No Header/Footer -- intentional or oversight? | **FIXED** | Task 10 Step 7 (line 1161) explicitly states: "No site Header/Footer is rendered (intentional -- checkout pages strip navigation for conversion)." Also repeated in Notes for Implementers (line 1658). |
| P11 | `useReducer` form state not defined | **FIXED** | Task 10 (lines 1058-1157) now defines `FormAction` union type, `INITIAL_FORM_STATE`, `formReducer`, and the full `useReducer` setup with `restoreFormState` initializer. This is the load-bearing section that enables Tasks 11-16. |
| P12 | SSR guard style divergence (Minor) | N/A | Accepted as-is per Round 1. |
| P13 | Early return skips `Vary: Cookie` (Minor) | **NOTED** | Not explicitly addressed in the plan text, but acceptable -- `no-store` responses do not benefit from `Vary`. |
| P14 | sessionStorage mock style (Minor) | N/A | Accepted as-is per Round 1. |
| P15 | Success page missing `payment_intent_client_secret` | **PARTIALLY FIXED** | Task 7 (lines 874-878) now acknowledges the bank redirect flow with a comment: "Bank redirect return -- use ensurePaymentAndComplete (wired in Task 19)." However, `payment_intent_client_secret` is still not read from URL params. Task 19 (line 1499) says to wire `ensurePaymentAndComplete` but provides no code for the success page integration. See New Issue N1 below. |
| P16 | Dependency graph incorrect | **FIXED** | Graph (lines 1620-1624) now correctly shows Task 3 depends on Tasks 1 and 2. Tasks 1, 2, 5 listed as truly independent. |
| P17 | `as any` SDK casts undocumented | **FIXED** | Notes for Implementers (line 1659) documents the `as any` casts as temporary and suggests a local `CheckoutClient` interface. |
| P18 | CSP nonce not implemented (Minor) | **FIXED** | Notes for Implementers (line 1660) explicitly defers nonce enforcement as a follow-up task. |
| P19 | Discount code input not mentioned (Minor) | **FIXED** | Task 10 Step 3 (line 1050) now mentions "Includes discount code input (re-use existing `DiscountCodeInput` island pattern from CartFooter)." |
| P20 | Cross-tab cart change detection missing | **PARTIALLY FIXED** | Task 10 (lines 1134-1143) adds a `storage` event listener that watches for `sous_cart_id` changes. However, it only logs a comment "will be checked on next interaction" -- it does not compare fingerprints or show a stale-cart banner. See New Issue N2 below. |
| P21 | No TDD for types-only file (Nit) | N/A | Accepted as-is. |
| P22 | Task 6 imports non-existent CheckoutPage | **FIXED** | Task 6 Step 2 (lines 798-803) now creates a minimal placeholder `CheckoutPage.tsx` that renders a loading div. |
| P23 | Success page uses non-existent i18n keys | **FIXED** | Resolved by P6 fix -- dependency graph now enforces Task 5 before Task 7. |
| P24 | `client:only="preact"` omitted (Nit) | **FIXED** | Task 23 (line 1590) now lists `client:only="preact"` as mitigation option 4. |

**Summary:** 19 FIXED, 2 PARTIALLY FIXED, 3 N/A (accepted minors).

---

## Part 2: New Issues

### N1 -- Major: Success page bank redirect flow is a dead path

**Severity:** Major
**Tasks:** 7, 19

Task 7's `CheckoutSuccess` component (lines 857-883) handles three URL scenarios:
1. `order` param without `paymentIntent` -- shows order confirmation (works)
2. `checkoutId` and `paymentIntent` params -- bank redirect return (broken path)
3. No valid params -- redirects to menu (works)

Scenario 2 sets `loading: false` and `orderNumber: null`, then shows a confirmation page with no order number. The comment says "Task 19 will integrate the full ensurePaymentAndComplete() flow," but Task 19 (lines 1493-1501) only describes wiring Stripe into `CheckoutPage.tsx`, not into `CheckoutSuccess.tsx`.

The actual flow for iDEAL/Bancontact is: Stripe redirects to success page with `payment_intent` + `payment_intent_client_secret` + `checkout_id` params. The success page must call `ensurePaymentAndComplete()` to verify payment and call `/complete/`. This requires:
1. Reading `payment_intent_client_secret` from URL params (currently missing)
2. Loading Stripe.js on the success page (currently not loaded)
3. Calling `ensurePaymentAndComplete()` (implemented in Task 4 but not wired here)

Without this, every bank redirect payment will land on a broken success page showing no order number and never completing the checkout server-side.

**Recommendation:** Add a Task 19b (or expand Task 19) that wires `ensurePaymentAndComplete` into `CheckoutSuccess`. This requires: (a) reading `payment_intent_client_secret` from URL, (b) lazy-loading Stripe.js via `loadStripe()`, (c) calling `ensurePaymentAndComplete` and updating the component state with the resulting order number or error. Provide the implementation code since this is a critical payment path.

---

### N2 -- Minor: Cross-tab cart detection is a stub, not an implementation

**Severity:** Minor
**Task:** 10

The `storage` event listener (lines 1134-1143) watches for key changes but the handler body is a comment:
```typescript
if (e.key === 'sous_cart_id' || e.key === null) {
  // Cart may have changed in another tab -- will be checked on next interaction
}
```

The design doc specifies: compare `cartFingerprint($cart)` vs `checkoutFingerprint($checkout)`, show a banner with "Update checkout / Keep current" buttons. The plan implemented both fingerprint functions in Task 3 (P3 fix) but never calls them.

This is not blocking -- the deferred-check approach (comparing on next user interaction) is a valid degraded UX. But it diverges from the design doc's specified behavior without an explicit note. If the full banner behavior is intended for a later task, say so.

**Recommendation:** Either implement the fingerprint comparison and banner inline (matching the design doc), or add a comment: "Full banner UI deferred to post-launch. Current behavior: stale checkout detected on next PATCH attempt." Do not leave a silent empty handler that looks like forgotten code.

---

### N3 -- Major: `CheckoutPage` guard returns `null` on empty cart, violating DOM stability

**Severity:** Major
**Task:** 10

Lines 1148-1152 of the `CheckoutPage` component:
```tsx
if (cart && cart.line_items.length === 0) {
  window.location.href = `/${lang}/`;
  return null;
}
```

This returns `null` from a `client:load` island. The CLAUDE.md gotcha states: "Preact islands mounted before `<slot/>` in BaseLayout must never return `null`. Always render a stable wrapper element."

While `CheckoutPage` is mounted inside `<slot/>` (not before it like `CartBar`), the plan went to significant effort in Task 8 to fix the same pattern in `CartBar`. The `return null` after `window.location.href` is a brief transitional state during navigation, but on slow connections or when `location.href` is blocked (some iframe contexts), the component will remain as `null` in the DOM.

**Recommendation:** Return `<div class="min-h-screen" />` instead of `null` for both guard paths (no merchant and empty cart). The no-merchant guard on line 1146 already does this correctly -- apply the same pattern to the empty-cart guard.

---

### N4 -- Major: Task 4 `makeClient` still uses `as any` cast and does not type as `StorefrontClient`

**Severity:** Major (for test reliability, not runtime)
**Task:** 4

The Round 1 P7 fix changed naming to `makeClient` and added `DELETE`, but the function on line 492 still returns an untyped object:

```typescript
function makeClient(overrides: Record<string, unknown> = {}) {
  return { ... };
}
```

The existing `cart-actions.test.ts` (line 21-22) imports and uses `StorefrontClient`:
```typescript
import type { StorefrontClient } from '@/lib/sdk-stub';
function makeClient(overrides: Partial<StorefrontClient> = {}): StorefrontClient { ... }
```

Task 4's `makeClient` returns a bare object, then uses `client as any` on every call site (lines 517, 532). This means the test provides zero type safety on the client interface -- if the SDK methods change shape, these tests will still compile but fail at runtime.

**Recommendation:** Import `StorefrontClient` and type the helper identically to `cart-actions.test.ts`. This removes the need for `as any` at call sites and catches interface drift at compile time. The `as any` casts on SDK URL paths inside the production code are a separate issue (already documented in P17) and should not infect test code.

---

### N5 -- Minor: `FormAction` type `SET_FIELD` value type does not cover `boolean`

**Severity:** Minor
**Task:** 10

The `SET_FIELD` action (line 1070):
```typescript
{ type: 'SET_FIELD'; field: keyof CheckoutFormState; value: string | number | null }
```

`CheckoutFormState` (Task 2, lines 220-235) has no boolean fields currently, so this is technically correct. However, if any form section component needs to track a boolean (e.g., "save address for next time", "same as shipping address"), the action type would need updating. The `CheckoutFormState` type also does not include fields like `termsAccepted` that checkout flows commonly need.

This is not blocking -- the type can be extended when needed. Noting for awareness.

---

## Part 3: Reducer / Component Interface Consistency Check

**Does the Task 10 reducer match what Tasks 11-16 expect?**

All six component props interfaces follow this pattern:
```tsx
{
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  onBlur: () => void;         // (except FulfillmentToggle, PickupLocationPicker, SchedulingPicker)
  errors: Record<string, string>;  // (except FulfillmentToggle, PickupLocationPicker, SchedulingPicker)
}
```

This is consistent with the reducer's `FormAction` type:
- `ContactForm` dispatches `SET_FIELD` for email/phone/name fields -- all exist in `CheckoutFormState`. OK.
- `FulfillmentToggle` dispatches `SET_FULFILLMENT` -- matches the action type. OK.
- `DeliveryAddressForm` dispatches `SET_FIELD` for street/city/postalCode -- all exist. OK.
- `PickupLocationPicker` dispatches `SET_FIELD` for `pickupLocationId` -- exists as `number | null` in state. The `SET_FIELD` value type is `string | number | null`, which covers `number | null`. OK.
- `SchedulingPicker` dispatches `SET_SCHEDULING` -- matches the action type. Also calls `onSlotSelect` and `onDateChange` callbacks rather than dispatching directly. OK.
- `PrivacyNotice` is presentational, no dispatch. OK.

**Verdict:** Reducer and component interfaces are consistent. No mismatches found.

---

## Part 4: `ensurePaymentAndComplete` / Success Page Integration Check

Task 4's `ensurePaymentAndComplete` (lines 682-716) does:
1. Fetch checkout -- if already completed, redirect to success with `order` param
2. Call `stripe.retrievePaymentIntent(clientSecret)`
3. On `succeeded` -- call `completeCheckout()` then redirect
4. Other statuses -- set error

Task 7's success page reads `order` param and renders confirmation. This path works for the inline card payment flow (CheckoutPage calls `ensurePaymentAndComplete`, which redirects with `?order=X`).

The gap is the bank redirect flow (N1 above): user returns to success page with `payment_intent` + `payment_intent_client_secret` params, but the success page never calls `ensurePaymentAndComplete`. Task 19 does not address this.

---

## Part 5: Test Pattern Consistency Check (Tasks 11-15)

All five test files follow the same structure:
1. Import `render`/`fireEvent` from `@testing-library/preact`
2. Create `defaultProps` with mock dispatch/onBlur
3. Test rendering of expected fields
4. Test dispatch calls on user interaction
5. Test error display from `errors` prop
6. Test visibility/conditional rendering

Noted inconsistencies:
- Tasks 11 and 13 test with `vi.fn()` for dispatch but do not import `vi` in the shown test snippet (the describe block uses `vi.fn()` implicitly). This is the same class of bug as the original P2. Since these are test stubs (showing `/* ... */` for some bodies), the implementer will need the full import line. **This is a minor risk** -- the pattern is obvious from Task 4's fix.
- Task 12's test stubs use `/* ... */` placeholder bodies for all 5 tests. This is acceptable since the props interface and test descriptions are sufficient to implement.
- Task 15 has the most complex test surface (11 test cases for SchedulingPicker). The `onDateChange` and `onSlotSelect` callbacks in the props are not dispatch calls -- they are separate callbacks for parent orchestration (fetching new slots, triggering PATCH). This is a clean separation.

**Verdict:** Test patterns are consistent and implementable. Minor import risk noted but not blocking.

---

## Summary Table

| ID | Severity | Task | Issue |
|----|----------|------|-------|
| N1 | Major | 7, 19 | Bank redirect flow on success page is unimplemented -- iDEAL/Bancontact payments will not complete |
| N3 | Major | 10 | `CheckoutPage` empty-cart guard returns `null` -- same DOM stability violation fixed in Task 8 |
| N4 | Major | 4 | `makeClient` in tests still untyped -- should use `StorefrontClient` to match codebase convention |
| N2 | Minor | 10 | Cross-tab cart detection is a stub with an empty handler body |
| N5 | Minor | 10 | `SET_FIELD` value type lacks `boolean` (not blocking today) |

**Severity counts:** 3 Major, 2 Minor

---

## Final Verdict: PASS WITH CONDITIONS

The plan has substantially improved from Round 1. All 2 Critical and 7 of 9 Major issues are fully resolved. The remaining gaps are:

**Conditions for implementation (must fix before starting Phase 4):**

1. **N1 -- Wire `ensurePaymentAndComplete` into CheckoutSuccess.** Expand Task 19 to include the success page bank redirect integration. Without this, all redirect-based payment methods (iDEAL, Bancontact, Sofort) are broken. This is the only condition that affects payment correctness.

2. **N3 -- Fix the `return null` in CheckoutPage's empty-cart guard.** One-line fix: return `<div class="min-h-screen" />` instead of `null`. Apply the same principle the plan already established in Task 8.

3. **N4 -- Type the test `makeClient` as `StorefrontClient`.** Keeps test conventions consistent and removes `as any` from test call sites.

These three fixes are small and scoped. The plan's architecture (reducer, PATCH queue, store design, component interfaces) is sound and internally consistent. Tasks 1-10 can begin implementation immediately; conditions N1 and N3 must be resolved before Task 19 and Task 10 are committed, respectively.
