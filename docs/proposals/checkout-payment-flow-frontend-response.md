# Frontend Response: Checkout Payment Flow Simplification

**Date:** 2026-03-22
**Author:** William / Frontend Team
**Status:** Draft
**In response to:** Backend counter-proposal "Checkout Payment Flow Simplification"

---

## Agreement

We accept the counter-proposal as written. The reasoning for dropping auto-PaymentIntent on delivery is sound — split payments, re-delivery amount mismatches, and domain separation are all real concerns we hadn't considered.

4 requests is a big improvement over 6 + 15 polls. We're happy to ship this.

---

## Answers to Open Questions

### 1. Loading state for confirm-payment

The success page already renders a spinner with "We're confirming your order..." (`confirmingOrder` i18n key) while waiting. This covers the 200ms–5s window naturally.

**On 502 (gateway unavailable):** Retry once automatically with the same spinner. If the retry also fails, fall back to the current "Payment received — your order is being processed" degraded state. We'll keep that UI as a safety net rather than removing it in Phase 2.

**Proposed behavior:**

| Confirm-payment result    | Frontend action                                                     |
| ------------------------- | ------------------------------------------------------------------- |
| 200 (completed)           | Show "Order confirmed!" + order number                              |
| 200 (already completed)   | Same — idempotent                                                   |
| 402 (declined)            | Show decline message, link back to checkout                         |
| 409 (requires_action)     | Re-trigger 3DS via `handleNextAction()`                             |
| 502 (gateway unavailable) | Auto-retry once → if still 502, show "payment received, processing" |
| Network error             | Same as 502                                                         |

### 2. 3DS retry flow

Stripe's client-side SDK handles this. When confirm-payment returns `payment_requires_action` (409), the frontend calls:

```typescript
const { error } = await stripe.handleNextAction({ clientSecret });
```

This re-triggers the 3DS challenge modal without a full page redirect. The `clientSecret` from the original `initiatePayment` call is sufficient — no additional data needed from the backend.

After the user completes 3DS, we call `POST /confirm-payment/` again. Since the endpoint is idempotent, this is safe even if the webhook fires in between.

**Flow:**

```
POST /confirm-payment/  → 409 requires_action
stripe.handleNextAction() → user completes 3DS
POST /confirm-payment/  → 200 completed
```

### 3. COD and Gifty-only checkouts

These already work and don't need changes. They use the non-redirect path in `handlePlaceOrder`:

```typescript
// No Stripe → complete directly via backend
const completed = await completeCheckout(checkout.id);
window.location.href = `/${lang}/checkout/success?order=${completed.order_number}`;
```

No redirect, no polling, no confirm-payment call needed. The success page receives the order number directly in the URL and clears the cart immediately.

---

## Frontend Migration Plan

### Phase 1: Gateway config in response

1. Read `available_payment_gateways` from `$checkout` store after delivery PATCH response
2. Remove the `GET /payment-gateways/` effect and its error handling
3. Extract Stripe config from `available_payment_gateways` array instead of dedicated fetch
4. Keep `GET /payment-gateways/` as fallback for 2 weeks (in case checkout response doesn't include gateways during rollout)

**Estimated diff:** ~40 lines removed from CheckoutPage.tsx payment gateway effect.

### Phase 2: Confirm-payment endpoint

1. Replace polling in CheckoutSuccess.tsx with single `POST /confirm-payment/` call
2. Add error handling for 402, 409, 502 responses
3. Add `handleNextAction()` for 3DS retry
4. Add single auto-retry on 502
5. Keep "payment received, processing" UI as final fallback (don't remove yet)

**Estimated diff:** ~30 lines removed (polling + timeout), ~25 lines added (confirm-payment + error handling). Net simpler.

### Phase 3: Cleanup (after 2 weeks stable)

1. Remove `GET /payment-gateways/` fallback
2. Remove polling fallback from CheckoutSuccess
3. Keep `paymentReceived`/`orderProcessing` i18n keys — they serve as the 502-retry-exhausted fallback
4. Remove `timedOut` state if we decide the 502 fallback uses a different mechanism

---

## One request

Could the `available_payment_gateways` field use the flat config object format (not the `[{key, value}]` array)? The current `GET /payment-gateways/` endpoint returns config as an array of `{key, value}` pairs, which requires client-side parsing:

```typescript
// Current — array of pairs, needs parsing
pk = cfg.find((c) => c.key === 'publishable_key')?.value ?? '';

// Preferred — flat object, direct access
pk = cfg.publishable_key ?? '';
```

Both formats are already handled in the frontend, so this isn't blocking — just a nice-to-have that would let us remove the array parsing branch.
