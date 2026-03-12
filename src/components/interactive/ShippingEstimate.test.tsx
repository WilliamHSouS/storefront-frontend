import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { ShippingEstimate } from './ShippingEstimate';
import { $addressCoords } from '@/stores/address';

describe('ShippingEstimate', () => {
  beforeEach(() => {
    cleanup();
    $addressCoords.set(null);
  });

  it('shows "add postcode" prompt when no address set', () => {
    const { getByText } = render(
      <ShippingEstimate lang="en" currency="EUR" shippingEstimate={null} />,
    );
    expect(getByText(/add your postcode/i)).toBeTruthy();
  });

  it('dispatches address-bar:expand when "add postcode" is clicked', () => {
    const handler = vi.fn();
    document.addEventListener('address-bar:expand', handler);

    const { getByText } = render(
      <ShippingEstimate lang="en" currency="EUR" shippingEstimate={null} />,
    );
    fireEvent.click(getByText(/add your postcode/i));
    expect(handler).toHaveBeenCalled();

    document.removeEventListener('address-bar:expand', handler);
  });

  it('shows single shipping line for single group', () => {
    $addressCoords.set({ postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 });

    const estimate = {
      groups: [
        {
          provider_name: 'Uber Direct',
          fulfillment_type: 'local_delivery',
          status: 'quoted' as const,
          estimated_cost: '3.50',
          items: ['Burger'],
        },
      ],
      total_shipping: '3.50',
      ships_in_parts: false,
    };

    const { getByText } = render(
      <ShippingEstimate lang="en" currency="EUR" shippingEstimate={estimate} />,
    );
    expect(getByText(/shipping/i)).toBeTruthy();
  });

  it('shows "calculated at checkout" for pending groups', () => {
    $addressCoords.set({ postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 });

    const estimate = {
      groups: [
        {
          provider_name: 'Uber Direct',
          fulfillment_type: 'local_delivery',
          status: 'pending' as const,
          estimated_cost: null,
          items: ['Burger'],
        },
      ],
      total_shipping: null,
      ships_in_parts: false,
    };

    const { getByText } = render(
      <ShippingEstimate lang="en" currency="EUR" shippingEstimate={estimate} />,
    );
    expect(getByText(/calculated at checkout/i)).toBeTruthy();
  });

  it('auto-expands when ships_in_parts is true', () => {
    $addressCoords.set({ postalCode: '1015', country: 'NL', latitude: 52.37, longitude: 4.89 });

    const estimate = {
      groups: [
        {
          provider_name: 'Uber Direct',
          fulfillment_type: 'local_delivery',
          status: 'quoted' as const,
          estimated_cost: '3.50',
          items: ['Burger'],
        },
        {
          provider_name: 'SooCool',
          fulfillment_type: 'nationwide_delivery',
          status: 'calculated' as const,
          estimated_cost: '6.95',
          items: ['Truffle Oil'],
        },
      ],
      total_shipping: '10.45',
      ships_in_parts: true,
    };

    const { getByText } = render(
      <ShippingEstimate lang="en" currency="EUR" shippingEstimate={estimate} />,
    );
    expect(getByText(/Uber Direct/)).toBeTruthy();
    expect(getByText(/SooCool/)).toBeTruthy();
  });
});
