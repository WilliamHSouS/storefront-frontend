# Delivery Options Frontend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add address-aware delivery flow to the storefront: postcode input, product fulfillment badges, cart shipping estimates, and delivery status banners.

**Architecture:** Stateless address context held client-side in nanostores (`$addressCoords`, `$addressEligibility`). A single `FulfillmentOverlay` Preact island handles all product badge/visibility changes via DOM manipulation on existing server-rendered `[data-product-id]` elements. Cart shipping estimates extend the existing `CartDrawer` via a new `shipping_estimate` field on the Cart type.

**Tech Stack:** Astro 5, Preact, Nanostores, Tailwind CSS, TypeScript, Vitest (unit), Playwright (e2e)

**Design Doc:** `docs/plans/2026-03-10-delivery-options-frontend-design.md`

**Debate Changes Applied:** 13 revisions from 3-perspective debate — see inline `[DEBATE]` markers.

---

## Task 1: Address Store & Persistence

Create the address state management foundation with localStorage persistence and TTL.

> [DEBATE #4] Merged `address.ts` and `address-actions.ts` into a single `address.ts` file — the split was premature for ~80 lines of closely related code.
> [DEBATE #12] Dropped promise-lock on `onAddressChange` — the UI loading state already serializes submissions (button disabled while loading).

**Files:**
- Create: `src/stores/address.ts`
- Create: `src/types/address.ts`
- Test: `src/stores/address.test.ts`

**Step 1: Create address types**

Create `src/types/address.ts`:

```typescript
export interface AddressCoords {
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
}

export interface AddressEligibility {
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
  deliveryUnavailable: boolean;
  nearDeliveryZone: boolean;
  nearestPickupLocation?: {
    name: string;
    distance_km: number;
  };
}

export interface StoredAddress {
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  storedAt: number; // Date.now() timestamp
}

/** Product fulfillment metadata returned by the overlay fetch */
export interface ProductFulfillment {
  productId: string;
  availableFulfillmentTypes: string[];
  pickupOnly: boolean;
}
```

> [DEBATE #3, #11, #13] Removed `deliverySlots` from `AddressEligibility` and `$selectedSlots` from stores — these belong to the DeliveryOptionsSheet which is deferred to Phase 2 when the backend supports time slots. Also removed `$isDeliverySheetOpen`. Cut ~12 i18n keys related to the sheet.

**Step 2: Write failing tests for address store**

Create `src/stores/address.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  $addressCoords,
  $addressEligibility,
  getStoredAddress,
  setStoredAddress,
  clearStoredAddress,
  isAddressExpired,
  ADDRESS_TTL_MS,
} from './address';

describe('address stores', () => {
  beforeEach(() => {
    $addressCoords.set(null);
    $addressEligibility.set(null);
    localStorage.clear();
  });

  it('initializes with null state', () => {
    expect($addressCoords.get()).toBeNull();
    expect($addressEligibility.get()).toBeNull();
  });
});

describe('address persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves address from localStorage', () => {
    const coords = {
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
    };
    setStoredAddress(coords);

    const stored = getStoredAddress();
    expect(stored).not.toBeNull();
    expect(stored!.postalCode).toBe('1015 BS');
    expect(stored!.latitude).toBe(52.3702);
  });

  it('clears stored address', () => {
    setStoredAddress({
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
    });
    clearStoredAddress();
    expect(getStoredAddress()).toBeNull();
  });

  it('detects expired addresses (>7 days)', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    expect(isAddressExpired(eightDaysAgo)).toBe(true);
  });

  it('accepts fresh addresses (<7 days)', () => {
    const oneDayAgo = Date.now() - 1 * 24 * 60 * 60 * 1000;
    expect(isAddressExpired(oneDayAgo)).toBe(false);
  });

  it('returns null for expired stored address', () => {
    const expired = {
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
      storedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    };
    localStorage.setItem('sous_address', JSON.stringify(expired));
    expect(getStoredAddress()).toBeNull();
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `pnpm test src/stores/address.test.ts`
Expected: FAIL — modules don't exist yet.

**Step 4: Create address store**

Create `src/stores/address.ts`:

```typescript
import { atom } from 'nanostores';
import type { AddressCoords, AddressEligibility, StoredAddress } from '@/types/address';

// ── Atoms ──────────────────────────────────────────────────────

export const $addressCoords = atom<AddressCoords | null>(null);
export const $addressEligibility = atom<AddressEligibility | null>(null);

// ── localStorage persistence ───────────────────────────────────

const STORAGE_KEY = 'sous_address';
export const ADDRESS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function isAddressExpired(storedAt: number): boolean {
  return Date.now() - storedAt > ADDRESS_TTL_MS;
}

export function getStoredAddress(): StoredAddress | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored: StoredAddress = JSON.parse(raw);
    if (!stored.postalCode || !stored.latitude || !stored.longitude) return null;
    if (isAddressExpired(stored.storedAt)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

export function setStoredAddress(coords: AddressCoords): void {
  const stored: StoredAddress = { ...coords, storedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function clearStoredAddress(): void {
  localStorage.removeItem(STORAGE_KEY);
}
```

**Step 5: Run tests to verify they pass**

Run: `pnpm test src/stores/address.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/stores/address.ts src/types/address.ts src/stores/address.test.ts
git commit -m "feat: add address store with localStorage persistence and TTL"
```

---

## Task 2: Address Actions & API Integration

Add `onAddressChange()` orchestrator and `clearAddress()` — no separate normalizer.

> [DEBATE #5] Dropped `normalizeAddressCheck()` — the address-check endpoint is our own API with a typed SDK client. Defensive parsing adds complexity for zero benefit on own endpoints. Use the SDK response shape directly.
> [DEBATE #1] `refreshCartWithCoords` calls `normalizeCart()` (existing fn in `src/lib/normalize.ts:238`) to maintain the boundary normalization invariant.
> [DEBATE #8] Orchestrator tests assert actual API calls are made and test error paths, not just that stores are set.

**Files:**
- Create: `src/stores/address-actions.ts`
- Test: `src/stores/address-actions.test.ts`

**Step 1: Write failing tests for onAddressChange**

Create `src/stores/address-actions.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { $addressCoords, $addressEligibility } from './address';
import { $cart } from './cart';

const mockPOST = vi.fn();
const mockGET = vi.fn();

vi.mock('@/lib/api', () => ({
  getClient: () => ({ GET: mockGET, POST: mockPOST }),
}));

// Must import after mock setup
const { onAddressChange, clearAddress } = await import('./address-actions');

describe('onAddressChange', () => {
  beforeEach(() => {
    $addressCoords.set(null);
    $addressEligibility.set(null);
    $cart.set(null);
    localStorage.clear();
    mockPOST.mockReset();
    mockGET.mockReset();
  });

  it('calls address-check API with postal_code and country', async () => {
    mockPOST.mockResolvedValue({
      data: {
        latitude: 52.3702,
        longitude: 4.8952,
        available_fulfillment_types: ['local_delivery'],
        available_shipping_providers: [],
        pickup_locations: [],
        delivery_unavailable: false,
        near_delivery_zone: false,
      },
      error: null,
    });

    await onAddressChange({ postalCode: '1015 BS', country: 'NL' });

    expect(mockPOST).toHaveBeenCalledWith(
      '/api/v1/fulfillment/address-check/',
      expect.objectContaining({
        body: { postal_code: '1015 BS', country: 'NL' },
      }),
    );
  });

  it('sets address coords and eligibility on success', async () => {
    mockPOST.mockResolvedValue({
      data: {
        latitude: 52.3702,
        longitude: 4.8952,
        available_fulfillment_types: ['local_delivery'],
        available_shipping_providers: [],
        pickup_locations: [],
        delivery_unavailable: false,
        near_delivery_zone: false,
      },
      error: null,
    });

    await onAddressChange({ postalCode: '1015 BS', country: 'NL' });

    expect($addressCoords.get()).not.toBeNull();
    expect($addressCoords.get()!.postalCode).toBe('1015 BS');
    expect($addressCoords.get()!.latitude).toBe(52.3702);
    expect($addressEligibility.get()).not.toBeNull();
    expect($addressEligibility.get()!.availableFulfillmentTypes).toEqual(['local_delivery']);
  });

  it('persists coords to localStorage', async () => {
    mockPOST.mockResolvedValue({
      data: {
        latitude: 52.3702,
        longitude: 4.8952,
        available_fulfillment_types: ['local_delivery'],
        available_shipping_providers: [],
        pickup_locations: [],
        delivery_unavailable: false,
        near_delivery_zone: false,
      },
      error: null,
    });

    await onAddressChange({ postalCode: '1015 BS', country: 'NL' });

    const stored = localStorage.getItem('sous_address');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.postalCode).toBe('1015 BS');
    expect(parsed.storedAt).toBeGreaterThan(0);
  });

  it('returns error on API failure', async () => {
    mockPOST.mockResolvedValue({
      data: null,
      error: { message: 'Not found' },
    });

    const result = await onAddressChange({ postalCode: '0000', country: 'NL' });

    expect(result.success).toBe(false);
    expect($addressCoords.get()).toBeNull();
  });

  it('re-fetches cart with coordinates when cart exists', async () => {
    // Set up existing cart
    localStorage.setItem('sous_cart_id', 'cart-123');

    mockPOST.mockResolvedValue({
      data: {
        latitude: 52.3702,
        longitude: 4.8952,
        available_fulfillment_types: ['local_delivery'],
        available_shipping_providers: [],
        pickup_locations: [],
        delivery_unavailable: false,
        near_delivery_zone: false,
      },
      error: null,
    });
    mockGET.mockResolvedValue({
      data: {
        id: 'cart-123',
        line_items: [],
        cart_total: '0.00',
        item_count: 0,
        shipping_estimate: {
          groups: [],
          total_shipping: '0.00',
          ships_in_parts: false,
        },
      },
      error: null,
    });

    await onAddressChange({ postalCode: '1015 BS', country: 'NL' });

    expect(mockGET).toHaveBeenCalledWith(
      '/api/v1/cart/{cart_id}/',
      expect.objectContaining({
        params: expect.objectContaining({
          query: { latitude: 52.3702, longitude: 4.8952 },
        }),
      }),
    );
  });
});

describe('clearAddress', () => {
  it('resets all address state and localStorage', () => {
    $addressCoords.set({
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
    });
    localStorage.setItem('sous_address', '{}');

    clearAddress();

    expect($addressCoords.get()).toBeNull();
    expect($addressEligibility.get()).toBeNull();
    expect(localStorage.getItem('sous_address')).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test src/stores/address-actions.test.ts`
Expected: FAIL — `onAddressChange` and `clearAddress` not exported.

**Step 3: Implement address actions**

Create `src/stores/address-actions.ts`:

```typescript
import { $addressCoords, $addressEligibility, setStoredAddress, clearStoredAddress, getStoredAddress } from './address';
import { $cart, getStoredCartId } from './cart';
import { getClient } from '@/lib/api';
import { normalizeCart } from '@/lib/normalize';
import type { AddressCoords, AddressEligibility } from '@/types/address';

export async function onAddressChange(input: {
  postalCode: string;
  country: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getClient();
    const { data, error } = await client.POST('/api/v1/fulfillment/address-check/', {
      body: { postal_code: input.postalCode, country: input.country },
    });

    if (error || !data) {
      return { success: false, error: error?.message ?? 'unknown' };
    }

    const r = data as Record<string, unknown>;
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    if (isNaN(lat) || isNaN(lng)) {
      return { success: false, error: 'invalid_response' };
    }

    const coords: AddressCoords = {
      postalCode: input.postalCode,
      country: input.country,
      latitude: lat,
      longitude: lng,
    };

    const pickupLocations = Array.isArray(r.pickup_locations)
      ? r.pickup_locations.filter(
          (l: unknown): l is { id: number; name: string; distance_km: number } =>
            !!l && typeof l === 'object' && 'name' in l,
        )
      : [];

    const eligibility: AddressEligibility = {
      availableFulfillmentTypes: Array.isArray(r.available_fulfillment_types)
        ? r.available_fulfillment_types
        : [],
      availableShippingProviders: Array.isArray(r.available_shipping_providers)
        ? r.available_shipping_providers
        : [],
      pickupLocations,
      deliveryUnavailable: r.delivery_unavailable === true,
      nearDeliveryZone: r.near_delivery_zone === true,
      nearestPickupLocation: pickupLocations.length > 0
        ? { name: pickupLocations[0].name, distance_km: pickupLocations[0].distance_km }
        : undefined,
    };

    // 1. Set stores
    $addressCoords.set(coords);
    $addressEligibility.set(eligibility);

    // 2. Persist coords to localStorage
    setStoredAddress(coords);

    // 3. Inline analytics: track address_entered
    trackAddressEntered(coords, eligibility);

    // 4. Track delivery unavailable if applicable
    if (eligibility.deliveryUnavailable) {
      trackDeliveryUnavailable(coords, eligibility);
    }

    // 5. Re-fetch cart with coordinates if cart exists
    const cartId = getStoredCartId();
    if (cartId) {
      await refreshCartWithCoords(cartId, coords);
    }

    return { success: true };
  } catch {
    return { success: false, error: 'network' };
  }
}

export function clearAddress(): void {
  $addressCoords.set(null);
  $addressEligibility.set(null);
  clearStoredAddress();
}

/** [DEBATE #1] Uses normalizeCart() to maintain boundary normalization invariant */
async function refreshCartWithCoords(
  cartId: string,
  coords: AddressCoords,
): Promise<void> {
  try {
    const client = getClient();
    const { data } = await client.GET('/api/v1/cart/{cart_id}/', {
      params: {
        path: { cart_id: cartId },
        query: { latitude: coords.latitude, longitude: coords.longitude },
      },
    });
    if (data) {
      $cart.set(normalizeCart(data as Record<string, unknown>));
    }
  } catch {
    // Cart refresh failure is non-blocking — estimate just won't show
  }
}

export async function hydrateAddressFromStorage(): Promise<void> {
  const stored = getStoredAddress();
  if (!stored) return;

  // Set coords immediately (stable data, OK to use from cache)
  $addressCoords.set({
    postalCode: stored.postalCode,
    country: stored.country,
    latitude: stored.latitude,
    longitude: stored.longitude,
  });

  // Re-fetch volatile eligibility data in background
  await onAddressChange({
    postalCode: stored.postalCode,
    country: stored.country,
  });
}

// ── Inline Analytics ───────────────────────────────────────────
// [DEBATE #6] Inlined here instead of a separate delivery-analytics.ts module.
// Only 2 events at launch — a module would be over-engineering.

function truncatePostcode(postalCode: string): string {
  return postalCode.replace(/\s/g, '').slice(0, 4);
}

function capture(event: string, properties: Record<string, unknown>): void {
  if (typeof window !== 'undefined' && 'posthog' in window) {
    (window as unknown as { posthog?: { capture: (e: string, p: Record<string, unknown>) => void } })
      .posthog?.capture(event, properties);
  }
}

function trackAddressEntered(coords: AddressCoords, eligibility: AddressEligibility): void {
  capture('address_entered', {
    postal_code_prefix: truncatePostcode(coords.postalCode),
    country: coords.country,
    available_fulfillment_types: eligibility.availableFulfillmentTypes,
    has_local_delivery: eligibility.availableFulfillmentTypes.includes('local_delivery'),
    has_pickup: eligibility.availableFulfillmentTypes.includes('pickup'),
  });
}

function trackDeliveryUnavailable(coords: AddressCoords, eligibility: AddressEligibility): void {
  capture('delivery_unavailable', {
    postal_code_prefix: truncatePostcode(coords.postalCode),
    country: coords.country,
    nearest_pickup_distance_km: eligibility.nearestPickupLocation?.distance_km ?? null,
    near_delivery_zone: eligibility.nearDeliveryZone,
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test src/stores/address-actions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/address-actions.ts src/stores/address-actions.test.ts
git commit -m "feat: add onAddressChange orchestrator with inline analytics"
```

---

## Task 3: Extend Cart Type & normalizeCart with shipping_estimate

> [DEBATE #1, #2] The Cart interface at `src/stores/cart.ts:38-61` needs a `shipping_estimate` field, and `normalizeCart()` at `src/lib/normalize.ts:238-296` must extract it from API responses.

**Files:**
- Modify: `src/stores/cart.ts:38-61` (add shipping_estimate to Cart interface)
- Modify: `src/lib/normalize.ts:238-296` (extract shipping_estimate in normalizeCart)
- Modify: `src/lib/normalize.test.ts` (add test for shipping_estimate extraction)

**Step 1: Define ShippingEstimate type and add to Cart**

Add to `src/stores/cart.ts` after the `Cart` interface (before line 62):

```typescript
export interface ShippingEstimateGroup {
  provider_name: string;
  fulfillment_type: string;
  status: 'quoted' | 'calculated' | 'pending' | 'unavailable';
  estimated_cost: string | null;
  items: string[];
}

export interface ShippingEstimate {
  groups: ShippingEstimateGroup[];
  total_shipping: string | null;
  ships_in_parts: boolean;
}
```

Add to the `Cart` interface (after `shipping_cost?: string;` on line 48):

```typescript
  shipping_estimate?: ShippingEstimate;
```

**Step 2: Write failing test for normalizeCart shipping_estimate extraction**

Add to `src/lib/normalize.test.ts`:

```typescript
import { normalizeCart } from './normalize';

describe('normalizeCart shipping_estimate', () => {
  it('extracts shipping_estimate from API response', () => {
    const raw = {
      id: 'cart-1',
      line_items: [],
      cart_total: '13.50',
      item_count: 1,
      shipping_estimate: {
        groups: [{
          provider_name: 'Uber Direct',
          fulfillment_type: 'local_delivery',
          status: 'quoted',
          estimated_cost: '3.50',
          items: ['Burger'],
        }],
        total_shipping: '3.50',
        ships_in_parts: false,
      },
    };

    const cart = normalizeCart(raw);
    expect(cart.shipping_estimate).toBeDefined();
    expect(cart.shipping_estimate!.groups).toHaveLength(1);
    expect(cart.shipping_estimate!.total_shipping).toBe('3.50');
  });

  it('handles missing shipping_estimate gracefully', () => {
    const raw = {
      id: 'cart-2',
      line_items: [],
      cart_total: '10.00',
      item_count: 0,
    };

    const cart = normalizeCart(raw);
    expect(cart.shipping_estimate).toBeUndefined();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm test src/lib/normalize.test.ts`
Expected: FAIL — `shipping_estimate` not extracted.

**Step 4: Update normalizeCart to extract shipping_estimate**

In `src/lib/normalize.ts`, add to the return object of `normalizeCart()` (at line ~294, before the closing `};`):

```typescript
    shipping_estimate: r.shipping_estimate as Cart['shipping_estimate'],
```

Note: Import the `ShippingEstimate` type via the existing `Cart` import: `import type { Cart, CartLineItem } from '@/stores/cart';` (already exists on line 9).

**Step 5: Run tests to verify they pass**

Run: `pnpm test src/lib/normalize.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/stores/cart.ts src/lib/normalize.ts src/lib/normalize.test.ts
git commit -m "feat: add shipping_estimate to Cart type and normalizeCart"
```

---

## Task 4: Extend NormalizedProduct with Fulfillment Fields

> [DEBATE #10] The `NormalizedProduct` interface at `src/lib/normalize.ts:59-77` has a `[key: string]: unknown` pass-through so new backend fields survive, but we should explicitly declare `availableFulfillmentTypes` and `pickupOnly` for type safety.

**Files:**
- Modify: `src/lib/normalize.ts:59-77` (add fields to NormalizedProduct)
- Modify: `src/lib/normalize.ts:127-151` (extract in normalizeProduct)
- Modify: `src/lib/normalize.test.ts` (add test)

**Step 1: Write failing test**

Add to `src/lib/normalize.test.ts`:

```typescript
import { normalizeProduct } from './normalize';

describe('normalizeProduct fulfillment fields', () => {
  it('extracts available_fulfillment_types and pickup_only', () => {
    const raw = {
      id: 42,
      title: 'Bitterballen',
      price: '8.50',
      available_fulfillment_types: ['local_delivery', 'pickup'],
      pickup_only: false,
    };

    const product = normalizeProduct(raw);
    expect(product.availableFulfillmentTypes).toEqual(['local_delivery', 'pickup']);
    expect(product.pickupOnly).toBe(false);
  });

  it('defaults fulfillment fields when absent', () => {
    const raw = { id: 1, title: 'Falafel' };
    const product = normalizeProduct(raw);
    expect(product.availableFulfillmentTypes).toEqual([]);
    expect(product.pickupOnly).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/normalize.test.ts`
Expected: FAIL — fields not explicitly mapped.

**Step 3: Add fields to NormalizedProduct and normalizeProduct**

In `src/lib/normalize.ts`, add to `NormalizedProduct` interface (before `[key: string]: unknown;` on line 76):

```typescript
  availableFulfillmentTypes: string[];
  pickupOnly: boolean;
```

In the `normalizeProduct()` return object (around line 149, before `images,`):

```typescript
    availableFulfillmentTypes: (r as Record<string, unknown>).available_fulfillment_types as string[] ?? [],
    pickupOnly: (r as Record<string, unknown>).pickup_only === true,
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/normalize.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/normalize.ts src/lib/normalize.test.ts
git commit -m "feat: add fulfillment fields to NormalizedProduct"
```

---

## Task 5: i18n Keys

Add translation keys for delivery features across all three languages.

> [DEBATE #13] Reduced from 32 to ~20 keys. Cut keys for deferred DeliveryOptionsSheet (asap, estimatedMinutes, estimatedDelivery, continueToCheckout, skipToCheckout, deliveryCostUpdated, deliveryPricingChanging, localDelivery, nationwideShipping, selfDelivery, couldntLoadDelivery, retry, removeFromCart).

**Files:**
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/nl.json`
- Modify: `src/i18n/messages/de.json`

**Step 1: Add English keys**

Add to `src/i18n/messages/en.json` (before the closing `}`):

```json
  "enterPostcode": "Enter postcode",
  "checkAddress": "Check",
  "postcodeNotFound": "Postcode not found",
  "somethingWentWrong": "Something went wrong. Try again.",
  "connectionProblem": "Connection problem. Check your internet.",
  "addPostcodeForShipping": "Add your postcode for shipping costs",
  "shippingEstimate": "Shipping",
  "shippingAtCheckout": "Calculated at checkout",
  "shippingUnavailable": "Temporarily unavailable",
  "pickupOnly": "Pickup only",
  "shipsSeparately": "Ships separately",
  "notAvailableDelivery": "Not available for delivery",
  "availableForPickup": "Available for pickup at {name}",
  "deliveryUnavailable": "Delivery isn't available to your area",
  "nearDeliveryZone": "You're just outside the delivery area",
  "pickupAvailableAt": "Pickup available at {name} ({distance} km)",
  "deliveringTo": "Delivering to {postalCode}",
  "showingItemsFor": "Showing items available for delivery to {postalCode}",
  "deliveryOptions": "Delivery options",
  "changeAddress": "Change",
  "clearAddress": "Clear"
```

**Step 2: Add Dutch keys**

Add to `src/i18n/messages/nl.json`:

```json
  "enterPostcode": "Voer postcode in",
  "checkAddress": "Controleren",
  "postcodeNotFound": "Postcode niet gevonden",
  "somethingWentWrong": "Er ging iets mis. Probeer het opnieuw.",
  "connectionProblem": "Verbindingsprobleem. Controleer je internet.",
  "addPostcodeForShipping": "Voer je postcode in voor verzendkosten",
  "shippingEstimate": "Verzending",
  "shippingAtCheckout": "Berekend bij afrekenen",
  "shippingUnavailable": "Tijdelijk niet beschikbaar",
  "pickupOnly": "Alleen afhalen",
  "shipsSeparately": "Wordt apart verzonden",
  "notAvailableDelivery": "Niet beschikbaar voor bezorging",
  "availableForPickup": "Beschikbaar voor afhalen bij {name}",
  "deliveryUnavailable": "Bezorging is niet beschikbaar in jouw regio",
  "nearDeliveryZone": "Je bent net buiten het bezorggebied",
  "pickupAvailableAt": "Afhalen mogelijk bij {name} ({distance} km)",
  "deliveringTo": "Bezorgen naar {postalCode}",
  "showingItemsFor": "Items beschikbaar voor bezorging naar {postalCode}",
  "deliveryOptions": "Bezorgopties",
  "changeAddress": "Wijzigen",
  "clearAddress": "Wissen"
```

**Step 3: Add German keys**

Add to `src/i18n/messages/de.json`:

```json
  "enterPostcode": "PLZ eingeben",
  "checkAddress": "Prüfen",
  "postcodeNotFound": "PLZ nicht gefunden",
  "somethingWentWrong": "Etwas ist schiefgelaufen. Versuche es erneut.",
  "connectionProblem": "Verbindungsproblem. Überprüfe dein Internet.",
  "addPostcodeForShipping": "PLZ eingeben für Versandkosten",
  "shippingEstimate": "Versand",
  "shippingAtCheckout": "Wird an der Kasse berechnet",
  "shippingUnavailable": "Vorübergehend nicht verfügbar",
  "pickupOnly": "Nur Abholung",
  "shipsSeparately": "Wird separat versendet",
  "notAvailableDelivery": "Nicht für Lieferung verfügbar",
  "availableForPickup": "Abholung möglich bei {name}",
  "deliveryUnavailable": "Lieferung in deiner Region nicht verfügbar",
  "nearDeliveryZone": "Du bist knapp außerhalb des Liefergebiets",
  "pickupAvailableAt": "Abholung möglich bei {name} ({distance} km)",
  "deliveringTo": "Lieferung nach {postalCode}",
  "showingItemsFor": "Artikel verfügbar für Lieferung nach {postalCode}",
  "deliveryOptions": "Lieferoptionen",
  "changeAddress": "Ändern",
  "clearAddress": "Löschen"
```

**Step 4: Verify build still passes**

Run: `pnpm check`
Expected: PASS — TypeScript picks up new keys via MessageKey type inference from nl.json.

**Step 5: Commit**

```bash
git add src/i18n/messages/en.json src/i18n/messages/nl.json src/i18n/messages/de.json
git commit -m "feat: add i18n keys for delivery options (en, nl, de)"
```

---

## Task 6: AddressBar Component

Build the header-mounted postcode input island.

> [DEBATE #11] Wire up the `address-bar:expand` custom event dispatch from DeliveryBanner and ShippingEstimate so the "add postcode" prompts can expand the AddressBar.

**Files:**
- Create: `src/components/interactive/AddressBar.tsx`
- Modify: `src/components/astro/Header.astro`
- Test: `src/components/interactive/AddressBar.test.tsx`

**Step 1: Write failing tests for AddressBar**

Create `src/components/interactive/AddressBar.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/preact';
import { AddressBar } from './AddressBar';
import { $addressCoords } from '@/stores/address';

// Mock address actions
vi.mock('@/stores/address-actions', () => ({
  onAddressChange: vi.fn().mockResolvedValue({ success: true }),
  clearAddress: vi.fn(),
  hydrateAddressFromStorage: vi.fn().mockResolvedValue(undefined),
}));

describe('AddressBar', () => {
  beforeEach(() => {
    $addressCoords.set(null);
  });

  it('renders compact state with placeholder when no address', () => {
    const { getByRole } = render(<AddressBar lang="en" />);
    const button = getByRole('button', { name: /enter postcode/i });
    expect(button).toBeTruthy();
  });

  it('expands to input mode on click', async () => {
    const { getByRole, getByLabelText } = render(<AddressBar lang="en" />);
    const button = getByRole('button', { name: /enter postcode/i });
    fireEvent.click(button);
    expect(getByLabelText(/postcode/i)).toBeTruthy();
  });

  it('shows postcode in compact state when address is set', () => {
    $addressCoords.set({
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
    });
    const { getByText } = render(<AddressBar lang="en" />);
    expect(getByText('1015 BS')).toBeTruthy();
  });

  it('has clear button when address is set', () => {
    $addressCoords.set({
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
    });
    const { getByRole } = render(<AddressBar lang="en" />);
    expect(getByRole('button', { name: /clear/i })).toBeTruthy();
  });

  it('expands on address-bar:expand custom event', () => {
    const { getByLabelText } = render(<AddressBar lang="en" />);
    document.dispatchEvent(new CustomEvent('address-bar:expand'));
    expect(getByLabelText(/postcode/i)).toBeTruthy();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test src/components/interactive/AddressBar.test.tsx`
Expected: FAIL — module doesn't exist.

**Step 3: Implement AddressBar**

Create `src/components/interactive/AddressBar.tsx`:

```tsx
import { useState, useRef, useEffect } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $addressCoords } from '@/stores/address';
import { onAddressChange, clearAddress, hydrateAddressFromStorage } from '@/stores/address-actions';
import { t } from '@/i18n';

interface Props {
  lang: string;
}

const LANG_TO_COUNTRY: Record<string, string> = {
  nl: 'NL',
  de: 'DE',
  en: 'NL',
};

export function AddressBar({ lang }: Props) {
  const coords = useStore($addressCoords);
  const [expanded, setExpanded] = useState(false);
  const [postcode, setPostcode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    hydrateAddressFromStorage();
  }, []);

  // [DEBATE #11] Listen for expand events from DeliveryBanner / ShippingEstimate
  useEffect(() => {
    const handler = () => setExpanded(true);
    document.addEventListener('address-bar:expand', handler);
    return () => document.removeEventListener('address-bar:expand', handler);
  }, []);

  // Focus input when expanding
  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [expanded]);

  const country = LANG_TO_COUNTRY[lang] ?? 'NL';

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const trimmed = postcode.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    const result = await onAddressChange({ postalCode: trimmed, country });

    setLoading(false);

    if (result.success) {
      setExpanded(false);
      setPostcode('');
    } else {
      if (result.error === 'network') {
        setError(t('connectionProblem', lang));
      } else {
        setError(t('postcodeNotFound', lang));
      }
    }
  }

  function handleClear(e: Event) {
    e.stopPropagation();
    clearAddress();
    setPostcode('');
    setError(null);
  }

  function handleExpand() {
    if (!expanded) {
      setExpanded(true);
      setError(null);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setExpanded(false);
      setError(null);
    }
  }

  const pinIcon = (
    <svg class="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );

  // Compact state: address set
  if (coords && !expanded) {
    return (
      <div class="flex items-center gap-1.5 text-sm">
        <span class="text-muted-foreground">{pinIcon}</span>
        <button
          onClick={handleExpand}
          class="font-medium hover:underline"
          aria-expanded="false"
          aria-label={`${t('enterPostcode', lang)}: ${coords.postalCode}`}
        >
          {coords.postalCode}
        </button>
        <button
          onClick={handleClear}
          class="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
          aria-label={t('clearAddress', lang)}
        >
          <svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    );
  }

  // Compact state: no address
  if (!expanded) {
    return (
      <button
        onClick={handleExpand}
        class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        aria-expanded="false"
        aria-label={t('enterPostcode', lang)}
      >
        {pinIcon}
        <span>{t('enterPostcode', lang)}</span>
      </button>
    );
  }

  // Expanded state: input mode
  return (
    <form
      onSubmit={handleSubmit}
      class="flex items-center gap-1.5"
      onKeyDown={handleKeyDown}
    >
      <span class="text-muted-foreground">{pinIcon}</span>
      <input
        ref={inputRef}
        type="text"
        value={postcode}
        onInput={(e) => setPostcode((e.target as HTMLInputElement).value)}
        placeholder={t('enterPostcode', lang)}
        aria-label={t('enterPostcode', lang)}
        class="w-24 rounded border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        disabled={loading}
      />
      <button
        type="submit"
        disabled={loading || !postcode.trim()}
        class="rounded bg-primary px-2.5 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {loading ? (
          <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32" />
          </svg>
        ) : (
          t('checkAddress', lang)
        )}
      </button>
      {error && (
        <span role="alert" class="text-xs text-destructive whitespace-nowrap">
          {error}
        </span>
      )}
    </form>
  );
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm test src/components/interactive/AddressBar.test.tsx`
Expected: PASS

**Step 5: Mount in Header.astro**

Modify `src/components/astro/Header.astro`. Add import at top of the frontmatter:

```astro
---
import { AddressBar } from '@/components/interactive/AddressBar';
---
```

Add the island in the nav section, between the logo and the cart controls:

```astro
<AddressBar client:idle lang={lang} />
```

**Step 6: Verify dev server renders correctly**

Run: `pnpm dev`
Check: Header shows "Enter postcode" button at `http://localhost:4321/nl/`

**Step 7: Commit**

```bash
git add src/components/interactive/AddressBar.tsx src/components/interactive/AddressBar.test.tsx src/components/astro/Header.astro
git commit -m "feat: add AddressBar island in header with postcode input"
```

---

## Task 7: FulfillmentOverlay Component

Single island that handles all product badge/visibility changes via safe DOM manipulation. Uses `textContent` and `createElement` instead of innerHTML to prevent XSS.

> [DEBATE #7] Added DOM integration tests using happy-dom to verify actual badge creation and product hiding.

**Files:**
- Create: `src/components/interactive/FulfillmentOverlay.tsx`
- Modify: `src/components/astro/ProductCard.astro` (add badge slot element)
- Modify: `src/components/astro/MenuSection.astro` (add data attribute)
- Modify: `src/layouts/BaseLayout.astro` (mount island)
- Test: `src/components/interactive/FulfillmentOverlay.test.tsx`

**Step 1: Add data attributes to ProductCard.astro**

Modify `src/components/astro/ProductCard.astro`. Ensure `data-product-id` exists (it already does) and add a badge slot.

After the existing PromoBadge, add:

```astro
<span data-fulfillment-badge class="empty:hidden"></span>
```

**Step 2: Add data attribute to MenuSection.astro**

Modify `src/components/astro/MenuSection.astro`. Add `data-menu-section` to the section element.

**Step 3: Write failing tests — pure logic + DOM integration**

Create `src/components/interactive/FulfillmentOverlay.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getBadgeForProduct,
  shouldHideProduct,
  applyFulfillmentToDOM,
} from './FulfillmentOverlay';

// ── Pure logic tests ───────────────────────────────────────────

describe('getBadgeForProduct', () => {
  it('returns null when no address is set', () => {
    expect(getBadgeForProduct(null, ['local_delivery'], false)).toBeNull();
  });

  it('returns null for local delivery products (happy path)', () => {
    const coords = { postalCode: '1015', country: 'NL', latitude: 0, longitude: 0 };
    expect(getBadgeForProduct(coords, ['local_delivery'], false)).toBeNull();
  });

  it('returns "pickupOnly" for pickup-only products', () => {
    const coords = { postalCode: '1015', country: 'NL', latitude: 0, longitude: 0 };
    expect(getBadgeForProduct(coords, ['pickup'], true)).toBe('pickupOnly');
  });

  it('returns "shipsSeparately" for nationwide-only products', () => {
    const coords = { postalCode: '1015', country: 'NL', latitude: 0, longitude: 0 };
    expect(getBadgeForProduct(coords, ['nationwide_delivery'], false)).toBe('shipsSeparately');
  });
});

describe('shouldHideProduct', () => {
  it('does not hide when no address is set', () => {
    expect(shouldHideProduct(null, ['local_delivery'])).toBe(false);
  });

  it('does not hide products with local delivery', () => {
    const coords = { postalCode: '1015', country: 'NL', latitude: 0, longitude: 0 };
    expect(shouldHideProduct(coords, ['local_delivery'])).toBe(false);
  });

  it('hides products with empty fulfillment types', () => {
    const coords = { postalCode: '1015', country: 'NL', latitude: 0, longitude: 0 };
    expect(shouldHideProduct(coords, [])).toBe(true);
  });
});

// ── DOM integration tests (happy-dom) ──────────────────────────
// [DEBATE #7] These verify actual DOM manipulation, not just pure logic.

describe('applyFulfillmentToDOM', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('adds pickup-only badge to badge slot', () => {
    document.body.innerHTML = `
      <div data-menu-section>
        <article data-product-id="42">
          <span data-fulfillment-badge></span>
        </article>
      </div>
    `;

    const coords = { postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 };
    const fulfillmentMap = new Map([
      ['42', { productId: '42', availableFulfillmentTypes: ['pickup'], pickupOnly: true }],
    ]);

    applyFulfillmentToDOM(fulfillmentMap, coords, 'en');

    const badge = document.querySelector('[data-fulfillment-badge]');
    expect(badge?.textContent).toContain('Pickup only');
  });

  it('hides products not in fulfillment map', () => {
    document.body.innerHTML = `
      <div data-menu-section>
        <article data-product-id="99">
          <span data-fulfillment-badge></span>
        </article>
      </div>
    `;

    const coords = { postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 };
    const fulfillmentMap = new Map(); // product 99 not present

    applyFulfillmentToDOM(fulfillmentMap, coords, 'en');

    const card = document.querySelector('[data-product-id="99"]');
    expect(card?.classList.contains('hidden')).toBe(true);
  });

  it('hides empty menu sections', () => {
    document.body.innerHTML = `
      <div data-menu-section>
        <article data-product-id="99">
          <span data-fulfillment-badge></span>
        </article>
      </div>
    `;

    const coords = { postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 };
    applyFulfillmentToDOM(new Map(), coords, 'en');

    const section = document.querySelector('[data-menu-section]');
    expect(section?.classList.contains('hidden')).toBe(true);
  });

  it('clears badges when called with empty map and no hidden products', () => {
    document.body.innerHTML = `
      <div data-menu-section>
        <article data-product-id="42">
          <span data-fulfillment-badge><span>Old badge</span></span>
        </article>
      </div>
    `;

    const coords = { postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 };
    const fulfillmentMap = new Map([
      ['42', { productId: '42', availableFulfillmentTypes: ['local_delivery'], pickupOnly: false }],
    ]);

    applyFulfillmentToDOM(fulfillmentMap, coords, 'en');

    const badge = document.querySelector('[data-fulfillment-badge]');
    expect(badge?.children.length).toBe(0); // no badge for local delivery
  });
});
```

**Step 4: Run tests to verify they fail**

Run: `pnpm test src/components/interactive/FulfillmentOverlay.test.tsx`
Expected: FAIL

**Step 5: Implement FulfillmentOverlay**

Create `src/components/interactive/FulfillmentOverlay.tsx`:

```tsx
import { useEffect } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $addressCoords } from '@/stores/address';
import { getClient } from '@/lib/api';
import { t } from '@/i18n';
import type { AddressCoords, ProductFulfillment } from '@/types/address';

interface Props {
  lang: string;
}

// Pure logic — exported for testing
export function getBadgeForProduct(
  coords: AddressCoords | null,
  fulfillmentTypes: string[],
  pickupOnly: boolean,
): 'pickupOnly' | 'shipsSeparately' | null {
  if (!coords) return null;
  if (pickupOnly || (fulfillmentTypes.length === 1 && fulfillmentTypes[0] === 'pickup')) {
    return 'pickupOnly';
  }
  if (fulfillmentTypes.length === 1 && fulfillmentTypes[0] === 'nationwide_delivery') {
    return 'shipsSeparately';
  }
  return null;
}

export function shouldHideProduct(
  coords: AddressCoords | null,
  fulfillmentTypes: string[],
): boolean {
  if (!coords) return false;
  return fulfillmentTypes.length === 0;
}

/** Create a badge element using safe DOM methods (no innerHTML) */
function createBadgeElement(text: string): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground';
  badge.textContent = text;
  return badge;
}

/** Exported for DOM integration tests */
export function applyFulfillmentToDOM(
  fulfillmentMap: Map<string, ProductFulfillment>,
  coords: AddressCoords,
  lang: string,
): void {
  const cards = document.querySelectorAll<HTMLElement>('[data-product-id]');

  for (const card of cards) {
    const productId = card.dataset.productId;
    if (!productId) continue;

    const fulfillment = fulfillmentMap.get(productId);
    const badgeSlot = card.querySelector<HTMLElement>('[data-fulfillment-badge]');

    if (!fulfillment) {
      if (shouldHideProduct(coords, [])) {
        card.classList.add('hidden');
      }
      if (badgeSlot) badgeSlot.replaceChildren();
      continue;
    }

    // Show the product
    card.classList.remove('hidden');

    // Apply badge using safe DOM methods
    const badge = getBadgeForProduct(
      coords,
      fulfillment.availableFulfillmentTypes,
      fulfillment.pickupOnly,
    );

    if (badgeSlot) {
      badgeSlot.replaceChildren(); // Clear existing badges
      if (badge === 'pickupOnly') {
        badgeSlot.appendChild(createBadgeElement(t('pickupOnly', lang)));
      } else if (badge === 'shipsSeparately') {
        badgeSlot.appendChild(createBadgeElement(t('shipsSeparately', lang)));
      }
    }
  }

  // Hide empty sections
  const sections = document.querySelectorAll<HTMLElement>('[data-menu-section]');
  for (const section of sections) {
    const visibleCards = section.querySelectorAll('[data-product-id]:not(.hidden)');
    if (visibleCards.length === 0) {
      section.classList.add('hidden');
    } else {
      section.classList.remove('hidden');
    }
  }
}

function clearAllBadges(): void {
  const badges = document.querySelectorAll<HTMLElement>('[data-fulfillment-badge]');
  for (const badge of badges) {
    badge.replaceChildren();
  }
}

function showAllProducts(): void {
  const cards = document.querySelectorAll<HTMLElement>('[data-product-id]');
  for (const card of cards) {
    card.classList.remove('hidden');
  }
  const sections = document.querySelectorAll<HTMLElement>('[data-menu-section]');
  for (const section of sections) {
    section.classList.remove('hidden');
  }
}

export function FulfillmentOverlay({ lang }: Props) {
  const coords = useStore($addressCoords);

  useEffect(() => {
    if (!coords) {
      clearAllBadges();
      showAllProducts();
      return;
    }

    fetchAndApplyFulfillment(coords, lang);
  }, [coords, lang]);

  // This component renders nothing — it only manipulates DOM
  return null;
}

async function fetchAndApplyFulfillment(
  coords: AddressCoords,
  lang: string,
): Promise<void> {
  try {
    const client = getClient();
    const { data } = await client.GET('/api/v1/products/', {
      params: {
        query: { latitude: coords.latitude, longitude: coords.longitude },
      },
    });

    if (!data || !Array.isArray(data.results)) return;

    const fulfillmentMap = new Map<string, ProductFulfillment>();
    for (const product of data.results) {
      fulfillmentMap.set(String(product.id), {
        productId: String(product.id),
        availableFulfillmentTypes: product.available_fulfillment_types ?? [],
        pickupOnly: product.pickup_only ?? false,
      });
    }

    applyFulfillmentToDOM(fulfillmentMap, coords, lang);
  } catch {
    // On error, show all products without badges
    clearAllBadges();
    showAllProducts();
  }
}
```

**Step 6: Run tests to verify they pass**

Run: `pnpm test src/components/interactive/FulfillmentOverlay.test.tsx`
Expected: PASS

**Step 7: Mount in BaseLayout.astro**

Modify `src/layouts/BaseLayout.astro`. Add import and mount with other shared islands:

```astro
import { FulfillmentOverlay } from '@/components/interactive/FulfillmentOverlay';
```

```astro
<FulfillmentOverlay client:idle lang={langValue} />
```

**Step 8: Commit**

```bash
git add src/components/interactive/FulfillmentOverlay.tsx src/components/interactive/FulfillmentOverlay.test.tsx src/components/astro/ProductCard.astro src/components/astro/MenuSection.astro src/layouts/BaseLayout.astro
git commit -m "feat: add FulfillmentOverlay island for product badges and visibility"
```

---

## Task 8: DeliveryBanner Component

Inline banner below header showing delivery status context.

**Files:**
- Create: `src/components/interactive/DeliveryBanner.tsx`
- Modify: `src/layouts/BaseLayout.astro`
- Test: `src/components/interactive/DeliveryBanner.test.tsx`

**Step 1: Write failing tests**

Create `src/components/interactive/DeliveryBanner.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/preact';
import { DeliveryBanner } from './DeliveryBanner';
import { $addressCoords, $addressEligibility } from '@/stores/address';

describe('DeliveryBanner', () => {
  beforeEach(() => {
    $addressCoords.set(null);
    $addressEligibility.set(null);
  });

  it('renders nothing when no address is set', () => {
    const { container } = render(<DeliveryBanner lang="en" />);
    expect(container.innerHTML).toBe('');
  });

  it('shows delivery unavailable message', () => {
    $addressCoords.set({ postalCode: '9999', country: 'NL', latitude: 53, longitude: 6 });
    $addressEligibility.set({
      availableFulfillmentTypes: ['pickup'],
      availableShippingProviders: [],
      pickupLocations: [{ id: 5, name: "Marco's Rotterdam", distance_km: 2.3 }],
      deliveryUnavailable: true,
      nearDeliveryZone: false,
      nearestPickupLocation: { name: "Marco's Rotterdam", distance_km: 2.3 },
    });

    const { getByText } = render(<DeliveryBanner lang="en" />);
    expect(getByText(/delivery isn't available/i)).toBeTruthy();
  });

  it('shows near delivery zone message', () => {
    $addressCoords.set({ postalCode: '1020', country: 'NL', latitude: 52.4, longitude: 4.9 });
    $addressEligibility.set({
      availableFulfillmentTypes: ['pickup'],
      availableShippingProviders: [],
      pickupLocations: [{ id: 5, name: "Marco's", distance_km: 5.2 }],
      deliveryUnavailable: true,
      nearDeliveryZone: true,
      nearestPickupLocation: { name: "Marco's", distance_km: 5.2 },
    });

    const { getByText } = render(<DeliveryBanner lang="en" />);
    expect(getByText(/just outside the delivery area/i)).toBeTruthy();
  });

  it('shows delivering-to context when delivery is available', () => {
    $addressCoords.set({ postalCode: '1015 BS', country: 'NL', latitude: 52.37, longitude: 4.89 });
    $addressEligibility.set({
      availableFulfillmentTypes: ['local_delivery', 'pickup'],
      availableShippingProviders: [{ id: 1, name: 'Uber Direct', type: 'local_delivery' }],
      pickupLocations: [],
      deliveryUnavailable: false,
      nearDeliveryZone: false,
    });

    const { getByText } = render(<DeliveryBanner lang="en" />);
    expect(getByText(/delivering to 1015 BS/i)).toBeTruthy();
  });
});
```

**Step 2: Run tests, implement, mount — same pattern as Task 6**

Implement `DeliveryBanner.tsx` (see design doc Section 7 for behavior). Mount in `BaseLayout.astro` after Header.

The "add postcode" prompt in the banner should dispatch `address-bar:expand`:

```typescript
function handleExpandAddressBar() {
  document.dispatchEvent(new CustomEvent('address-bar:expand'));
}
```

**Step 3: Commit**

```bash
git add src/components/interactive/DeliveryBanner.tsx src/components/interactive/DeliveryBanner.test.tsx src/layouts/BaseLayout.astro
git commit -m "feat: add DeliveryBanner for address context and delivery status"
```

---

## Task 9: ShippingEstimate Component

Collapsible shipping cost breakdown in CartDrawer.

**Files:**
- Create: `src/components/interactive/ShippingEstimate.tsx`
- Modify: `src/components/interactive/CartDrawer.tsx` (line ~130, between subtotal and existing shipping rows)
- Test: `src/components/interactive/ShippingEstimate.test.tsx`

**Step 1: Write failing tests**

Create `src/components/interactive/ShippingEstimate.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { ShippingEstimate } from './ShippingEstimate';
import { $addressCoords } from '@/stores/address';

describe('ShippingEstimate', () => {
  beforeEach(() => {
    $addressCoords.set(null);
  });

  it('shows "add postcode" prompt when no address set', () => {
    const { getByText } = render(
      <ShippingEstimate lang="en" currency="EUR" shippingEstimate={null} />
    );
    expect(getByText(/add your postcode/i)).toBeTruthy();
  });

  it('dispatches address-bar:expand when "add postcode" is clicked', () => {
    const handler = vi.fn();
    document.addEventListener('address-bar:expand', handler);

    const { getByText } = render(
      <ShippingEstimate lang="en" currency="EUR" shippingEstimate={null} />
    );
    fireEvent.click(getByText(/add your postcode/i));
    expect(handler).toHaveBeenCalled();

    document.removeEventListener('address-bar:expand', handler);
  });

  it('shows single shipping line for single group', () => {
    $addressCoords.set({ postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 });

    const estimate = {
      groups: [{
        provider_name: 'Uber Direct',
        fulfillment_type: 'local_delivery',
        status: 'quoted' as const,
        estimated_cost: '3.50',
        items: ['Burger'],
      }],
      total_shipping: '3.50',
      ships_in_parts: false,
    };

    const { getByText } = render(
      <ShippingEstimate lang="en" currency="EUR" shippingEstimate={estimate} />
    );
    expect(getByText(/shipping/i)).toBeTruthy();
  });

  it('shows "calculated at checkout" for pending groups', () => {
    $addressCoords.set({ postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 });

    const estimate = {
      groups: [{
        provider_name: 'Uber Direct',
        fulfillment_type: 'local_delivery',
        status: 'pending' as const,
        estimated_cost: null,
        items: ['Burger'],
      }],
      total_shipping: null,
      ships_in_parts: false,
    };

    const { getByText } = render(
      <ShippingEstimate lang="en" currency="EUR" shippingEstimate={estimate} />
    );
    expect(getByText(/calculated at checkout/i)).toBeTruthy();
  });

  it('auto-expands when ships_in_parts is true', () => {
    $addressCoords.set({ postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 });

    const estimate = {
      groups: [
        { provider_name: 'Uber Direct', fulfillment_type: 'local_delivery', status: 'quoted' as const, estimated_cost: '3.50', items: ['Burger'] },
        { provider_name: 'SooCool', fulfillment_type: 'nationwide_delivery', status: 'calculated' as const, estimated_cost: '6.95', items: ['Truffle Oil'] },
      ],
      total_shipping: '10.45',
      ships_in_parts: true,
    };

    const { getByText } = render(
      <ShippingEstimate lang="en" currency="EUR" shippingEstimate={estimate} />
    );
    expect(getByText(/Uber Direct/)).toBeTruthy();
    expect(getByText(/SooCool/)).toBeTruthy();
  });
});
```

**Step 2: Implement ShippingEstimate, integrate into CartDrawer**

See design doc Section 5 for full behavior. Insert in `CartDrawer.tsx` CartFooter (at `src/components/interactive/CartDrawer.tsx:103`) between the subtotal row (line 124) and the existing shipping row (line 131).

Pass `cart.shipping_estimate` from CartFooter props into the new ShippingEstimate component.

**Step 3: Commit**

```bash
git add src/components/interactive/ShippingEstimate.tsx src/components/interactive/ShippingEstimate.test.tsx src/components/interactive/CartDrawer.tsx
git commit -m "feat: add ShippingEstimate component in cart drawer"
```

---

## Task 10: E2E Tests

> [DEBATE #9] Full Playwright test implementations with actual mock API endpoint code, not just bullet points.

**Files:**
- Create: `e2e/delivery.spec.ts`
- Modify: `e2e/helpers/mock-api.ts` (add address-check endpoint, shipping estimate on cart)

**Step 1: Add mock API endpoints**

Modify `e2e/helpers/mock-api.ts`. The mock server uses raw Node HTTP (port 4322) with per-test cart isolation via `x-test-cart-id` header.

Add the address-check route handler:

```typescript
// In the route handler switch/if chain, add:

// POST /api/v1/fulfillment/address-check/
if (method === 'POST' && pathname === '/api/v1/fulfillment/address-check/') {
  const body = JSON.parse(await readBody(req));
  const postalCode = (body.postal_code ?? '').replace(/\s/g, '');

  // Amsterdam area: full delivery
  if (postalCode.startsWith('1015') || postalCode.startsWith('1016') || postalCode.startsWith('1017')) {
    return json(res, {
      latitude: 52.3702,
      longitude: 4.8952,
      available_fulfillment_types: ['local_delivery', 'pickup', 'nationwide_delivery'],
      available_shipping_providers: [
        { id: 1, name: 'Uber Direct', type: 'local_delivery' },
        { id: 2, name: 'SooCool', type: 'nationwide_delivery' },
      ],
      pickup_locations: [
        { id: 5, name: "Marco's Amsterdam", distance_km: 1.2 },
      ],
      delivery_unavailable: false,
      near_delivery_zone: false,
    });
  }

  // Remote area: delivery unavailable, pickup only
  if (postalCode.startsWith('9999')) {
    return json(res, {
      latitude: 53.2,
      longitude: 6.5,
      available_fulfillment_types: ['pickup'],
      available_shipping_providers: [],
      pickup_locations: [
        { id: 5, name: "Marco's Amsterdam", distance_km: 180 },
      ],
      delivery_unavailable: true,
      near_delivery_zone: false,
    });
  }

  // Near delivery zone
  if (postalCode.startsWith('1020')) {
    return json(res, {
      latitude: 52.41,
      longitude: 4.92,
      available_fulfillment_types: ['pickup', 'nationwide_delivery'],
      available_shipping_providers: [
        { id: 2, name: 'SooCool', type: 'nationwide_delivery' },
      ],
      pickup_locations: [
        { id: 5, name: "Marco's Amsterdam", distance_km: 5.2 },
      ],
      delivery_unavailable: true,
      near_delivery_zone: true,
    });
  }

  // Unknown postcode
  return json(res, { detail: 'Postcode not found' }, 404);
}
```

Add coordinate-aware product responses (modify the existing products GET handler):

```typescript
// In the GET /api/v1/products/ handler, add fulfillment fields to each product:
// If latitude/longitude query params are present, add available_fulfillment_types and pickup_only
const url = new URL(req.url!, `http://localhost:${PORT}`);
const hasCoords = url.searchParams.has('latitude');

// For each product in the response:
// product.available_fulfillment_types = ['local_delivery', 'pickup'];
// product.pickup_only = false;
```

Add shipping_estimate to cart GET response when coordinates are provided:

```typescript
// In the GET /api/v1/cart/{id}/ handler:
// If latitude/longitude query params are present, add shipping_estimate
if (hasCoords) {
  cartResponse.shipping_estimate = {
    groups: [{
      provider_name: 'Uber Direct',
      fulfillment_type: 'local_delivery',
      status: 'quoted',
      estimated_cost: '3.50',
      items: cart.line_items.map(li => li.product_title),
    }],
    total_shipping: '3.50',
    ships_in_parts: false,
  };
}
```

**Step 2: Write e2e tests**

Create `e2e/delivery.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { resetMockApi, addItemToCart, waitForHydration, blockAnalytics } from './helpers/test-utils';

test.describe('Delivery options', () => {
  test.beforeEach(async ({ page }) => {
    await blockAnalytics(page);
    await resetMockApi(page);
  });

  test('address bar visible in header', async ({ page }) => {
    await page.goto('/nl/');
    await waitForHydration(page);

    const addressBar = page.getByRole('button', { name: /postcode/i });
    await expect(addressBar).toBeVisible();
  });

  test('enter postcode → delivery banner appears', async ({ page }) => {
    await page.goto('/nl/');
    await waitForHydration(page);

    // Expand address bar
    await page.getByRole('button', { name: /postcode/i }).click();

    // Enter Amsterdam postcode
    await page.getByLabel(/postcode/i).fill('1015 BS');
    await page.getByRole('button', { name: /controleren/i }).click();

    // Wait for banner
    await expect(page.getByText(/bezorgen naar 1015 BS/i)).toBeVisible({ timeout: 5000 });
  });

  test('distant postcode → delivery unavailable banner', async ({ page }) => {
    await page.goto('/nl/');
    await waitForHydration(page);

    await page.getByRole('button', { name: /postcode/i }).click();
    await page.getByLabel(/postcode/i).fill('9999 ZZ');
    await page.getByRole('button', { name: /controleren/i }).click();

    await expect(page.getByText(/bezorging is niet beschikbaar/i)).toBeVisible({ timeout: 5000 });
  });

  test('invalid postcode → error message', async ({ page }) => {
    await page.goto('/nl/');
    await waitForHydration(page);

    await page.getByRole('button', { name: /postcode/i }).click();
    await page.getByLabel(/postcode/i).fill('0000');
    await page.getByRole('button', { name: /controleren/i }).click();

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5000 });
  });

  test('clear address → banners removed', async ({ page }) => {
    await page.goto('/nl/');
    await waitForHydration(page);

    // Set address first
    await page.getByRole('button', { name: /postcode/i }).click();
    await page.getByLabel(/postcode/i).fill('1015 BS');
    await page.getByRole('button', { name: /controleren/i }).click();
    await expect(page.getByText(/bezorgen naar 1015 BS/i)).toBeVisible({ timeout: 5000 });

    // Clear it
    await page.getByRole('button', { name: /wissen/i }).click();

    // Banner should disappear
    await expect(page.getByText(/bezorgen naar/i)).not.toBeVisible();
  });

  test('address persists across page reload', async ({ page }) => {
    await page.goto('/nl/');
    await waitForHydration(page);

    // Set address
    await page.getByRole('button', { name: /postcode/i }).click();
    await page.getByLabel(/postcode/i).fill('1015 BS');
    await page.getByRole('button', { name: /controleren/i }).click();
    await expect(page.getByText('1015 BS')).toBeVisible({ timeout: 5000 });

    // Reload
    await page.reload();
    await waitForHydration(page);

    // Should still show postcode
    await expect(page.getByText('1015 BS')).toBeVisible({ timeout: 5000 });
  });

  test('shipping estimate visible in cart when address set', async ({ page }) => {
    await page.goto('/nl/');
    await waitForHydration(page);

    // Set address
    await page.getByRole('button', { name: /postcode/i }).click();
    await page.getByLabel(/postcode/i).fill('1015 BS');
    await page.getByRole('button', { name: /controleren/i }).click();
    await expect(page.getByText('1015 BS')).toBeVisible({ timeout: 5000 });

    // Add item to cart
    await addItemToCart(page);

    // Open cart
    await page.locator('[data-cart-trigger]').click();

    // Should show shipping estimate
    await expect(page.getByText(/verzending/i)).toBeVisible({ timeout: 5000 });
  });
});
```

**Step 3: Run e2e tests**

Run: `pnpm test:e2e e2e/delivery.spec.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add e2e/delivery.spec.ts e2e/helpers/mock-api.ts
git commit -m "feat: add e2e tests for delivery options flow"
```

---

## Task 11: Bundle Size Check & Final Verification

**Step 1: Run bundle size check**

Run: `pnpm size:check`
Expected: PASS — total under 65 KB gzipped

**Step 2: Run full test suite**

Run: `pnpm test`
Expected: All unit tests pass

**Step 3: Run type checking**

Run: `pnpm check`
Expected: No TypeScript errors

**Step 4: Run e2e tests**

Run: `pnpm test:e2e`
Expected: All e2e tests pass (existing + new delivery tests)

**Step 5: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: address review feedback from bundle/test verification"
```

---

## Deferred to Phase 2

The following features are **not** included in this plan and will be implemented when the backend supports delivery time slots:

- **DeliveryOptionsSheet** — half-sheet modal for time slot selection between cart and checkout
- **`$selectedSlots` store** — selected delivery time slots per provider
- **`$isDeliverySheetOpen` atom** — sheet visibility state
- **`deliverySlots` in AddressEligibility** — time slot data from address-check response
- **Checkout interception in CartDrawer** — routing through delivery sheet before checkout
- **`trackDeliveryOptionsCompleted` analytics event** — fires when user completes slot selection
- **~12 additional i18n keys** — asap, estimatedMinutes, estimatedDelivery, continueToCheckout, skipToCheckout, deliveryCostUpdated, deliveryPricingChanging, localDelivery, nationwideShipping, selfDelivery, couldntLoadDelivery, retry, removeFromCart
