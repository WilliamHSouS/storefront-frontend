# Architecture Review: Checkout Flow Design (Round 3 -- Final Verification)

**Date:** 2026-03-18
**Reviewer:** Code Review Expert (AI-assisted)
**Document reviewed:** `docs/plans/2026-03-17-checkout-flow-design.md` (post-Round 2 revision)
**Round 2 review:** `docs/plans/debates/2026-03-18-checkout-design/review-round-2.md`

---

## Round 2 Fix Verification (N1-N4)

| ID | Issue | Fix Status | Evidence |
|----|-------|------------|----------|
| N1 | Duplicate `$checkoutTotals` definitions (raw vs. `display_*`) | **FIXED** | Only one definition remains (lines 62-68), using `display_*` fields exclusively. The raw-field version has been removed. Comment on line 61 ("Uses display_* fields") makes the intent clear. |
| N2 | `product_id` type mismatch between `CartLineItem` and `CheckoutLineItem` | **FIXED** | `CheckoutLineItem.product_id` is now `number | string` (line 81) with an inline comment "matches CartLineItem (backend may return either)". Both fingerprint functions use explicit `String()` coercion (lines 167, 177) with a comment explaining why. Belt-and-suspenders approach -- good. |
| N3 | CartBar `null` return violating island DOM stability | **FIXED** | Section 13 modified files table (line 1099) explicitly says: render empty wrapper `<div class="md:hidden" />` (not `null`) for DOM stability. References the CLAUDE.md gotcha directly. |
| N4 | Timezone field missing from `MerchantConfig` | **FIXED** | Added as Backend Requirement #7 (line 43) with IANA format specification and concrete example (`"Europe/Amsterdam"`). Section 6 scheduling picker (line 673) references Requirement #7 and includes a pragmatic fallback: default to `"Europe/Amsterdam"` with a TODO if the field is not yet available at launch. |

**All 4 Round 2 issues are FIXED.**

---

## Check for New Issues Introduced by N1-N4 Fixes

Reviewed the areas surrounding each fix for contradictions, inconsistencies, or implementation blockers.

### No new Major issues found.

The fixes are clean, localized edits that do not contradict other parts of the document:

- **N1 fix (single `$checkoutTotals`):** The `display_*` field semantics are now clarified in the prose at line 160 -- they are raw decimal strings in the display currency, not pre-formatted. This resolves the former N5 (Minor) ambiguity from Round 2 as well. The `$checkoutTotals` store values will still pass through `formatPrice()` for locale formatting. Consistent with the existing cart pattern.

- **N2 fix (`product_id` alignment + `String()` coercion):** The coercion comment is accurate and the approach is sound. No downstream type conflicts -- the fingerprint functions produce strings regardless of input type.

- **N3 fix (empty wrapper):** The specified wrapper `<div class="md:hidden" />` preserves the existing responsive behavior (hidden on desktop) while maintaining DOM stability. No conflict with the checkout page's own sticky PlaceOrderButton since they target different contexts.

- **N4 fix (timezone as Backend Requirement #7):** The fallback strategy (default to `"Europe/Amsterdam"`) is pragmatic for a Netherlands-first launch. The requirement is properly cross-referenced between Section 1 (Backend Requirements) and Section 6 (Scheduling Picker). No contradictions with other time-related logic in the document.

### Minor observations (non-blocking)

1. **N5 from Round 2 is now implicitly resolved.** The `display_*` field semantics clarification at line 160 answers the question Round 2 raised about whether these are pre-formatted or raw decimals. No design change needed.

2. **N7 from Round 2 (payment gateway fetch timing) remains ambiguous.** Step 1 still says "(or defer until checkout exists -- see step 2)" at line 391-392. This was Minor in Round 2 and remains Minor -- the implementer can resolve it by following the conditional logic (restore path vs. creation path). Not worth another revision cycle.

3. **Remaining Round 2 Minors (N6, N8, N10, N11) and Nit (N9)** are unchanged and appropriately deferred to implementation. None have been made worse by the N1-N4 fixes.

---

## Final Verdict: PASS

The design document is ready for implementation. All Critical and Major issues from Rounds 1 and 2 have been resolved across three review cycles:

- **Round 1:** 2 Critical, 11 Major -- all fixed
- **Round 2:** 0 Critical, 4 Major -- all fixed
- **Round 3:** 0 Critical, 0 Major -- clean

The remaining open items from Round 2 (N5-N11) are Minor/Nit severity and are appropriate to resolve during implementation rather than through further design revision. None of them block the implementer from starting work.
