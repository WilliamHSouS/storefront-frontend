/** Product and category fixture data matching the API response shapes. */

export const categories = [
  { id: 'cat-1', name: 'Starters', slug: 'starters' },
  { id: 'cat-2', name: 'Main Courses', slug: 'main-courses' },
  { id: 'cat-3', name: 'Drinks', slug: 'drinks' },
];

export const products = [
  {
    id: 'prod-1',
    name: 'Falafel Wrap',
    slug: 'falafel-wrap',
    price: '8.50',
    description: 'Crispy falafel with tahini, vegetables, and fresh herbs.',
    image: 'https://images.example.com/falafel-wrap.jpg',
    category_id: 'cat-1',
    sold_out: false,
  },
  {
    id: 'prod-2',
    name: 'Shawarma Bowl',
    slug: 'shawarma-bowl',
    price: '14.50',
    description: 'Slow-roasted chicken shawarma with rice, hummus, and garlic sauce.',
    image: 'https://images.example.com/shawarma-bowl.jpg',
    category_id: 'cat-2',
    sold_out: false,
    modifier_groups: [{ id: '100' }, { id: '101' }],
  },
  {
    id: 'prod-3',
    name: 'Mint Lemonade',
    slug: 'mint-lemonade',
    price: '4.50',
    description: 'Fresh mint and lemon blended with ice.',
    image: null,
    category_id: 'cat-3',
    sold_out: false,
  },
  {
    id: 'prod-4',
    name: 'Baklava',
    slug: 'baklava',
    price: '6.00',
    description: 'Layers of phyllo pastry with pistachios and honey syrup.',
    image: 'https://images.example.com/baklava.jpg',
    category_id: 'cat-1',
    sold_out: true,
    discount: { type: 'percentage', value: 15 },
  },
];

/** Full product detail (with modifier groups) for prod-2 Shawarma Bowl */
export const shawarmaDetail = {
  ...products[1],
  modifier_groups: [
    {
      id: '100',
      name: 'Size',
      type: 'radio' as const,
      selection_type: 'single' as const,
      required: true,
      options: [
        { id: '201', name: 'Regular', price: '0.00' },
        { id: '202', name: 'Large', price: '3.00' },
      ],
    },
    {
      id: '101',
      name: 'Extras',
      type: 'checkbox' as const,
      selection_type: 'multiple' as const,
      required: false,
      max_selections: 3,
      options: [
        { id: '203', name: 'Halloumi', price: '2.50' },
        { id: '204', name: 'Avocado', price: '2.00' },
      ],
    },
  ],
  cross_sells: [
    {
      id: 'prod-3',
      name: 'Mint Lemonade',
      price: '4.50',
      image: null,
    },
  ],
};

/** Simple product detail (no modifiers) for prod-1 Falafel Wrap */
export const falafelDetail = {
  ...products[0],
  modifier_groups: [],
  cross_sells: [],
};
