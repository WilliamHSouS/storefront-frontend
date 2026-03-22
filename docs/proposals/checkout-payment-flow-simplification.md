# Proposal: Checkout Payment Flow Simplification

**Date:** 2026-03-22
**Author:** William / Claude
**Status:** Draft

## Problem

The checkout payment flow requires the frontend to orchestrate multiple sequential API calls with no error feedback between steps. When any step fails silently, the entire flow breaks in ways that are difficult to diagnose.

### Current flow (6 requests, 3 potential silent failures)

```
1. PATCH  /checkout/{id}/delivery/           → status: delivery_set
2. GET    /checkout/{id}/payment-gateways/   → find Stripe config (pk, account)
3. POST   /checkout/{id}/payment/            → get client_secret
4. [Mount Stripe Payment Element]
5. [User pays → Stripe redirects for iDEAL]
6. GET    /checkout/{id}/                    → poll every 2s for up to 30s
   GET    /checkout/{id}/                    → ...waiting for webhook...
   GET    /checkout/{id}/                    → ...still waiting...
```

**Silent failure points:**

- Step 2: If gateway fetch fails or returns unexpected format → no Payment Element, no error shown
- Step 3: If `initiatePayment` fails → no `client_secret`, Payment Element never mounts
- Step 6: If webhook is slow → 30s timeout, degraded UX ("payment received" instead of "order confirmed"), no order number

## Proposed Changes

### 1. Include payment config in delivery PATCH response

When the delivery PATCH transitions status to `delivery_set`, the backend already knows which payment gateways are available. Include them in the response:

```json
{
  "id": "chk_123",
  "status": "delivery_set",
  "shipping_cost": "5.00",
  "payment_gateways": [
    {
      "id": "stripe",
      "publishable_key": "pk_live_...",
      "stripe_account": "acct_..."
    }
  ]
}
```

This eliminates step 2 entirely. The frontend gets everything it needs from the delivery PATCH response.

### 2. Combine payment initiation with delivery

Take it further: auto-initiate the PaymentIntent when transitioning to `delivery_set`, and include the `client_secret` in the response:

```json
{
  "id": "chk_123",
  "status": "delivery_set",
  "shipping_cost": "5.00",
  "payment": {
    "gateway": "stripe",
    "publishable_key": "pk_live_...",
    "stripe_account": "acct_...",
    "client_secret": "pi_xxx_secret_xxx"
  }
}
```

This collapses steps 1–3 into a single request. The frontend PATCHes delivery details and gets back everything needed to mount the Stripe Payment Element.

**Consideration:** PaymentIntent amount must match the checkout total. If the delivery PATCH changes the total (e.g. shipping cost), the PaymentIntent should reflect the final amount. Since the backend calculates both in the same request, this is naturally consistent.

### 3. Synchronous redirect confirmation endpoint

**New endpoint:** `POST /api/v1/checkout/{id}/confirm-redirect/`

**Request:**

```json
{
  "payment_intent": "pi_xxx",
  "payment_intent_client_secret": "pi_xxx_secret_xxx"
}
```

**Backend logic:**

1. Call `stripe.PaymentIntent.retrieve(payment_intent)` synchronously
2. Verify payment status is `succeeded`
3. Verify the PaymentIntent belongs to this checkout
4. Complete the checkout (same logic as webhook handler)
5. Return the completed checkout with order number

**Response:**

```json
{
  "id": "chk_123",
  "status": "completed",
  "order_number": "ORD-12345"
}
```

**Why this is better than polling:**

|                    | Current (polling)            | Proposed (confirm-redirect) |
| ------------------ | ---------------------------- | --------------------------- |
| Requests           | 1–15 polls over 30s          | 1 request                   |
| Latency            | 2s minimum (poll interval)   | ~200ms (Stripe API call)    |
| Reliability        | Depends on webhook timing    | Synchronous verification    |
| UX on slow webhook | Degraded "payment received"  | Always shows order number   |
| Server load        | 15 GET requests per checkout | 1 POST request              |

**Idempotency:** The endpoint should be idempotent — if the checkout is already completed, return the existing order number. This handles browser refresh or double-submit safely.

**Security:** Validate that the `payment_intent_client_secret` matches the stored PaymentIntent for this checkout. This prevents a malicious client from completing someone else's checkout.

## Impact on Frontend

### Before (CheckoutSuccess.tsx)

```typescript
// Parse URL params from Stripe redirect
const checkoutId = params.get('checkout_id');
const paymentIntent = params.get('payment_intent');

// Poll every 2s for up to 30s
const pollInterval = setInterval(async () => {
  const { data } = await sdk.GET(`/checkout/${checkoutId}/`);
  if (data?.status === 'completed') {
    clearInterval(pollInterval);
    clearCart();
    setOrderNumber(data.order_number);
  }
}, 2000);

// Timeout: show degraded message
setTimeout(() => {
  clearInterval(pollInterval);
  clearCart();
  setTimedOut(true); // "Payment received, order processing..."
}, 30_000);
```

### After

```typescript
// Parse URL params from Stripe redirect
const checkoutId = params.get('checkout_id');
const paymentIntent = params.get('payment_intent');
const clientSecret = params.get('payment_intent_client_secret');

// Single synchronous call
const { data } = await sdk.POST(`/checkout/${checkoutId}/confirm-redirect/`, {
  body: { payment_intent: paymentIntent, payment_intent_client_secret: clientSecret },
});

clearCart();
setOrderNumber(data.order_number);
```

No polling. No timeout. No degraded state. No `timedOut` flag. No `paymentReceived`/`orderProcessing` i18n keys.

### Before (CheckoutPage.tsx — payment setup)

```typescript
// Effect 1: Wait for delivery_set, fetch gateways
// Effect 2: Find Stripe gateway, extract config
// Effect 3: Initiate payment, get client_secret
// Effect 4: Set stripeConfig, mount Payment Element
```

### After

```typescript
// delivery PATCH response includes payment config
if (checkout.payment?.client_secret) {
  setStripeConfig({
    clientSecret: checkout.payment.client_secret,
    publishableKey: checkout.payment.publishable_key,
    stripeAccount: checkout.payment.stripe_account,
  });
}
```

One response handler instead of a chain of four effects.

## Migration

### Change 1 (payment config in response)

- **Backward compatible.** New fields in the delivery PATCH response. Frontend can read them or ignore them.
- Frontend removes gateway fetch effect and `initiatePayment` call once backend deploys.

### Change 2 (confirm-redirect endpoint)

- **New endpoint.** No breaking changes.
- Frontend switches from polling to single POST. The poll logic can be kept as a fallback during rollout.
- The `paymentReceived`/`orderProcessing` i18n keys and `timedOut` state become dead code after full rollout.

### Change 3 (webhook still works)

- The existing Stripe webhook handler should remain as a safety net. If the frontend never calls confirm-redirect (e.g. user closes browser mid-redirect), the webhook still completes the checkout.
