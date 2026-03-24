# Debate Synthesis: Checkout Flow Design

**Date:** 2026-03-18
**Participants:** Architecture Critic, UX & Conversion Critic, Security & Reliability Critic
**Document reviewed:** `docs/plans/2026-03-17-checkout-flow-design.md`

---

## Verdict: Design is sound but needs 8 revisions before implementation

The overall architecture — single-page guest checkout, Preact island, Stripe Payment Element, progressive API updates — is the right approach. No critic challenged the fundamental strategy. However, all three independently identified **critical gaps** that would cause real failures in production. The issues cluster into three themes:

1. **Payment flow has timing errors and no safety net** (all three critics)
2. **Mobile UX buries the highest-conversion payment methods** (UX critic)
3. **Missing security fundamentals for a payment page** (security critic)

---

## Critical Issues (Must Fix Before Implementation)

### 1. Stripe Payment Element timing is contradictory
**Source:** Architecture (4.1)
**Problem:** The design shows the Payment Element visible in the form layout, but the API flow says the PaymentIntent is created on "Place Order" click. You can't mount a Payment Element without a `client_secret`. The design contradicts itself.
**Resolution:** `POST /checkout/{id}/payment/` must fire **after the delivery section is complete**, not on submit. The Payment Element mounts with the returned `client_secret`. "Place Order" only calls `stripe.confirmPayment()`. Update Section 4 and Section 5 of the design.

### 2. No Stripe webhook fallback for order completion
**Source:** Security (6.1), Architecture (4.4)
**Problem:** If the user closes the browser after `stripe.confirmPayment()` succeeds but before `/complete/` fires, money is captured but no order is created. This **will** happen in production — mobile users switch apps, connections drop, tabs crash.
**Resolution:** Stripe `payment_intent.succeeded` webhook must be the **primary** completion mechanism. The frontend `/complete/` call is a fast-path optimization. Document this as a backend requirement. The backend already has webhook infrastructure (`views_webhook.py`).

### 3. Bank redirect loses checkout ID (sessionStorage is tab-scoped)
**Source:** Architecture (4.2)
**Problem:** iDEAL/Bancontact redirect to the bank and back. `sessionStorage` doesn't survive cross-tab redirects on some mobile browsers. The success page can't find the checkout ID.
**Resolution:** Pass `checkout_id` in the `return_url` query parameter: `/{lang}/checkout/success?checkout_id={id}`. Also clear `payment_intent_client_secret` from the URL via `history.replaceState` immediately after reading it (security concern 1.1).

### 4. Express checkout (Apple Pay / Google Pay / iDEAL) is buried
**Source:** UX (4a)
**Problem:** The Netherlands market is ~60% iDEAL. Apple Pay and Google Pay enable one-tap checkout. All are hidden below 8+ form fields. This is the single biggest conversion miss.
**Resolution:** Add a **Stripe Payment Request Button** at the top of the page, above the manual form. This shows Apple Pay/Google Pay when available. For iDEAL, the Payment Element's express payment methods surface automatically. Structure:
```
[Express Checkout: Apple Pay / Google Pay]
──── or fill in details below ────
[Manual form sections...]
```

### 5. No scroll-to-error on form submit
**Source:** UX (7a)
**Problem:** On a long single-page form, tapping "Place Order" with a validation error scrolled off-screen produces no visible feedback. The user doesn't know why nothing happened.
**Resolution:** On submit with errors, `scrollIntoView({ behavior: 'smooth', block: 'center' })` to the first invalid field + focus it. Add `aria-live="assertive"` error summary for accessibility.

### 6. No Content Security Policy
**Source:** Security (7.1)
**Problem:** The checkout page handles payment data via Stripe Elements. Without CSP, any injected script can exfiltrate card details. The codebase has other security headers but no CSP.
**Resolution:** Add CSP header for checkout pages. Start with report-only:
```
script-src 'self' https://js.stripe.com;
frame-src https://js.stripe.com https://hooks.stripe.com;
connect-src 'self' https://api.stripe.com <API_BASE_URL>;
```
Note: Inline scripts in `BaseLayout.astro` will need nonces or extraction to external files.

### 7. PATCH race conditions between concurrent delivery updates
**Source:** Architecture (2.2)
**Problem:** User changes fulfillment method, then immediately enters an address — two PATCHes fire concurrently. Backend processes them in arbitrary order, leaving checkout inconsistent.
**Resolution:** Implement a PATCH queue with `AbortController` (pattern already exists in `cart.ts` with `pendingEnsure` and `refreshGeneration`). Debounce with 500ms trailing delay. Only the most recent PATCH response is committed to `$checkout`.

### 8. HMAC signing gap on client-side checkout API calls
**Source:** Security (2.2)
**Problem:** `BaseLayout.astro` strips `hmacSecret` from `window.__MERCHANT__`, but `api.ts` reads `merchant.hmacSecret` for HMAC signing. Client-side write requests are going unsigned. Either checkout API calls will fail at runtime, or the backend doesn't enforce HMAC (meaning no CSRF protection).
**Resolution:** Investigate and resolve before implementation. Either: (a) the backend doesn't enforce HMAC on storefront endpoints (document this), or (b) implement an alternative CSRF mechanism for client-side mutations (Origin header validation, checkout-scoped token).

---

## Major Issues (Address in Design Revision or Early Implementation)

| # | Issue | Source | Recommendation |
|---|-------|--------|----------------|
| M1 | Order summary collapsed hides totals on mobile | UX (3) | Keep price breakdown always visible; only collapse line items for 4+ item carts |
| M2 | Form state lost on page refresh | Arch (2.1) | Debounce-persist form state to `sessionStorage` key `sous_checkout_form` |
| M3 | Eager checkout creation wastes backend resources | Arch (3.1) | Defer creation to first meaningful user action (section completion) |
| M4 | Cart staleness detection only checks cart_id | Arch (3.3) | Compare cart fingerprint (item count + total), not just ID |
| M5 | Re-render blast radius in single island | Arch (1.2) | Use `computed()` nanostores for derived slices; memoize Stripe wrapper |
| M6 | Checkout ID not validated from sessionStorage | Arch (5.3), Sec (2.3) | Apply same `CART_ID_PATTERN` regex validation |
| M7 | No amount verification before confirmPayment | Sec (1.2) | `POST /payment/` response must include PaymentIntent amount; frontend compares |
| M8 | GDPR: no privacy notice at data collection point | Sec (5.2) | Add privacy policy link near email field |
| M9 | Fulfillment default before address entry | UX (6a, 6c) | Pre-populate from existing `$addressCoords` store |
| M10 | Scheduling picker accessibility gaps | UX (5b) | Proper ARIA: `role="radiogroup"` for slots, `aria-disabled` for full slots |
| M11 | Rate limiting on checkout creation / slot reservation | Sec (4.1, 4.2) | Backend rate limits: 10 checkouts/min per IP, 5 slot changes per checkout |
| M12 | Sticky CTA hides when keyboard is open | UX (2a, 2b) | Hide on `focusin`, show on `focusout` |
| M13 | Empty cart race on direct navigation | Arch (6.5) | `await ensureCart()` before any checkout API calls |
| M14 | PostHog capturing PII on checkout pages | Sec (7.3) | `maskAllInputs: true`, strip query params on success page |

---

## Minor Issues (Implement During Development)

| # | Issue | Source |
|---|-------|--------|
| m1 | Bundle size estimate needs stress-testing | Arch (1.1) |
| m2 | Lazy-load StripePaymentForm within island | Arch (1.3) |
| m3 | Handle PaymentIntent `processing`/`requires_action` statuses | Arch (4.3) |
| m4 | sessionStorage try/catch for old iOS private browsing | Arch (5.1) |
| m5 | Horizontal scroll pills low discoverability — consider dropdown | UX (5a) |
| m6 | Filter out unavailable time slots by default | UX (5c) |
| m7 | Checkout creation timeout (10s with AbortController) | Arch (6.1) |
| m8 | Persistent error banner for network errors, not just toast | UX (7c) |

---

## Cross-Critic Agreement (High Confidence)

These findings were raised by 2+ critics independently, making them the highest-confidence issues:

1. **Payment Element timing** — Architecture and Security both identified the PaymentIntent creation timing as broken
2. **Webhook-based completion** — Security and Architecture both flagged the browser-dependent completion path as unreliable
3. **Checkout ID in return_url** — Architecture and Security both identified sessionStorage fragility for bank redirects
4. **Input validation** — Architecture and Security both noted the gap between client-side validation and backend enforcement
5. **Checkout ID validation** — Architecture and Security both noted the missing regex validation (inconsistent with cart pattern)

---

## Recommended Design Revision Order

1. Fix the Stripe PaymentIntent timing (Critical #1) — this changes the API flow diagram
2. Add express checkout section at top of page (Critical #4) — this changes the layout
3. Update success page to pass checkout_id in URL (Critical #3) — this changes the redirect flow
4. Add webhook requirement to design doc (Critical #2) — backend coordination needed
5. Add PATCH queue/debounce pattern (Critical #7) — this changes the state management section
6. Add CSP header requirement (Critical #6) — add to Section 12 modified files
7. Resolve HMAC signing question (Critical #8) — investigate before implementation
8. Add scroll-to-error + accessible error summary (Critical #5) — update Section 8
9. Revise order summary mobile behavior (Major M1) — update Section 3
10. Add form state persistence to sessionStorage (Major M2) — update Section 2
