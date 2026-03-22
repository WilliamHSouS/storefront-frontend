import {
  $addressCoords,
  $addressEligibility,
  setStoredAddress,
  clearStoredAddress,
  getStoredAddress,
} from './address';
import { $cart, getStoredCartId, errorDetail } from './cart';
import { getClient } from '@/lib/api';
import { normalizeCart } from '@/lib/normalize';
import type { AddressCoords, AddressEligibility } from '@/types/address';
import * as log from '@/lib/logger';

/**
 * Parse a raw address-check API response into typed coords + eligibility.
 * Pure function — no side effects, fully unit-testable.
 */
export function parseAddressResponse(
  data: Record<string, unknown>,
  input: { postalCode: string; country: string },
): { coords: AddressCoords; eligibility: AddressEligibility } | { error: string } {
  const lat = Number(data.latitude);
  const lng = Number(data.longitude);
  if (isNaN(lat) || isNaN(lng)) {
    return { error: 'invalid_response' };
  }

  const coords: AddressCoords = {
    postalCode: input.postalCode,
    country: input.country,
    latitude: lat,
    longitude: lng,
  };

  const pickupLocations = Array.isArray(data.pickup_locations)
    ? data.pickup_locations.filter(
        (l: unknown): l is { id: number; name: string; distance_km: number } =>
          !!l &&
          typeof l === 'object' &&
          'name' in l &&
          typeof (l as Record<string, unknown>).distance_km === 'number',
      )
    : [];

  const eligibility: AddressEligibility = {
    availableFulfillmentTypes: Array.isArray(data.available_fulfillment_types)
      ? (data.available_fulfillment_types as string[]).filter(
          (t): t is 'local_delivery' | 'pickup' | 'nationwide_delivery' =>
            typeof t === 'string' &&
            ['local_delivery', 'pickup', 'nationwide_delivery'].includes(t),
        )
      : [],
    availableShippingProviders: Array.isArray(data.available_shipping_providers)
      ? data.available_shipping_providers
      : [],
    pickupLocations,
    deliveryUnavailable: data.delivery_unavailable === true,
    nearDeliveryZone: data.near_delivery_zone === true,
    nearestPickupLocation:
      pickupLocations.length > 0
        ? { name: pickupLocations[0].name, distance_km: pickupLocations[0].distance_km }
        : undefined,
  };

  return { coords, eligibility };
}

export async function onAddressChange(
  input: { postalCode: string; country: string },
  options: { skipCoordsSet?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const client = getClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK missing this endpoint
    const { data, error } = await client.POST('/api/v1/fulfillment/address-check/' as any, {
      body: { postal_code: input.postalCode, country: input.country },
    });

    if (error || !data) {
      return { success: false, error: errorDetail(error) };
    }

    const parsed = parseAddressResponse(data as Record<string, unknown>, input);
    if ('error' in parsed) {
      return { success: false, error: parsed.error };
    }
    const { coords, eligibility } = parsed;

    // 1. Set stores (skip coords if already set by caller, e.g. hydration from cache)
    if (!options.skipCoordsSet) {
      $addressCoords.set(coords);
    }
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
  } catch (err) {
    log.error('address', 'onAddressChange failed:', err);
    return { success: false, error: 'network' };
  }
}

export function clearAddress(): void {
  $addressCoords.set(null);
  $addressEligibility.set(null);
  clearStoredAddress();
  // Clear stale shipping estimate from cart so CartDrawer doesn't show outdated data
  const cart = $cart.get();
  if (cart?.shipping_estimate) {
    $cart.set({ ...cart, shipping_estimate: undefined });
  }
}

/** Uses normalizeCart() to maintain boundary normalization invariant */
async function refreshCartWithCoords(cartId: string, coords: AddressCoords): Promise<void> {
  try {
    const client = getClient();
    const { data } = await client.GET('/api/v1/cart/{cart_id}/', {
      params: {
        path: { cart_id: cartId },
        query: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          postal_code: coords.postalCode,
        },
      },
    });
    if (data) {
      $cart.set(normalizeCart(data as Record<string, unknown>));
    }
  } catch (err) {
    // Cart refresh failure is non-blocking — estimate just won't show
    log.error('address', 'refreshCartWithCoords failed (non-blocking):', err);
  }
}

// Guard against multiple hydration calls. Uses a window property so the guard
// survives Vite HMR (module-level variables reset on hot reload).
export function hydrateAddressFromStorage(): Promise<void> {
  if (typeof window !== 'undefined' && window.__sous_address_hydrated__) {
    return Promise.resolve();
  }
  if (typeof window !== 'undefined') {
    window.__sous_address_hydrated__ = true;
  }
  return _doHydrate();
}

/** @internal Reset hydration guard — only for tests */
export function _resetHydrateGuard(): void {
  if (typeof window !== 'undefined') {
    delete window.__sous_address_hydrated__;
  }
}

async function _doHydrate(): Promise<void> {
  const stored = getStoredAddress();
  if (!stored) return;

  // Set cached coords immediately so the UI shows the postcode right away.
  $addressCoords.set({
    postalCode: stored.postalCode,
    country: stored.country,
    latitude: stored.latitude,
    longitude: stored.longitude,
  });

  // Re-fetch volatile eligibility data in background.
  // Pass skipCoordsSet to avoid a redundant $addressCoords.set that would
  // trigger downstream effects (FulfillmentOverlay) a second time.
  await onAddressChange(
    { postalCode: stored.postalCode, country: stored.country },
    { skipCoordsSet: true },
  );
}

// ── Inline Analytics ───────────────────────────────────────────
// Inlined here instead of a separate module — only 2 events at launch.

function truncatePostcode(postalCode: string): string {
  return postalCode.replace(/\s/g, '').slice(0, 3);
}

function capture(event: string, properties: Record<string, unknown>): void {
  if (typeof window !== 'undefined') {
    window.posthog?.capture(event, properties);
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
