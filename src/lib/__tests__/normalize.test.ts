import { describe, it, expect } from 'vitest';
import { normalizeCart } from '../normalize';

describe('normalizeCart', () => {
  it('maps API cart response with options field to frontend Cart shape', () => {
    const apiResponse = {
      id: 'cart-1',
      line_items: [
        {
          id: 'li-1',
          product_id: 42,
          product_title: 'Falafel Wrap',
          unit_price: '8.50',
          quantity: 2,
          line_total: '20.00',
          options: [
            {
              option_id: 10,
              option_group_id: 5,
              option_title: 'Large',
              option_group_title: 'Size',
              price_modifier: '3.00',
              quantity: 1,
            },
          ],
        },
      ],
      cart_total: '20.00',
      item_count: 2,
    };

    const cart = normalizeCart(apiResponse);

    expect(cart.id).toBe('cart-1');
    expect(cart.line_items).toHaveLength(1);
    expect(cart.line_items[0].product_title).toBe('Falafel Wrap');
    expect(cart.line_items[0].selected_options).toHaveLength(1);
    expect(cart.line_items[0].selected_options![0]).toEqual({
      id: 10,
      name: 'Large',
      price: '3.00',
      quantity: 1,
    });
    expect(cart.cart_total).toBe('20.00');
    expect(cart.item_count).toBe(2);
  });

  it('falls back to selected_options when options field is absent', () => {
    const mockResponse = {
      id: 'cart-1',
      line_items: [
        {
          id: 'li-1',
          product_id: 42,
          product_title: 'Falafel',
          unit_price: '8.50',
          quantity: 1,
          line_total: '8.50',
          selected_options: [{ id: 'opt-1', name: 'Regular', price: '0.00', quantity: 1 }],
        },
      ],
      cart_total: '8.50',
      item_count: 1,
    };

    const cart = normalizeCart(mockResponse);
    expect(cart.line_items[0].selected_options).toEqual([
      { id: 'opt-1', name: 'Regular', price: '0.00', quantity: 1 },
    ]);
  });

  it('handles empty options', () => {
    const apiResponse = {
      id: 'cart-1',
      line_items: [
        {
          id: 'li-1',
          product_id: 42,
          product_title: 'Falafel',
          unit_price: '8.50',
          quantity: 1,
          line_total: '8.50',
          options: [],
        },
      ],
      cart_total: '8.50',
      item_count: 1,
    };

    const cart = normalizeCart(apiResponse);
    expect(cart.line_items[0].selected_options).toEqual([]);
  });

  it('handles missing options field entirely', () => {
    const apiResponse = {
      id: 'cart-1',
      line_items: [
        {
          id: 'li-1',
          product_id: 42,
          product_title: 'Falafel',
          unit_price: '8.50',
          quantity: 1,
          line_total: '8.50',
        },
      ],
      cart_total: '8.50',
      item_count: 1,
    };

    const cart = normalizeCart(apiResponse);
    expect(cart.line_items[0].selected_options).toEqual([]);
  });

  it('preserves cart_savings when present', () => {
    const apiResponse = {
      id: 'cart-1',
      line_items: [],
      cart_total: '5.10',
      cart_savings: '0.90',
      item_count: 0,
    };

    const cart = normalizeCart(apiResponse);
    expect(cart.cart_savings).toBe('0.90');
  });

  it('preserves discount on line items', () => {
    const apiResponse = {
      id: 'cart-1',
      line_items: [
        {
          id: 'li-1',
          product_id: 42,
          product_title: 'Baklava',
          unit_price: '5.10',
          quantity: 1,
          line_total: '5.10',
          options: [],
          discount: { type: 'percentage', label: '15% off', savings: '0.90' },
        },
      ],
      cart_total: '5.10',
      cart_savings: '0.90',
      item_count: 1,
    };

    const cart = normalizeCart(apiResponse);
    expect(cart.line_items[0].discount).toEqual({
      type: 'percentage',
      label: '15% off',
      savings: '0.90',
    });
  });
});
