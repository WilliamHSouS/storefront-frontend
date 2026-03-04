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
    selected_options: Array<{
      id: string;
      name: string;
      group_name?: string;
      price: string;
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
        selected_options: [],
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
        selected_options: [],
      },
      {
        id: 'li-2',
        product_id: 'prod-2',
        product_title: 'Shawarma Bowl',
        product_image: 'https://images.example.com/shawarma-bowl.jpg',
        quantity: 1,
        unit_price: '14.50',
        line_total: '14.50',
        selected_options: [
          { id: '201', name: 'Regular', group_name: 'Size', price: '0.00', quantity: 1 },
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
        selected_options: [
          { id: '201', name: 'Regular', group_name: 'Size', price: '0.00', quantity: 1 },
          {
            id: '205',
            name: 'Extra Cheese',
            group_name: 'Extras',
            price: '2.00',
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
        selected_options: [],
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
