# Proposal: Checkout Delivery API Improvements

**Date:** 2026-03-22
**Author:** William / Claude
**Status:** Draft

## Problem

The `PATCH /api/v1/checkout/{id}/delivery/` endpoint uses an opt-in partial update pattern where every field is guarded by `if field is not None`. This creates two classes of bugs:

1. **Silent no-ops.** If the frontend omits a field (e.g. `shipping_method_id`), the backend silently skips it. No error, no warning. The checkout appears to succeed but shipping cost is never calculated, the Payment Element never loads, and the user can't complete their order.

2. **Frontend knows too much.** The frontend must derive `shipping_method_id` from `$addressEligibility.availableFulfillmentTypes` and send it alongside `fulfillment_type`. This couples the frontend to an internal backend mapping (fulfillment type → shipping provider → price lookup) that the frontend shouldn't need to know about.

These issues caused multiple bugs during checkout development:

- Shipping cost never showing (missing `shipping_method_id`)
- Stripe Payment Element not loading (checkout stuck in `created` status because PATCH was missing fields)
- Pickup orders not advancing past `created` (contact fields not included for pickup)

## Proposed Changes

### 1. Auto-resolve shipping method from fulfillment type

When `fulfillment_type` is provided without `shipping_method_id`, the backend should resolve it automatically:

```python
# Current behavior (set_delivery)
if shipping_method_id is not None:
    method = lookup_shipping_method(shipping_method_id)
    checkout.shipping_cost = method["price"]

# Proposed behavior
if shipping_method_id is not None:
    method = lookup_shipping_method(shipping_method_id)
elif fulfillment_type is not None:
    method = resolve_default_method_for_type(fulfillment_type)
else:
    method = None

if method:
    checkout.shipping_method_id = method["id"]
    checkout.shipping_cost = method["price"]
```

This means:

- `fulfillment_type: "local_delivery"` → auto-selects the LocalDeliveryProvider, calculates cost
- `fulfillment_type: "pickup"` → auto-selects pickup, sets shipping cost to 0
- Explicit `shipping_method_id` still works (for future multi-provider support)

### 2. Validate required fields based on fulfillment type

Instead of silently skipping missing fields, return 400 errors for fields that are required given the context:

```python
# When fulfillment_type is "local_delivery":
#   Required: shipping_address (with at least postal_code, country_code)
#   Required: email
#
# When fulfillment_type is "pickup":
#   Required: email
#   Required: pickup_location_id (if multiple locations exist)
```

Example error response:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "shipping_address is required for local_delivery fulfillment",
    "fields": {
      "shipping_address": "Required when fulfillment_type is local_delivery"
    }
  }
}
```

### 3. Include derived fields in response

The delivery PATCH response should include all computed fields so the frontend doesn't need to guess what was applied:

```json
{
  "id": "chk_123",
  "status": "delivery_set",
  "fulfillment_type": "local_delivery",
  "shipping_method_id": "local_delivery",
  "shipping_cost": "5.00",
  "display_shipping_cost": "5.00",
  ...
}
```

## Impact on Frontend

With these changes, the frontend delivery PATCH simplifies from:

```typescript
// Current: frontend assembles everything
const deliveryData = {
  email: form.email,
  first_name: form.firstName,
  last_name: form.lastName,
  phone_number: form.phone,
  fulfillment_type: eligibility?.availableFulfillmentTypes?.find(
    (t) => t === 'local_delivery' || t === 'nationwide_delivery',
  ) ?? 'local_delivery',
  shipping_method_id: form.selectedShippingRateId ?? deliveryType,
  shipping_address: { ... },
};
```

To:

```typescript
// Proposed: frontend sends what it knows, backend derives the rest
const deliveryData = {
  email: form.email,
  first_name: form.firstName,
  last_name: form.lastName,
  phone_number: form.phone,
  fulfillment_type: form.fulfillmentMethod === 'pickup' ? 'pickup' : 'local_delivery',
  shipping_address: form.fulfillmentMethod === 'delivery' ? { ... } : undefined,
  pickup_location_id: form.fulfillmentMethod === 'pickup' ? form.pickupLocationId : undefined,
};
```

The `shipping_method_id` derivation, the `$addressEligibility` lookup, and the CLAUDE.md gotcha all go away.

## Migration

- **Backward compatible.** Explicit `shipping_method_id` still works. Only behavior change is: missing required fields now return 400 instead of silent skip.
- **Frontend can simplify immediately** after backend deploys — remove `shipping_method_id` derivation logic from `handleBlur` in `CheckoutPage.tsx`.
