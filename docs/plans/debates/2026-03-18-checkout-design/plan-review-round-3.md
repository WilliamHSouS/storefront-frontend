# Plan Review Round 3: Checkout Implementation Plan

**Date:** 2026-03-18
**Reviewer:** Claude Code (Opus 4.6)
**Plan:** `docs/plans/2026-03-18-checkout-implementation-plan.md`
**Round 2:** `docs/plans/debates/2026-03-18-checkout-design/plan-review-round-2.md`

---

## Part 1: Round 2 Condition Verification

### N1 -- Bank redirect wiring in Task 19

**Status: FIXED**

Task 19 (lines 1498-1511) now explicitly covers both CheckoutPage and CheckoutSuccess. The success page integration includes all four required steps:

1. Read `checkout_id` + `payment_intent_client_secret` from URL (line 1507)
2. Initialize Stripe via `loadStripe(publishableKey, { stripeAccount })` (line 1508)
3. Call `ensurePaymentAndComplete(checkoutId, clientSecret, stripe, lang)` (line 1509)
4. Contextual note that this handles iDEAL/Bancontact returns (line 1510)

The bank redirect flow is no longer a dead path. The implementation steps are clear enough to execute without ambiguity.

---

### N3 -- CheckoutPage null return on empty cart

**Status: FIXED**

Lines 1150-1154 now read:

```tsx
// Guard: redirect to menu if cart is empty
// Render stable wrapper (not null) for DOM stability during redirect
if (cart && cart.line_items.length === 0) {
  window.location.href = `/${lang}/`;
  return <div class="min-h-screen" />;
}
```

Both guard paths (no merchant on line 1148, empty cart on line 1154) now return a stable wrapper div. The comment explicitly references DOM stability, which helps future maintainers understand why this is not `null`.

---

### N4 -- makeClient typing in Task 4

**Status: ACKNOWLEDGED, NOT FIXED -- Acceptable**

Task 4 (lines 492-500) still uses an untyped `makeClient` returning a bare object, with `as any` casts at call sites (lines 519, 534). However, the comment block on lines 492-493 now explicitly documents the rationale:

> "Note: uses `as any` for now since checkout endpoints aren't in the SDK types yet. When the SDK adds checkout types, replace with proper StorefrontClient typing."

This is a conscious, documented trade-off rather than an oversight. The checkout endpoints genuinely do not exist in the current `StorefrontClient` type from `@poweredbysous/storefront-sdk`, so importing `StorefrontClient` and typing the mock against it would not actually catch checkout-specific interface drift. The `as any` is scoped to test code and the debt is tracked.

**Verdict on N4:** The Round 2 recommendation assumed the checkout paths existed in `StorefrontClient`. They do not. The current approach is pragmatic and documented. Not blocking.

---

## Part 2: Remaining Issue Scan

Reviewed all 24 tasks for Major+ issues not previously flagged. Findings:

**No new Major or Critical issues found.**

The two Minor issues from Round 2 (N2: cross-tab stub, N5: boolean in SET_FIELD) remain unchanged and remain non-blocking as noted in that review.

---

## Summary

| Condition | Status |
|-----------|--------|
| N1: Bank redirect in Task 19 | FIXED |
| N3: CheckoutPage null guard | FIXED |
| N4: makeClient typing | Acknowledged with rationale -- acceptable |

---

## Final Verdict: PASS

All conditions from Round 2 are resolved. No new Major or Critical issues. The plan is ready for implementation.
