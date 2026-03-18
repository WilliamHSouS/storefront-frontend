# Code Review Round 3 -- Checkout Flow Implementation

**Date:** 2026-03-18
**Branch:** `emdash/checkout-8al`
**Reviewer:** Claude Opus 4.6 (automated)
**Scope:** Verify N1 and N5 fixes from Round 2, check for regressions

---

## Round 2 Fix Verification

### N1 -- Hooks called after conditional early return

- **Verdict:** FIXED
- **Evidence:** In `CheckoutPage.tsx`, all hooks are declared at lines 86-100 (`useStore` x5, `useReducer`, `useRef` x2, `useState` x4). All `useEffect` calls span lines 112-168 and 171-210. The `useCallback` calls are at lines 154 and 246. The early returns (hydration guard and empty-cart guard) are at lines 291-298 -- after every hook call. No hook is conditionally skipped.

### N5 -- Mobile PlaceOrderButton ignores `isSubmitting` and `paymentReady`

- **Verdict:** FIXED
- **Evidence:**
  - `PlaceOrderButton.tsx:11` declares `disabled?: boolean` in the Props interface.
  - `PlaceOrderButton.tsx:14` destructures it as `disabled: externalDisabled`.
  - `PlaceOrderButton.tsx:16` computes `isDisabled = loading || externalDisabled`, used for both the `disabled` attribute (line 55) and visual styling (line 56).
  - `CheckoutPage.tsx:478` passes `disabled={isSubmitting || !paymentReady}` to the mobile `PlaceOrderButton`.
  - The desktop button at line 431 uses `disabled={loading || isSubmitting || !paymentReady}`. The mobile button combines `loading` (from its own `$checkoutLoading` store read) with the externally passed `isSubmitting || !paymentReady`. The effective disabled condition is identical across viewports.

---

## New Issues Check

Scanned `CheckoutPage.tsx` (482 lines) and `PlaceOrderButton.tsx` (85 lines) for Major+ regressions introduced by the N1/N5 fixes.

### PlaceOrderButton spinner shows on all disabled states

- **Severity:** Minor (not Major -- cosmetic only)
- **File:** `PlaceOrderButton.tsx:58`
- **Issue:** The button renders a spinner whenever `isDisabled` is true (line 58). This means the spinner appears not only during loading/submission but also when Stripe is not yet ready (`!paymentReady`). The user sees "Processing..." before they have even attempted to place an order. The desktop button (CheckoutPage.tsx:434) only shows the spinner when `loading` is true, not when `isSubmitting || !paymentReady`.
- **Impact:** Cosmetic confusion on mobile, not a functional bug. The button is correctly non-interactive.
- **Recommendation (non-blocking):** Pass a separate `loading` prop or check `loading` independently from `externalDisabled` to show the spinner only during active processing.

No Major or Critical issues found.

---

## Summary

| ID | From Round | Verdict |
|---|---|---|
| N1 | Round 2 | FIXED -- all hooks unconditionally called before early returns |
| N5 | Round 2 | FIXED -- mobile button disabled on `isSubmitting \|\| !paymentReady` |

| New | Severity | Summary |
|---|---|---|
| R3-1 | Minor | Mobile button shows spinner for all disabled states, not just loading/submitting |

---

## Verdict: PASS

Both blocking conditions from Round 2 are resolved. No new Major or Critical issues. The checkout implementation is clear to merge.

**Recommended follow-ups (non-blocking, from Rounds 2-3):**
- N2 -- make `validateForm` dependency on `form` explicit
- N3 -- use SDK `params.path` for gateway fetch
- N4 -- defer scroll-to-error with `requestAnimationFrame`
- R3-1 -- separate spinner state from disabled state in mobile PlaceOrderButton
