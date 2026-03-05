/** Cart state fixtures matching the API Cart response shape. */

export interface CartFixture {
  id: string;
  line_items: Array<{
    id: string;
    product_id: string;
    product_title: string;
    product_image?: string;
    quantity: number;
    unit_price: string;
    line_total: string;
    options: Array<{
      option_id: string;
      option_title: string;
      option_group_title: string;
      price_modifier: string;
      quantity: number;
    }>;
    discount?: {
      type: string;
      label: string;
      savings: string;
    };
    notes?: string;
  }>;
  cart_total: string;
  cart_savings?: string;
  item_count: number;
  subtotal?: string;
  tax_total?: string;
  tax_included?: boolean;
  shipping_cost?: string;
  discount_amount?: string;
  promotion_discount_amount?: string;
  applied_discount?: {
    id: string;
    code: string;
    name: string;
    discount_amount: string;
  };
}

export function emptyCart(): CartFixture {
  return {
    id: 'cart-test-001',
    line_items: [],
    cart_total: '0.00',
    item_count: 0,
  };
}

export function cartWithOneItem(): CartFixture {
  return {
    id: 'cart-test-001',
    line_items: [
      {
        id: 'li-1',
        product_id: 'prod-1',
        product_title: 'Falafel Wrap',
        product_image: 'https://images.example.com/falafel-wrap.jpg',
        quantity: 1,
        unit_price: '8.50',
        line_total: '8.50',
        options: [],
      },
    ],
    cart_total: '8.50',
    item_count: 1,
  };
}

export function cartWithMultipleItems(): CartFixture {
  return {
    id: 'cart-test-001',
    line_items: [
      {
        id: 'li-1',
        product_id: 'prod-1',
        product_title: 'Falafel Wrap',
        product_image: 'https://images.example.com/falafel-wrap.jpg',
        quantity: 2,
        unit_price: '8.50',
        line_total: '17.00',
        options: [],
      },
      {
        id: 'li-2',
        product_id: 'prod-2',
        product_title: 'Shawarma Bowl',
        product_image: 'https://images.example.com/shawarma-bowl.jpg',
        quantity: 1,
        unit_price: '14.50',
        line_total: '14.50',
        options: [
          {
            option_id: 'opt-regular',
            option_title: 'Regular',
            option_group_title: 'Size',
            price_modifier: '0.00',
            quantity: 1,
          },
        ],
      },
    ],
    cart_total: '31.50',
    item_count: 3,
  };
}

export function cartWithModifiers(): CartFixture {
  return {
    id: 'cart-test-001',
    line_items: [
      {
        id: 'li-1',
        product_id: 'prod-2',
        product_title: 'Shawarma Bowl',
        product_image: 'https://images.example.com/shawarma-bowl.jpg',
        quantity: 1,
        unit_price: '14.50',
        line_total: '16.50',
        options: [
          {
            option_id: '201',
            option_title: 'Regular',
            option_group_title: 'Size',
            price_modifier: '0.00',
            quantity: 1,
          },
          {
            option_id: '205',
            option_title: 'Extra Cheese',
            option_group_title: 'Extras',
            price_modifier: '2.00',
            quantity: 1,
          },
        ],
      },
    ],
    cart_total: '16.50',
    item_count: 1,
  };
}

export function cartWithDiscount(): CartFixture {
  return {
    id: 'cart-test-001',
    line_items: [
      {
        id: 'li-1',
        product_id: 'prod-4',
        product_title: 'Baklava',
        product_image: 'https://images.example.com/baklava.jpg',
        quantity: 1,
        unit_price: '5.10',
        line_total: '5.10',
        options: [],
        discount: {
          type: 'percentage',
          label: '15% off',
          savings: '0.90',
        },
      },
    ],
    cart_total: '5.10',
    cart_savings: '0.90',
    item_count: 1,
  };
}
