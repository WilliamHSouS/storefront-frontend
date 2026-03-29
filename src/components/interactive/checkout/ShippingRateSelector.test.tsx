import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import type { ShippingGroup } from '@/types/checkout';

vi.mock('@/i18n/client', () => ({
  t: (key: string, _lang: string, params?: Record<string, string>) => {
    if (key === 'shippingRateExpiresSoon' && params?.minutes) {
      return `Price valid for ${params.minutes} min`;
    }
    return key;
  },
}));

vi.mock('@/lib/currency', () => ({
  formatPrice: (price: string, currency: string) => `${currency} ${price}`,
  langToLocale: () => 'en-US',
}));

const staticGroup: ShippingGroup = {
  id: 'grp-1',
  merchant_shipping_provider_id: 1,
  shipping_cost: '5.00',
  selected_rate_id: null,
  is_digital: false,
  available_rates: [
    {
      id: 'rate-static',
      name: 'Standard Delivery',
      cost: '5.00',
      original_cost: '5.00',
      rate_id: 'local_delivery',
      expires_at: null,
    },
  ],
  line_items: [],
};

const mixedGroup: ShippingGroup = {
  id: 'grp-1',
  merchant_shipping_provider_id: 1,
  shipping_cost: '5.00',
  selected_rate_id: null,
  is_digital: false,
  available_rates: [
    {
      id: 'rate-static',
      name: 'Standard Delivery',
      cost: '5.00',
      original_cost: '5.00',
      rate_id: 'local_delivery',
      expires_at: null,
    },
    {
      id: 'rate-uber',
      name: 'Uber Direct',
      cost: '6.00',
      original_cost: '6.00',
      rate_id: 'dqt_abc123',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  ],
  line_items: [],
};

describe('ShippingRateSelector', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders nothing when groups have only one rate', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const onSelect = vi.fn();
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[staticGroup]}
        selectedRateId={null}
        onRateSelect={onSelect}
        loading={false}
      />,
    );
    // Single rate = no picker rendered (component returns null)
    expect(container.innerHTML).toBe('');
  });

  it('renders rate options when multiple rates exist', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const onSelect = vi.fn();
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[mixedGroup]}
        selectedRateId={null}
        onRateSelect={onSelect}
        loading={false}
      />,
    );
    expect(container.querySelectorAll('[data-rate-id]')).toHaveLength(2);
    expect(container.textContent).toContain('Standard Delivery');
    expect(container.textContent).toContain('Uber Direct');
  });

  it('calls onRateSelect when a rate is clicked', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const onSelect = vi.fn();
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[mixedGroup]}
        selectedRateId={null}
        onRateSelect={onSelect}
        loading={false}
      />,
    );
    const uberRate = container.querySelector('[data-rate-id="rate-uber"]')!;
    fireEvent.click(uberRate);
    expect(onSelect).toHaveBeenCalledWith('grp-1', 'rate-uber');
  });

  it('highlights the selected rate', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[mixedGroup]}
        selectedRateId="rate-uber"
        onRateSelect={vi.fn()}
        loading={false}
      />,
    );
    const uberRate = container.querySelector('[data-rate-id="rate-uber"]')!;
    expect(uberRate.className).toContain('border-primary');
  });

  it('shows expiry indicator for dynamic rates', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[mixedGroup]}
        selectedRateId={null}
        onRateSelect={vi.fn()}
        loading={false}
      />,
    );
    expect(container.textContent).toContain('Price valid for');
  });

  it('shows loading state', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[]}
        selectedRateId={null}
        onRateSelect={vi.fn()}
        loading={true}
      />,
    );
    expect(container.textContent).toContain('shippingRateRefreshing');
  });
});
