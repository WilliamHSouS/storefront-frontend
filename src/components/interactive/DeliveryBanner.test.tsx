import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/preact';
import { DeliveryBanner } from './DeliveryBanner';
import { $addressCoords, $addressEligibility } from '@/stores/address';

describe('DeliveryBanner', () => {
  beforeEach(() => {
    cleanup();
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
