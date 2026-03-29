/** Product and category fixture data matching the API response shapes. */

export const categories = [
  {
    id: 'cat-1',
    name: 'Starters',
    slug: 'starters',
    description: '',
    parent_id: null,
    depth: 0,
    children: [],
    product_count: 2,
  },
  {
    id: 'cat-2',
    name: 'Main Courses',
    slug: 'main-courses',
    description: '',
    parent_id: null,
    depth: 0,
    children: [],
    product_count: 1,
  },
  {
    id: 'cat-3',
    name: 'Drinks',
    slug: 'drinks',
    description: '',
    parent_id: null,
    depth: 0,
    children: [],
    product_count: 1,
  },
];

/** Default values for OpenAPI-required product fields. */
function productDefaults() {
  return {
    address_fulfillment_types: ['local_delivery', 'pickup'],
    availability_state: 'available',
    intro: '',
    created_at: '2025-01-01T00:00:00Z',
    images: [] as Array<{ id: number; image_url: string; alt: string; position: number }>,
    merchant_id: 1,
    pickup_only: false,
    is_popular: false,
    is_trending: false,
    popularity_rank: null as number | null,
    trend_score: null as string | null,
    product_type: { id: 1, name: 'physical', slug: 'physical' },
    tags: [] as string[],
    updated_at: '2025-01-01T00:00:00Z',
    vat_rate: '0.09',
  };
}

export const products = [
  {
    id: 'prod-1',
    title: 'Falafel Wrap',
    slug: 'falafel-wrap',
    price: '8.50',
    description: 'Crispy falafel with tahini, vegetables, and fresh herbs.',
    image: 'https://images.example.com/falafel-wrap.jpg',
    category_id: 'cat-1',
    sold_out: false,
    ...productDefaults(),
    is_popular: true,
    popularity_rank: 1,
    tags: ['popular'],
    images: [
      {
        id: 1,
        image_url: 'https://images.example.com/falafel-wrap.jpg',
        alt: 'Falafel Wrap',
        position: 0,
      },
    ],
  },
  {
    id: 'prod-2',
    title: 'Shawarma Bowl',
    slug: 'shawarma-bowl',
    price: '14.50',
    description: 'Slow-roasted chicken shawarma with rice, hummus, and garlic sauce.',
    image: 'https://images.example.com/shawarma-bowl.jpg',
    category_id: 'cat-2',
    sold_out: false,
    modifier_groups: [{ id: '100' }, { id: '101' }],
    ...productDefaults(),
    images: [
      {
        id: 2,
        image_url: 'https://images.example.com/shawarma-bowl.jpg',
        alt: 'Shawarma Bowl',
        position: 0,
      },
    ],
  },
  {
    id: 'prod-3',
    title: 'Mint Lemonade',
    slug: 'mint-lemonade',
    price: '4.50',
    description: 'Fresh mint and lemon blended with ice.',
    image: null,
    category_id: 'cat-3',
    sold_out: false,
    ...productDefaults(),
  },
  {
    id: 'prod-4',
    title: 'Baklava',
    slug: 'baklava',
    price: '6.00',
    description: 'Layers of phyllo pastry with pistachios and honey syrup.',
    image: 'https://images.example.com/baklava.jpg',
    category_id: 'cat-1',
    sold_out: true,
    discount: { type: 'percentage', value: 15 },
    ...productDefaults(),
    availability_state: 'sold_out',
    images: [
      { id: 4, image_url: 'https://images.example.com/baklava.jpg', alt: 'Baklava', position: 0 },
    ],
  },
];

/** Full product detail (with modifier groups) for prod-2 Shawarma Bowl */
export const shawarmaDetail = {
  ...products[1],
  modifier_groups: [
    {
      id: 'mod-size',
      title: 'Size',
      type: 'radio' as const,
      selection_type: 'single' as const,
      required: true,
      options: [
        { id: 'opt-regular', title: 'Regular', price_modifier: '0.00' },
        { id: 'opt-large', title: 'Large', price_modifier: '3.00' },
      ],
    },
    {
      id: 'mod-extras',
      title: 'Extras',
      type: 'checkbox' as const,
      selection_type: 'multiple' as const,
      required: false,
      max_selections: 3,
      options: [
        { id: 'opt-halloumi', title: 'Halloumi', price_modifier: '2.50' },
        { id: 'opt-avocado', title: 'Avocado', price_modifier: '2.00' },
      ],
    },
  ],
};

/** Simple product detail (no modifiers) for prod-1 Falafel Wrap */
export const falafelDetail = {
  ...products[0],
  modifier_groups: [],
};

/** Suggestion fixtures matching backend SuggestionSerializer shape */
export const suggestions: Record<
  string,
  Array<{
    id: number;
    title: string;
    price: string;
    currency: string;
    image_url: string;
    reason: string;
  }>
> = {
  // PDP suggestions for Shawarma Bowl → suggest Mint Lemonade + Baklava
  'prod-2': [
    {
      id: 3, // matches prod-3 numerically
      title: 'Mint Lemonade',
      price: '4.50',
      currency: 'EUR',
      image_url: '',
      reason: 'product_rule',
    },
    {
      id: 4, // matches prod-4 numerically
      title: 'Baklava',
      price: '6.00',
      currency: 'EUR',
      image_url: 'https://images.example.com/baklava.jpg',
      reason: 'category_rule',
    },
  ],
  // PDP suggestions for Falafel Wrap → suggest Mint Lemonade
  'prod-1': [
    {
      id: 3,
      title: 'Mint Lemonade',
      price: '4.50',
      currency: 'EUR',
      image_url: '',
      reason: 'product_rule',
    },
  ],
  // Cart-level suggestions (used for any cart)
  cart: [
    {
      id: 3,
      title: 'Mint Lemonade',
      price: '4.50',
      currency: 'EUR',
      image_url: '',
      reason: 'global_rule',
    },
  ],
};
