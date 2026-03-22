# Checkout Flow Optimization — Design Spec

**Date:** 2026-03-22
**Branch:** emdash/checkout-8al
**Status:** Approved (pending backend feasibility confirmation)
**Scope:** Full production-readiness pass — performance, reliability, maintainability, bug fixes

## Context

The checkout flow currently requires 4-5 sequential API round-trips between cart and payment form display. The main `CheckoutPage.tsx` is 749 lines handling form state, fulfillment logic, Stripe mounting, and payment confirmation. Several `as any` casts bypass SDK type safety, and error handling lacks user-facing recovery actions.

This spec covers a coordinated frontend + backend optimization. The backend agent (`storefront-backend` on `emdash/checkout-6w8`) has been notified via sous-agent-bus discussion #1.

## 1. API Optimizations

### 1a. New endpoint: `POST /checkout/{id}/prepare-payment/`

Merge the current two-step flow:

- Step A: Read `available_payment_gateways` from checkout GET response (only available after `delivery_set`)
- Step B: `POST /checkout/{id}/payment/` to create PaymentIntent and get `client_secret`

Into a single call returning:

```json
{
  "client_secret": "pi_xxx_secret_xxx",
  "payment_intent_id": "pi_xxx",
  "gateway_config": {
    "publishable_key": "pk_live_xxx",
    "stripe_account": "acct_xxx"
  }
}
```

**Impact:** Eliminates one sequential round-trip on the critical path (delivery_set → payment form visible).

**Payment method configuration:** The `prepare-payment` endpoint must create the PaymentIntent with the same `payment_method_types` as the current `POST /payment/` endpoint (iDEAL + card). The frontend relies on Stripe auto-detection from the PaymentIntent — no explicit `paymentMethodTypes` is passed to `elements()`. The backend must preserve this behavior when merging the two steps.

**Frontend change:** Replace `initiatePayment()` in `checkout-actions.ts` with `preparePayment()` that calls this endpoint. `CheckoutPaymentSection` watches for `delivery_set` and calls `preparePayment()` to get both gateway config and client_secret in one shot.

### 1b. Add `POST /checkout/{id}/confirm-payment/` to OpenAPI spec

This endpoint already exists on the backend but is missing from `openapi.storefront.v1.json`. The frontend currently uses `as any` casts in `CheckoutSuccess.tsx` (line 67) to call it.

Expected request:

```json
{
  "gateway_id": "stripe",
  "payment_intent": "pi_xxx",
  "payment_intent_client_secret": "pi_xxx_secret_xxx"
}
```

Expected response: Checkout object with `order_number` and `status`.

Known error codes used by frontend: `PAYMENT_NOT_CONFIRMED`, `GATEWAY_UNAVAILABLE`.

**Impact:** Type safety. No behavior change.

### 1c. Return `available_payment_gateways` eagerly on `POST /checkout/` (create)

Currently `available_payment_gateways` only appears after `delivery_set` status. If gateway config is merchant-level (not delivery-dependent), include it in the initial checkout creation response.

**Impact:** Frontend can call `loadStripe(publishableKey, { stripeAccount })` immediately on checkout creation, preloading Stripe.js while the user fills out the form. Saves ~1-2s of perceived latency.

**Dependency:** Requires backend confirmation that gateway config doesn't vary by delivery details (e.g., different gateways per country). Discussion #1 on the agent bus.

## 2. Frontend Architecture — Component Decomposition

Split the 749-line `CheckoutPage.tsx` into focused components:

### CheckoutPage.tsx (~150 lines) — Orchestrator

- Mounts sub-components, reads stores, handles top-level guards (empty cart redirect, hydration)
- Owns the `useReducer` form state and passes `dispatch` down
- No direct API calls — delegates to child components and the checkout store

### CheckoutPaymentSection.tsx (new, ~120 lines)

- Extracts Stripe payment mounting logic (the `delivery_set` watcher + Payment Element render block)
- Watches for `delivery_set` status → calls `preparePayment()` (new merged endpoint)
- Manages `stripeConfig` state locally — parent doesn't need to know about `client_secret`
- Sets a `$stripePayment` nanostore atom (`{ stripe, elements, clientSecret }`) so `CheckoutPlaceOrder` can read it without prop drilling
- Handles Stripe preload if gateway config available from checkout creation (proposal 1c)
- Must include the `mountedRef` strict-mode guard (same pattern as `StripePaymentForm`) to prevent double-initialization

### CheckoutFormOrchestrator.tsx (new, ~100 lines)

- Extracts the blur → validate → PATCH cycle (the `handleBlur` + validation + auto-PATCH-on-fulfillment-change logic)
- Owns `handleBlur`, `validateFieldsForPatch`, and the auto-PATCH effect
- Wraps ContactForm, FulfillmentToggle, DeliveryAddressForm, PickupLocationPicker
- Calls `cancelPendingPatch()` on unmount cleanup
- Maps `CheckoutFormState.fulfillmentMethod` (`'delivery' | 'pickup'`) to API `fulfillment_type` (`'local_delivery' | 'pickup'`) when assembling the PATCH body — this is the single location for that mapping

### CheckoutPlaceOrder.tsx (new, ~80 lines)

- Extracts `handlePlaceOrder` + `validateForm` (the form validation + Stripe confirm + complete-checkout logic)
- Reads Stripe instances from the `$stripePayment` nanostore atom (set by `CheckoutPaymentSection`)
- Renders both desktop and mobile place-order buttons
- On error: scrolls to error banner + brief button shake animation

### Existing sub-components (unchanged)

ContactForm, DeliveryAddressForm, FulfillmentToggle, SchedulingPicker, PickupLocationPicker, OrderSummary, CheckoutHeader, FormDivider, PrivacyNotice, PlaceOrderButton, ExpressCheckout — these are already well-scoped.

### Why not XState?

XState adds ~12KB min-gzipped, significant against the 65KB bundle budget. The existing `CheckoutStatus` type (`created → delivery_set → shipping_pending → paid → completed`) already acts as a lightweight state machine. The refactor enforces transitions more explicitly in the orchestrator rather than scattering status checks across effects.

## 3. Reliability & Bug Fixes

### 3a. Eliminate `as any` SDK path casts

| Location               | Cast                      | Fix                                                                      |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------ |
| `CheckoutSuccess:67`   | `confirmUrl as any`       | Backend adds `confirm-payment` to OpenAPI spec (1b) → SDK regeneration   |
| `checkout-actions:207` | `initiatePayment` body    | Replaced by `preparePayment` using new endpoint (1a)                     |
| `checkout-actions:239` | `completeCheckout` params | Verify SDK types — likely fixable with correct path literal              |
| `checkout-actions:94`  | `patchDelivery` opts      | Keep — `opts` shape bridging, not a path cast (acceptable per CLAUDE.md) |
| `CheckoutPage:177`     | pickup-locations URL      | Use SDK path literal if in spec, else request backend add to spec        |
| `CheckoutPage:265`     | time-slots URL            | Use SDK path literal with params, else request backend add to spec       |

### 3b. SessionStorage resilience

Current: silent `catch` blocks log warnings but give no user feedback. If sessionStorage is unavailable (Safari private browsing, quota exceeded), checkout silently loses state on refresh.

**Fix:** Add a `$storageAvailable` atom checked once on mount. If unavailable, show a non-blocking toast using the i18n key `storageUnavailable` (add translations for nl/en/de). Form still works — just no persistence.

### 3c. Debounce cleanup on unmount

Current: if the component unmounts mid-debounce, the timer fires into a detached scope.

**Fix:** Export `cancelPendingPatch()` from `checkout-actions.ts`. Call it in `CheckoutFormOrchestrator`'s cleanup effect.

### 3d. SDK-derived Checkout type

Five instances of `data as unknown as Checkout` in checkout-actions exist because the SDK response type doesn't exactly match the local `Checkout` interface.

**Fix:** After SDK regeneration, derive the `Checkout` type from the SDK response type:

```typescript
type Checkout =
  paths['/api/v1/checkout/{checkout_id}/']['get']['responses']['200']['content']['application/json'];
```

The local interface becomes a type alias, not a separate shape.

## 4. Error Handling & UX Improvements

### 4a. Structured error recovery

| Error type                     | Current UX                    | Proposed UX                                                      |
| ------------------------------ | ----------------------------- | ---------------------------------------------------------------- |
| Validation error (field-level) | Red banner + field highlights | Same (already good)                                              |
| Payment init failed            | Red banner                    | Banner + "Retry" button that re-calls `preparePayment`           |
| Stripe load error              | Logged, no user feedback      | Inline message in payment section + "Retry" button               |
| Network error during PATCH     | Red banner                    | Auto-retry once (silent), then banner + "Retry"                  |
| Stale checkout (cart changed)  | Page reload                   | Toast "Your cart was updated" + re-create checkout automatically |

### 4b. Stripe.js preloading

If backend returns `available_payment_gateways` on checkout creation (proposal 1c), call `loadStripe(publishableKey, { stripeAccount })` immediately. The actual Payment Element still mounts after `preparePayment` returns, but Stripe.js is already cached. Turns ~1-2s sequential load into a parallel one.

### 4c. Place order error feedback

On error: briefly shake the button and scroll to the error banner. Prevents mobile users from missing the error when the banner is off-screen.

## 5. Testing Strategy

### 5a. Unit tests (Vitest)

- **`checkout-actions.test.ts`** — Update for `preparePayment` endpoint, add `cancelPendingPatch()` test, test auto-retry logic
- **`checkout.test.ts`** — Add `$storageAvailable` atom test
- **`CheckoutPaymentSection.test.tsx`** (new) — Stripe config lifecycle: mounts on `delivery_set`, handles `preparePayment` failure with retry, cleanup on unmount
- **`CheckoutFormOrchestrator.test.tsx`** (new) — Blur → validate → PATCH cycle, debounce cancellation on unmount, fulfillment method change triggers PATCH
- **`CheckoutPlaceOrder.test.tsx`** (new) — Form validation, submit flow, error scroll behavior

### 5b. E2E tests (Playwright)

- **`checkout-flow.spec.ts`** — Update mock API to serve `prepare-payment` instead of separate `payment-gateways` + `payment` calls
- **`checkout.spec.ts`** — Add test for storage-unavailable toast
- **`checkout-recovery.spec.ts`** (new) — Payment retry after failure, stale cart re-creation, network error auto-retry

### 5c. Contract tests

- **`contract.spec.ts`** — Add schemas for `prepare-payment` request/response and `confirm-payment` request/response once backend updates the OpenAPI spec

### 5d. Mock API updates

`e2e/helpers/mock-api.ts` changes:

- New `POST /checkout/{id}/prepare-payment/` handler returning `client_secret` + `gateway_config`
- Updated `POST /checkout/` to include `available_payment_gateways` in response
- `POST /checkout/{id}/confirm-payment/` handler (typed, replacing ad-hoc mock)
- Remove old `GET /checkout/{id}/payment-gateways/` handler once fully migrated

## 6. Migration & Deployment

### Strategy: Coordinated release (big bang)

No backwards compatibility layer needed. Both frontend and backend deploy together.

### Deployment order

1. Backend merges: new `prepare-payment` endpoint, `confirm-payment` in spec, eager gateway config
2. Backend CI publishes updated `openapi.storefront.v1.json` → triggers SDK regeneration → new `@poweredbysous/storefront-sdk` version published to registry
3. Frontend PR updates SDK dep (`pnpm update @poweredbysous/storefront-sdk`). **CI gate:** `pnpm check` must pass with the new SDK, confirming all new endpoints are typed. Do not merge until the SDK version includes the new endpoints.
4. Coordinated deploy: backend + frontend deploy together (same release window)
5. (Optional cleanup) Backend removes old `POST /payment/` endpoint in a follow-up

**SDK ownership:** The backend team owns SDK regeneration. Frontend blocks on the published SDK version before merging.

### Rollback plan

Revert frontend to previous version — the old endpoints still exist on the backend. Safe rollback window without feature flags.

### Bundle size

Component decomposition adds no new dependencies. Splitting CheckoutPage into smaller files may slightly improve tree-shaking. `pnpm size:check` must pass before merging (65KB gzipped budget).

## Open Questions (pending backend response)

1. Does gateway config depend on delivery details? (Affects proposal 1c feasibility)
2. Can `pickup-locations` and `fulfillment/locations/{id}/slots/` be added to the OpenAPI spec? (Affects `as any` cast elimination)
3. Backend timeline for these changes?

## Artifacts

- Agent bus discussion #1: `#sous-agents` Slack thread
- Artifact key: `storefront-frontend:checkout-api-proposal-2026-03-22`
