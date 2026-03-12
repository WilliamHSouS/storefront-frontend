# Frontend Design: Delivery Options & Address-Based Fulfillment

**Date:** 2026-03-10
**Status:** Approved (post-debate revision)
**Backend PRD:** `storefront_backend/docs/plans/delivery-options-prd.md` (v2.1)
**Backend Plan:** `storefront_backend/docs/plans/2025-03-10-delivery-options-phase1.md`

---

## 1. Overview

The frontend implements a stateless address-aware delivery flow. The customer's location context (postcode to lat/lng) is held client-side in a nanostore and passed as query parameters to the backend. No server-side session is required.

The address input is always available in the header but never required to browse. Entering a postcode shows fulfillment badges on restricted items, displays shipping cost estimates in the cart, and enables delivery time slot selection before checkout.

### Design Principles

- **Stateless:** Frontend holds lat/lng, passes as query params. No cross-origin cookie complexity.
- **Progressive disclosure:** No clutter when browsing without an address. Badges and banners appear only when relevant.
- **Never empty:** Filtering reduces the catalog but never empties it. Pickup and nationwide items always show.
- **Partial estimates over no estimates:** Fixed-price shipping shows immediately; live-quote providers show "pending" until integrated, "unavailable" when down.
- **Server-rendered products stay server-rendered:** Product cards are Astro server components. Address-based changes (badges, visibility) are applied via DOM manipulation from a single Preact island, not by re-rendering product cards client-side.

### Known Limitations

**Postcode centroid precision:** The backend geocodes postcodes to their centroid. Dutch postcodes cover ~2-4 km, so a customer at a zone boundary could be ~500m-1km from the centroid. This means ~10-20% error margin on a 5km delivery radius. The postcode check is a best-effort pre-filter; the checkout flow (which collects full street address) is the true eligibility gate. Some false positives and negatives are expected at zone edges.

---

## 2. Architecture

### New Nanostores

```typescript
// src/stores/address.ts
import { atom } from 'nanostores';

// Stable coordinates — persisted to localStorage
interface AddressCoords {
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
}

// Volatile eligibility data — re-fetched on each page load
interface AddressEligibility {
  availableFulfillmentTypes: ('local_delivery' | 'pickup' | 'nationwide_delivery')[];
  availableShippingProviders: Array<{
    id: number;
    name: string;
    type: string;
  }>;
  pickupLocations: Array<{
    id: number;
    name: string;
    distance_km: number;
  }>;
  deliverySlots: Record<string, Array<{
    start: string;
    end: string;
    available: boolean;
    remaining_capacity?: number;
  }>>;
  deliveryUnavailable: boolean;
  nearDeliveryZone: boolean;
  nearestPickupLocation?: {
    name: string;
    distance_km: number;
  };
}

export const $addressCoords = atom<AddressCoords | null>(null);
export const $addressEligibility = atom<AddressEligibility | null>(null);

// src/stores/delivery.ts
export const $selectedSlots = atom<Map<string, { start: string; end: string } | 'asap'>>(new Map());
```

Splitting address state into two atoms prevents unnecessary re-renders: components that only need lat/lng (product filtering, cart estimates) subscribe to `$addressCoords`; components that need fulfillment details (banners, delivery options sheet) subscribe to `$addressEligibility`.

### New Interactive Components (Preact Islands)

| Component | Location | Hydration |
|-----------|----------|-----------|
| `AddressBar` | Header | `client:idle` |
| `FulfillmentOverlay` | BaseLayout (single instance) | `client:idle` |
| `DeliveryOptionsSheet` | BaseLayout | `client:idle` |
| `ShippingEstimate` | CartDrawer | `client:idle` |
| `DeliveryBanner` | BaseLayout (below header) | `client:idle` |

### Modified Components

| Component | Change |
|-----------|--------|
| `Header` | Mounts `AddressBar` island |
| `CartDrawer` | Adds `ShippingEstimate` in totals, routes checkout through `DeliveryOptionsSheet` when slots exist |
| `ProductCard` (Astro) | Adds `data-product-id` attribute (already exists) and `data-fulfillment-badge` slot element |
| `BaseLayout.astro` | Mounts `FulfillmentOverlay`, `DeliveryOptionsSheet`, and `DeliveryBanner` shared islands |

**Key decision: No `window.__PRODUCTS__` hydration.** Product cards remain server-rendered Astro components. The `FulfillmentOverlay` island handles all address-dependent product UI (badges, visibility toggling) via DOM manipulation targeting `[data-product-id]` elements. This avoids converting `MenuSection`/`ProductCard` to Preact islands, avoids duplicating product data in an inline JSON blob, and avoids 40-80 individual `FulfillmentBadge` island hydrations.

### Address Change Orchestrator

When `$addressCoords` changes, a single `onAddressChange()` function coordinates all side effects in sequence (modeled after the existing `ensureCart()` promise-lock pattern in `src/stores/cart.ts`):

```typescript
// src/stores/address-actions.ts
let pendingAddressChange: Promise<void> | null = null;

export async function onAddressChange(coords: AddressCoords | null): Promise<void> {
  if (pendingAddressChange) await pendingAddressChange;

  pendingAddressChange = (async () => {
    $addressCoords.set(coords);

    if (!coords) {
      $addressEligibility.set(null);
      // Restore full catalog visibility via FulfillmentOverlay
      return;
    }

    // 1. Fetch fulfillment metadata (badges + visibility)
    const metadata = await fetchFulfillmentMetadata(coords);
    // FulfillmentOverlay reacts to this and updates DOM

    // 2. Re-fetch cart with coordinates (if cart exists)
    const cartId = getStoredCartId();
    if (cartId) {
      await refreshCartWithCoords(cartId, coords);
    }
  })();

  await pendingAddressChange;
  pendingAddressChange = null;
}
```

This eliminates race conditions between fulfillment metadata and cart re-fetches.

---

## 3. Address Bar

`AddressBar` lives in the header, right of the logo and left of the cart badge.

### Compact State (default)

- Location pin icon + "Enter postcode" placeholder, or the postcode if set ("1015 BS")
- Tap expands to input mode
- If address is set, a small "x" clears it and resets `$addressCoords` to null

### Expanded State

- Text input for postcode
- Country selector defaulting to merchant's country (derived from language: nl -> NL, de -> DE)
- "Check" button submits to `POST /api/v1/fulfillment/address-check/` with `{ postal_code, country }`
- Loading spinner during API call
- On success: stores coords in `$addressCoords`, eligibility in `$addressEligibility`, collapses to compact state
- On error: differentiated error messages (see Error Handling below)

### Error Handling

| Error | Message | Behavior |
|-------|---------|----------|
| 404 (postcode not found) | "Postcode not found" | Stay expanded, clear input |
| 500 / geocoding service down | "Something went wrong. Try again." | Stay expanded, show retry |
| Network timeout | "Connection problem. Check your internet." | Stay expanded, show retry |

On any error, `$addressCoords` is not updated. If a previous address was set, it remains active.

### Persistence

- Only `{ postalCode, country, latitude, longitude, storedAt }` persisted to `localStorage` (key: `sous_address`)
- 7-day TTL: on page load, if `storedAt` is older than 7 days, clear and let the customer start fresh
- On page load with valid stored coords: hydrate `$addressCoords` immediately, then fire a background `POST /api/v1/fulfillment/address-check/` to refresh volatile eligibility data (slots, providers, pickup locations)
- For authenticated customers: fetch `GET /api/v1/addresses/default/` and pre-fill if no localStorage address

### Accessibility

- Compact state: `<button>` with `aria-expanded="false"`, `aria-label="Enter your postcode for delivery options"`
- Expanded state: `aria-expanded="true"`, input has `aria-label="Postcode"`, focus moves to input on expand
- Clear button: `aria-label="Clear postcode"`
- Error messages: `role="alert"` for screen reader announcement

---

## 4. Product Filtering & Fulfillment Badges

### FulfillmentOverlay (Single Island Approach)

Instead of mounting a `FulfillmentBadge` island on every `ProductCard`, a single `FulfillmentOverlay` island is mounted once in `BaseLayout`. When `$addressCoords` changes, it:

1. Fetches lightweight fulfillment metadata from the product listing endpoints with `?latitude={lat}&longitude={lng}` — specifically the `available_fulfillment_types` per product
2. Iterates over `[data-product-id]` DOM elements and:
   - Toggles a `data-fulfillment` attribute with the product's fulfillment status
   - Injects badge HTML into the `[data-fulfillment-badge]` slot element
   - Adds a `hidden` class to products filtered out (not deliverable, not pickup, not nationwide)
3. When `$addressCoords` is cleared, removes all badges and `hidden` classes

This approach: one island, one nanostore subscription, DOM manipulation for badges. No Astro component rewrites, no `window.__PRODUCTS__` blob, no per-card island proliferation.

### Badge Logic (Contextual, Restriction-Only)

Badges only appear when an address is set, and only on products with limited fulfillment. The majority of products (available for local delivery) show no badge.

| Scenario | Badge | Style |
|----------|-------|-------|
| No address set | No badges | -- |
| Address set, product available for local delivery | No badge | -- |
| Address set, product is pickup only | "Pickup only" | Muted pill, store icon |
| Address set, product ships nationwide only | "Ships separately" | Muted pill, package icon |

Badges also render in `ProductDetail` modal — the modal reads the `data-fulfillment` attribute from the triggering product card.

### Loading State During Filtering

When `$addressCoords` changes and the fulfillment metadata is being fetched:

- Product cards remain visible (no skeleton/spinner)
- A subtle loading indicator appears on the `AddressBar` (the postcode text pulses or shows a small spinner)
- When metadata arrives, badges and visibility changes are applied in a single DOM update batch
- If the fetch fails, products remain unfiltered (full catalog) and the `DeliveryBanner` shows an error state

### Handling Filtered-Out Products

When products are hidden (CSS `hidden` class), entire `MenuSection` containers that become empty also get hidden. This is handled by the `FulfillmentOverlay` checking if any visible `[data-product-id]` remain within each `[data-menu-section]` container. Section collapse is instant (no animation) to avoid layout jank.

---

## 5. Cart Shipping Estimate

### Location

Sits in the totals section of `CartDrawer`, between subtotal and order total. Renders as a single collapsible line.

### States

| Cart state | Display |
|------------|---------|
| No address set | "Add your postcode for shipping costs" (link opens AddressBar) |
| Single group, calculated | "Shipping: X" (single line, no expand) |
| Single group, quoted | "Shipping: X" (single line) |
| Single group, pending | "Shipping: calculated at checkout" (muted) |
| Single group, unavailable | "Shipping: temporarily unavailable" (muted) |
| Multiple groups | "Shipping: X" (expandable to per-group breakdown) |
| `ships_in_parts: true` | Auto-expanded with per-group lines |

### Per-Group Expanded View

```
Local delivery        €3.50
  Burger, Caesar Salad
Nationwide shipping   €6.95
  Truffle Oil
```

### Undeliverable Cart Items

When the cart is re-fetched with coordinates and an item does not appear in any shipping group, that item is flagged in the cart drawer:

- Warning badge on the line item: "Not available for delivery"
- Message below the item: "Available for pickup at {location}" or "Remove from cart"
- The item is excluded from the shipping estimate total
- Checkout is not blocked — the customer can keep the item (for pickup) or remove it

This handles the scenario where a customer browses without an address, adds items, then enters a postcode that makes some items undeliverable.

### Data Flow

- When `$cart` or `$addressCoords` changes, cart fetch includes `?latitude={lat}&longitude={lng}`
- Backend returns `shipping_estimate` on the cart response
- `ShippingEstimate` component reads from `$cart`
- Order total line shows `estimated_total` when shipping is included, or subtotal with "excluding shipping" note when estimate is null/pending

---

## 6. Delivery Options Sheet

A half-sheet modal that appears between cart and checkout for delivery time slot selection.

### Trigger

Customer taps "Checkout" in CartDrawer. The sheet opens when ALL of these are true:
- `$addressCoords` is set
- Delivery slots exist for at least one shipping group
- Cart has more than one shipping group, OR slots are available beyond just ASAP

For the common case (single group, ASAP only), the sheet is skipped entirely — the customer proceeds straight to checkout.

### Skip Conditions

- No address set: proceed directly to checkout
- Single shipping group with only ASAP available: skip sheet
- No delivery slots available for any group: skip sheet
- Cart contains only pickup items: skip sheet

### Layout

```
------------------------------
  Delivery options

  [pin] 1015 BS  [Change]

  -- Local delivery ----------
  Uber Direct . €3.50

  o ASAP (~30 min)
  o 12:00 - 12:30
  o 12:30 - 13:00
  * 13:00 - 13:30
  o 13:30 - 14:00

  -- Nationwide shipping -----
  SooCool . €6.95
  Estimated delivery: 2-3 days

  ----------------------------
  Subtotal          €25.00
  Shipping          €10.45
  Total             €35.45

  [ Continue to checkout ]
------------------------------
```

### Behavior

- Each shipping group shows provider name, cost, and slot picker (if slots available)
- ASAP selected by default for local delivery groups
- Selecting a slot updates `$selectedSlots` and may re-fetch the quote (live-quote providers can vary by time)
- Nationwide/fixed-price groups show estimated delivery time, no slot picker
- "Change" on the address opens the AddressBar; if address changes, slots and costs refresh
- `estimated_minutes` from the quote shows as "~30 min" next to ASAP

### Price Change Handling (FR-039)

If continuing to checkout returns a 409 (quote delta > €0.50 or 10%), the sheet stays open with an updated price and a message: "Delivery cost updated to €X. Continue?" Customer confirms or cancels. Maximum 2 retries — after 2 consecutive price changes, show "Delivery pricing is changing rapidly. Continue to checkout to lock in the current price." and proceed regardless.

### Error Recovery

- Network failure during slot refresh: show "Couldn't load delivery options. [Retry] or [Skip to checkout]"
- Back button / swipe dismiss: closes sheet, returns to cart drawer (checkout not initiated)
- The sheet never blocks the customer from reaching checkout — every error state has an escape path

### Accessibility

- `role="dialog"` with `aria-modal="true"` and `aria-label="Delivery options"`
- Focus trapped within the sheet while open
- First focusable element (ASAP radio) receives focus on open
- Escape key closes the sheet
- Slot options are radio buttons within a `radiogroup` per shipping group

---

## 7. Delivery Banner & Empty States

`DeliveryBanner` renders inline between the header and menu content. Only appears when `$addressEligibility` is set and includes restrictions.

### Banner Variants

| Condition | Message | Action |
|-----------|---------|--------|
| `delivery_unavailable` | "Delivery isn't available to your area. Pickup available at {name} ({distance} km)" | -- |
| `delivery_unavailable` + `near_delivery_zone` | "You're just outside the delivery area. Pickup available at {name} ({distance} km)" | -- |
| Products filtered (some hidden) | "Showing items available for delivery to {postalCode}" | [Clear] to show full menu |
| Address set, all products available | "Delivering to {postalCode}" | [Change] |

### Styling

Muted background using merchant theme's `muted` HSL token. Single line with optional action link. Non-dismissible when address is set — acts as persistent context indicator so the customer always knows filtering is active. This replaces the previous dismissible banner approach; a persistent context bar prevents the "where did my products go?" confusion.

### Showing the Full Menu

To see the unfiltered catalog, the customer clears their address via the "x" on the AddressBar or the [Clear] action in the banner. This removes all filtering, badges, and shipping estimates. The "Show full menu" toggle has been removed to reduce complexity — clearing the address achieves the same result without a third state.

### No Address Set

No banner. Full catalog shown. No badges. Default browsing experience is clean and uncluttered.

### Accessibility

- Banner uses `role="status"` for screen reader announcement when it appears
- Action links are keyboard-focusable

---

## 8. Analytics Events

All events fire via PostHog. PII guard: postal codes truncated to first 4 characters.

### Launch Events (ship with Phase 1)

| Event | Trigger | Properties |
|-------|---------|------------|
| `address_entered` | Address-check returns successfully | `postal_code_prefix`, `country`, `available_fulfillment_types[]`, `has_local_delivery`, `has_pickup` |
| `delivery_unavailable` | No local delivery for address | `postal_code_prefix`, `country`, `nearest_pickup_distance_km`, `near_delivery_zone` |
| `delivery_options_completed` | "Continue to checkout" tapped (or sheet skipped) | `group_count`, `total_shipping`, `has_selected_slot` |

### Post-Launch Events (add when flows stabilize)

| Event | Trigger | Properties |
|-------|---------|------------|
| `products_filtered` | Products updated after filtering | `total_products`, `visible_products`, `filtered_out_count` |
| `shipping_estimate_shown` | Estimate rendered in cart | `total_shipping`, `group_count`, `has_pending_groups` |
| `delivery_slot_selected` | Slot picked | `provider_type`, `is_asap`, `slot_start`, `slot_end` |
| `shipping_price_changed` | 409 received, new price shown | `provider_name`, `old_price`, `new_price`, `customer_accepted` |

### Funnel

```
page_view -> address_entered -> cart_opened
  -> shipping_estimate_shown -> delivery_options_completed
  -> checkout_started -> payment_completed
```

---

## 9. New i18n Keys

Keys needed across `en`, `nl`, `de`:

```
enterPostcode              "Enter postcode"
checkAddress               "Check"
postcodeNotFound           "Postcode not found"
somethingWentWrong         "Something went wrong. Try again."
connectionProblem          "Connection problem. Check your internet."
addPostcodeForShipping     "Add your postcode for shipping costs"
shippingEstimate           "Shipping"
shippingAtCheckout         "Calculated at checkout"
shippingUnavailable        "Temporarily unavailable"
pickupOnly                 "Pickup only"
shipsSeparately            "Ships separately"
notAvailableDelivery       "Not available for delivery"
availableForPickup         "Available for pickup at {name}"
deliveryUnavailable        "Delivery isn't available to your area"
nearDeliveryZone           "You're just outside the delivery area"
pickupAvailableAt          "Pickup available at {name} ({distance} km)"
deliveringTo               "Delivering to {postalCode}"
showingItemsFor            "Showing items available for delivery to {postalCode}"
deliveryOptions            "Delivery options"
changeAddress              "Change"
clearAddress               "Clear"
asap                       "ASAP"
estimatedMinutes           "~{minutes} min"
estimatedDelivery          "Estimated delivery: {days}"
continueToCheckout         "Continue to checkout"
skipToCheckout             "Skip to checkout"
deliveryCostUpdated        "Delivery cost updated to {amount}"
deliveryPricingChanging    "Delivery pricing is changing rapidly"
localDelivery              "Local delivery"
nationwideShipping         "Nationwide shipping"
selfDelivery               "Delivery"
couldntLoadDelivery        "Couldn't load delivery options"
retry                      "Retry"
removeFromCart              "Remove from cart"
```

---

## 10. Bundle Budget Impact

Current budget: 65 KB gzipped.

| Addition | Estimated Size |
|----------|---------------|
| `AddressBar` island | ~2 KB |
| `$addressCoords` + `$addressEligibility` + `$selectedSlots` stores | ~1 KB |
| `onAddressChange()` orchestrator + fetch logic | ~1.5 KB |
| `ShippingEstimate` component | ~1.5 KB |
| `DeliveryOptionsSheet` component | ~3 KB |
| `DeliveryBanner` component | ~1 KB |
| `FulfillmentOverlay` island (single instance, DOM manipulation) | ~2 KB |
| i18n key additions | ~1 KB |
| Analytics event helpers | ~0.5 KB |
| **Total estimated addition** | **~13.5 KB** |

No external dependencies added (no Google Maps/Places). The `FulfillmentOverlay` approach avoids per-card island overhead — one island instead of 40-80 `FulfillmentBadge` instances. Run `pnpm size:check` during implementation to validate against actual bundle.

---

## 11. API Endpoints Used

### New Endpoints (from backend)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/v1/fulfillment/address-check/` | Geocode postcode, return eligibility + slots |
| `GET` | `/api/v1/addresses/default/` | Authenticated user's saved address |

### Modified Endpoints (existing, with new query params)

| Method | Path | New Params | Purpose |
|--------|------|------------|---------|
| `GET` | `/api/v1/products/` | `latitude`, `longitude` | Filter by deliverability |
| `GET` | `/api/v1/collections/{slug}/products/` | `latitude`, `longitude` | Filter by deliverability |
| `GET` | `/api/v1/cart/{cart_id}/` | `latitude`, `longitude` | Include `shipping_estimate` |

### Existing Endpoints (unchanged)

All cart CRUD endpoints remain the same. The `shipping_estimate` is returned on cart GET responses when coordinates are provided.

---

## 12. Normalization

Following the existing `normalizeProduct()` pattern, add a `normalizeAddressCheck()` function in `src/lib/normalize.ts` to defensively parse the address-check API response:

```typescript
export function normalizeAddressCheck(raw: unknown): {
  coords: AddressCoords;
  eligibility: AddressEligibility;
} | null {
  // Defensive parsing — handles missing fields, renamed keys,
  // absent delivery_slots (P1, may not be in Phase 1 response)
  // Returns null if response is unparseable
}
```

This prevents a renamed backend field from silently breaking the entire feature. The `delivery_slots` field is optional (P1 priority) — the frontend handles its absence gracefully.
