/** Cart state fixtures matching the API Cart response shape. */

export interface CartLineItemFixture {
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
  /** OpenAPI fields — optional in fixtures, defaults added by mock API */
  fulfillment_type?: string;
  fulfillment_date?: string;
  tax_rate?: string;
  tax_amount?: string;
  product_type?: string;
  surcharges?: unknown[];
  gift_card_details?: Record<string, unknown> | null;
  discount?: {
    type: string;
    label: string;
    savings: string;
  };
  notes?: string;
}

export interface CartFixture {
  id: string;
  line_items: CartLineItemFixture[];
  cart_total: string;
  cart_savings?: string;
  item_count: number;
  /** OpenAPI fields — optional in fixtures, defaults added by mock API */
  merchant_id?: number;
  status?: string;
  subtotal?: string;
  tax_total?: string;
  tax_included?: boolean;
  shipping_cost?: string;
  shipping_estimate?: {
    groups: unknown[];
    total_shipping: string;
    ships_in_parts: boolean;
  } | null;
  discount?: Record<string, unknown> | null;
  estimated_total?: string;
  discount_amount?: string;
  promotion_discount_amount?: string;
  promotion?: { id: number; name: string; discount_amount: string } | null;
  expires_at?: string;
  created_at?: string;
  updated_at?: string;
  applied_discount?: {
    id: string;
    code: string;
    name: string;
    discount_amount: string;
  };
}

/** Default values for OpenAPI-required Cart fields. */
function cartDefaults(): Pick<
  CartFixture,
  | 'merchant_id'
  | 'status'
  | 'subtotal'
  | 'tax_total'
  | 'estimated_total'
  | 'shipping_estimate'
  | 'discount'
  | 'promotion'
  | 'expires_at'
  | 'created_at'
  | 'updated_at'
> {
  return {
    merchant_id: 1,
    status: 'active',
    subtotal: '0.00',
    tax_total: '0.00',
    estimated_total: '0.00',
    shipping_estimate: null,
    discount: null,
    promotion: null,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Default values for OpenAPI-required CartLineItem fields. */
function lineItemDefaults(): Pick<
  CartLineItemFixture,
  | 'fulfillment_type'
  | 'fulfillment_date'
  | 'tax_rate'
  | 'tax_amount'
  | 'product_type'
  | 'surcharges'
  | 'gift_card_details'
> {
  return {
    fulfillment_type: 'local_delivery',
    fulfillment_date: new Date().toISOString().slice(0, 10),
    tax_rate: '0.09',
    tax_amount: '0.00',
    product_type: 'physical',
    surcharges: [],
    gift_card_details: null,
  };
}

export function emptyCart(): CartFixture {
  return {
    id: 'cart-test-001',
    line_items: [],
    cart_total: '0.00',
    item_count: 0,
    ...cartDefaults(),
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
        ...lineItemDefaults(),
      },
    ],
    cart_total: '8.50',
    item_count: 1,
    ...cartDefaults(),
    subtotal: '8.50',
    tax_total: '0.70',
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
        ...lineItemDefaults(),
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
        ...lineItemDefaults(),
      },
    ],
    cart_total: '31.50',
    item_count: 3,
    ...cartDefaults(),
    subtotal: '31.50',
    tax_total: '2.60',
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
        ...lineItemDefaults(),
      },
    ],
    cart_total: '16.50',
    item_count: 1,
    ...cartDefaults(),
    subtotal: '16.50',
    tax_total: '1.36',
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
        ...lineItemDefaults(),
      },
    ],
    cart_total: '5.10',
    cart_savings: '0.90',
    item_count: 1,
    ...cartDefaults(),
    subtotal: '5.10',
    tax_total: '0.42',
  };
}
