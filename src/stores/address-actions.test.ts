import { describe, it, expect, beforeEach, vi } from 'vitest';
import { $addressCoords, $addressEligibility } from './address';
import { $cart } from './cart';

const mockPOST = vi.fn();
const mockGET = vi.fn();

vi.mock('@/lib/api', () => ({
  getClient: () => ({ GET: mockGET, POST: mockPOST }),
}));

// Must import after mock setup
const { onAddressChange, clearAddress, hydrateAddressFromStorage, _resetHydrateGuard } =
  await import('./address-actions');

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

  it('returns invalid_response when lat/lng are not numbers', async () => {
    mockPOST.mockResolvedValue({
      data: { latitude: 'not-a-number', longitude: null },
      error: null,
    });

    const result = await onAddressChange({ postalCode: '1015', country: 'NL' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_response');
    expect($addressCoords.get()).toBeNull();
  });

  it('returns network error when API call throws', async () => {
    mockPOST.mockRejectedValue(new Error('fetch failed'));

    const result = await onAddressChange({ postalCode: '1015', country: 'NL' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('network');
  });

  it('re-fetches cart with coordinates when cart exists', async () => {
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
          query: { latitude: 52.3702, longitude: 4.8952, postal_code: '1015 BS' },
        }),
      }),
    );
  });
});

describe('hydrateAddressFromStorage', () => {
  beforeEach(() => {
    $addressCoords.set(null);
    $addressEligibility.set(null);
    localStorage.clear();
    mockPOST.mockReset();
    _resetHydrateGuard();
  });

  it('sets coords from cache before API call resolves', async () => {
    const stored = {
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
      storedAt: Date.now(),
    };
    localStorage.setItem('sous_address', JSON.stringify(stored));

    // Delay the API response so we can check the immediate state
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

    await hydrateAddressFromStorage();

    // Coords should be set from cache
    expect($addressCoords.get()!.postalCode).toBe('1015 BS');
    // Eligibility should be set from the API re-fetch
    expect($addressEligibility.get()).not.toBeNull();
  });

  it('is a no-op when no stored address exists', async () => {
    await hydrateAddressFromStorage();

    expect($addressCoords.get()).toBeNull();
    expect(mockPOST).not.toHaveBeenCalled();
  });

  it('deduplicates: calling twice only triggers one API call', async () => {
    const stored = {
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
      storedAt: Date.now(),
    };
    localStorage.setItem('sous_address', JSON.stringify(stored));

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

    // Call twice without resetting the guard
    await hydrateAddressFromStorage();
    await hydrateAddressFromStorage();

    // Only one API call should have been made
    expect(mockPOST).toHaveBeenCalledTimes(1);
  });
});

describe('onAddressChange – pickup_locations type guard', () => {
  beforeEach(() => {
    $addressCoords.set(null);
    $addressEligibility.set(null);
    $cart.set(null);
    localStorage.clear();
    mockPOST.mockReset();
    mockGET.mockReset();
  });

  it('filters out pickup locations with missing name', async () => {
    mockPOST.mockResolvedValue({
      data: {
        latitude: 52.3702,
        longitude: 4.8952,
        available_fulfillment_types: ['pickup'],
        available_shipping_providers: [],
        pickup_locations: [
          { id: 1, name: 'Valid Store', distance_km: 1.5 },
          { id: 2, distance_km: 2.0 }, // missing name
        ],
        delivery_unavailable: false,
        near_delivery_zone: false,
      },
      error: null,
    });

    await onAddressChange({ postalCode: '1015 BS', country: 'NL' });

    const elig = $addressEligibility.get()!;
    expect(elig.pickupLocations).toHaveLength(1);
    expect(elig.pickupLocations[0].name).toBe('Valid Store');
  });

  it('filters out pickup locations with non-numeric distance_km', async () => {
    mockPOST.mockResolvedValue({
      data: {
        latitude: 52.3702,
        longitude: 4.8952,
        available_fulfillment_types: ['pickup'],
        available_shipping_providers: [],
        pickup_locations: [
          { id: 1, name: 'Good Store', distance_km: 0.5 },
          { id: 2, name: 'Bad Store', distance_km: 'not-a-number' },
        ],
        delivery_unavailable: false,
        near_delivery_zone: false,
      },
      error: null,
    });

    await onAddressChange({ postalCode: '1015 BS', country: 'NL' });

    const elig = $addressEligibility.get()!;
    expect(elig.pickupLocations).toHaveLength(1);
    expect(elig.pickupLocations[0].name).toBe('Good Store');
  });
});

describe('onAddressChange – availableFulfillmentTypes filters non-string values', () => {
  beforeEach(() => {
    $addressCoords.set(null);
    $addressEligibility.set(null);
    $cart.set(null);
    localStorage.clear();
    mockPOST.mockReset();
    mockGET.mockReset();
  });

  it('filters out non-string and invalid fulfillment types', async () => {
    mockPOST.mockResolvedValue({
      data: {
        latitude: 52.3702,
        longitude: 4.8952,
        available_fulfillment_types: ['local_delivery', 42, null, 'pickup', 'invalid_type'],
        available_shipping_providers: [],
        pickup_locations: [],
        delivery_unavailable: false,
        near_delivery_zone: false,
      },
      error: null,
    });

    await onAddressChange({ postalCode: '1015 BS', country: 'NL' });

    const elig = $addressEligibility.get()!;
    // Only valid string values that match the allowed types should remain
    expect(elig.availableFulfillmentTypes).toEqual(['local_delivery', 'pickup']);
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

  it('clears stale shipping_estimate from cart', () => {
    $cart.set({
      id: 'cart-1',
      line_items: [],
      cart_total: '0.00',
      item_count: 0,
      shipping_estimate: {
        groups: [
          {
            provider_name: 'PostNL',
            fulfillment_type: 'local_delivery',
            status: 'quoted',
            estimated_cost: '4.95',
            items: [],
          },
        ],
        total_shipping: '4.95',
        ships_in_parts: false,
      },
    });

    clearAddress();

    expect($cart.get()?.shipping_estimate).toBeUndefined();
  });
});
