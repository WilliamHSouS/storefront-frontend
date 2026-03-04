import { describe, it, expect } from 'vitest';
import {
  getOriginalPrice,
  getEffectivePrice,
  hasUnitDiscount,
  getDiscountLabel,
  getLineTotal,
  getLineSavings,
} from './pricing';

import type { PricedItem } from './pricing';

function makeItem(overrides: Partial<PricedItem> = {}): PricedItem {
  return {
    price: '10.00',
    discount: null,
    ...overrides,
  };
}

describe('getOriginalPrice', () => {
  it('returns the item price as number', () => {
    expect(getOriginalPrice(makeItem())).toBe(10.0);
  });
});

describe('getEffectivePrice', () => {
  it('returns original price when no discount', () => {
    expect(getEffectivePrice(makeItem())).toBe(10.0);
  });

  it('applies percentage discount', () => {
    const item = makeItem({ discount: { type: 'percentage', value: 15 } });
    expect(getEffectivePrice(item)).toBe(8.5);
  });

  it('applies fixed discount', () => {
    const item = makeItem({ discount: { type: 'fixed', value: 2 } });
    expect(getEffectivePrice(item)).toBe(8.0);
  });

  it('does not go below zero', () => {
    const item = makeItem({ discount: { type: 'fixed', value: 20 } });
    expect(getEffectivePrice(item)).toBe(0);
  });

  it('does not apply BOGO at unit level', () => {
    const item = makeItem({ discount: { type: 'bogo', buyQuantity: 1, getQuantity: 1 } });
    expect(getEffectivePrice(item)).toBe(10.0);
  });

  it('does not apply tiered at unit level', () => {
    const item = makeItem({ discount: { type: 'tiered', quantity: 2, price: 15 } });
    expect(getEffectivePrice(item)).toBe(10.0);
  });
});

describe('hasUnitDiscount', () => {
  it('returns true for percentage', () => {
    expect(hasUnitDiscount(makeItem({ discount: { type: 'percentage', value: 10 } }))).toBe(true);
  });

  it('returns true for fixed', () => {
    expect(hasUnitDiscount(makeItem({ discount: { type: 'fixed', value: 2 } }))).toBe(true);
  });

  it('returns false for bogo', () => {
    expect(
      hasUnitDiscount(makeItem({ discount: { type: 'bogo', buyQuantity: 1, getQuantity: 1 } })),
    ).toBe(false);
  });

  it('returns false for no discount', () => {
    expect(hasUnitDiscount(makeItem())).toBe(false);
  });
});

describe('getDiscountLabel', () => {
  it('returns percentage label', () => {
    expect(
      getDiscountLabel(
        makeItem({ discount: { type: 'percentage', value: 15 } }),
        'EUR',
        'nl-NL',
        'en',
      ),
    ).toBe('-15%');
  });

  it('returns fixed label with currency', () => {
    const label = getDiscountLabel(
      makeItem({ discount: { type: 'fixed', value: 2 } }),
      'EUR',
      'nl-NL',
      'en',
    );
    expect(label).toContain('2');
    expect(label).toContain('off');
  });

  it('returns bogo label', () => {
    const label = getDiscountLabel(
      makeItem({ discount: { type: 'bogo', buyQuantity: 1, getQuantity: 1 } }),
      'EUR',
      'nl-NL',
      'en',
    );
    expect(label).toContain('Buy');
  });

  it('returns tiered label', () => {
    const label = getDiscountLabel(
      makeItem({ discount: { type: 'tiered', quantity: 2, price: 15 } }),
      'EUR',
      'nl-NL',
      'en',
    );
    expect(label).toContain('2');
  });

  it('returns empty string when discount is null', () => {
    expect(getDiscountLabel(makeItem({ discount: null }), 'EUR', 'nl-NL', 'en')).toBe('');
  });
});

describe('getLineTotal', () => {
  it('multiplies price by quantity for simple items', () => {
    expect(getLineTotal(makeItem(), 3)).toBe(30.0);
  });

  it('applies percentage discount then multiplies', () => {
    const item = makeItem({ discount: { type: 'percentage', value: 10 } });
    expect(getLineTotal(item, 2)).toBe(18.0);
  });

  it('applies BOGO correctly', () => {
    const item = makeItem({ discount: { type: 'bogo', buyQuantity: 1, getQuantity: 1 } });
    expect(getLineTotal(item, 2)).toBe(10.0);
    expect(getLineTotal(item, 3)).toBe(20.0);
  });

  it('applies tiered pricing', () => {
    const item = makeItem({ discount: { type: 'tiered', quantity: 2, price: 15 } });
    expect(getLineTotal(item, 1)).toBe(10.0);
    expect(getLineTotal(item, 2)).toBe(15.0);
  });

  it('applies tiered pricing across multiple bundles', () => {
    const item = makeItem({ discount: { type: 'tiered', quantity: 2, price: 15 } });
    // 3 items: 1 bundle (15) + 1 remainder at regular (10) = 25
    expect(getLineTotal(item, 3)).toBe(25.0);
    // 4 items: 2 bundles (30) + 0 remainder = 30
    expect(getLineTotal(item, 4)).toBe(30.0);
  });

  it('applies tiered pricing with modifiers', () => {
    const item = makeItem({ discount: { type: 'tiered', quantity: 2, price: 15 } });
    const modifiers = [{ price: '1.00', quantity: 1 }];
    // 2 items: 1 bundle (15) + 2 * modifier (2) = 17
    expect(getLineTotal(item, 2, modifiers)).toBe(17.0);
  });

  it('adds modifier prices', () => {
    const modifiers = [
      { price: '1.50', quantity: 1 },
      { price: '2.00', quantity: 2 },
    ];
    expect(getLineTotal(makeItem(), 1, modifiers)).toBe(15.5);
  });

  it('rounds to 2 decimal places', () => {
    const item = makeItem({ price: '3.33', discount: { type: 'percentage', value: 10 } });
    expect(getLineTotal(item, 1)).toBe(3.0);
  });
});

describe('getLineSavings', () => {
  it('returns 0 with no discount', () => {
    expect(getLineSavings(makeItem(), 2)).toBe(0);
  });

  it('calculates savings for percentage discount', () => {
    const item = makeItem({ discount: { type: 'percentage', value: 50 } });
    expect(getLineSavings(item, 2)).toBe(10.0);
  });
});
