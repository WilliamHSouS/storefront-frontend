import { describe, it, expect } from 'vitest';
import {
  slugify,
  normalizeProduct,
  normalizeCart,
  extractIdFromSlug,
  normalizeCollection,
  flattenCategories,
  parseMetadataMap,
} from '@/lib/normalize';

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------
describe('slugify', () => {
  it('converts title to lowercase kebab-case', () => {
    expect(slugify('Falafel Wrap')).toBe('falafel-wrap');
  });

  it('handles diacritics', () => {
    expect(slugify('Crème Brûlée')).toBe('creme-brulee');
  });

  it('handles umlauts', () => {
    expect(slugify('Käsespätzle')).toBe('kasespatzle');
  });

  it('strips special characters', () => {
    expect(slugify('Fish & Chips (large)')).toBe('fish-chips-large');
  });

  it('collapses multiple hyphens to single', () => {
    expect(slugify('a   b---c')).toBe('a-b-c');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
    expect(slugify('  hello  ')).toBe('hello');
  });

  it('never produces -- in output (separator invariant)', () => {
    // Various inputs that might trick a naive implementation
    const inputs = [
      'hello  world',
      'a - b',
      'a -- b',
      'test---test',
      '---leading',
      'trailing---',
      'Crème -- Brûlée',
      'a!@#$%^&*()b',
    ];
    for (const input of inputs) {
      const result = slugify(input);
      expect(result).not.toContain('--');
    }
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });

  it('handles numeric input', () => {
    expect(slugify('Product 42')).toBe('product-42');
  });
});

// ---------------------------------------------------------------------------
// normalizeProduct
// ---------------------------------------------------------------------------
describe('normalizeProduct', () => {
  function makeRawProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 1,
      title: 'Bitterballen',
      price: '8.50',
      currency: 'EUR',
      images: [
        { image_url: 'https://img.test/bitterballen.jpg', alt_text: 'Bitterballen', position: 0 },
      ],
      ...overrides,
    };
  }

  it('maps title to name', () => {
    const product = normalizeProduct(makeRawProduct({ title: 'Falafel Wrap' }));
    expect(product.name).toBe('Falafel Wrap');
  });

  it('uses existing name when title is absent', () => {
    const product = normalizeProduct(makeRawProduct({ title: undefined, name: 'Kapsalon' }));
    expect(product.name).toBe('Kapsalon');
  });

  it('falls back to empty string when neither title nor name exists', () => {
    const product = normalizeProduct(makeRawProduct({ title: undefined, name: undefined }));
    expect(product.name).toBe('');
  });

  it('maps images[0].image_url to image', () => {
    const product = normalizeProduct(makeRawProduct());
    expect(product.image).toBe('https://img.test/bitterballen.jpg');
  });

  it('maps images[0].alt_text to image_alt', () => {
    const product = normalizeProduct(makeRawProduct());
    expect(product.image_alt).toBe('Bitterballen');
  });

  it('falls back to empty string image when no images', () => {
    const product = normalizeProduct(makeRawProduct({ images: [] }));
    expect(product.image).toBeNull();
  });

  it('falls back to r.image when images array is missing', () => {
    const product = normalizeProduct(
      makeRawProduct({ images: undefined, image: 'https://img.test/fallback.jpg' }),
    );
    expect(product.image).toBe('https://img.test/fallback.jpg');
  });

  it('returns null image when no images and no fallback', () => {
    const product = normalizeProduct(makeRawProduct({ images: undefined, image: undefined }));
    expect(product.image).toBeNull();
  });

  it('generates slug in {name}--{id} format', () => {
    const product = normalizeProduct(makeRawProduct({ id: 42, title: 'Bitterballen' }));
    expect(product.slug).toBe('bitterballen--42');
  });

  it('preserves existing slug if it already contains --', () => {
    const product = normalizeProduct(
      makeRawProduct({ slug: 'custom-slug--42', id: 42, title: 'Bitterballen' }),
    );
    expect(product.slug).toBe('custom-slug--42');
  });

  it('regenerates slug from existing slug field when it lacks --', () => {
    const product = normalizeProduct(
      makeRawProduct({ slug: 'old-style-slug', id: 7, title: 'Something' }),
    );
    expect(product.slug).toBe('old-style-slug--7');
  });

  it('generates slug from name when slug field is absent', () => {
    const product = normalizeProduct(
      makeRawProduct({ slug: undefined, id: 5, title: 'Kaassoufflé' }),
    );
    expect(product.slug).toBe('kaassouffle--5');
  });

  it('spreads remaining fields through', () => {
    const product = normalizeProduct(makeRawProduct({ custom_field: 'extra-data' }));
    expect(product.custom_field).toBe('extra-data');
  });

  it('defaults price to "0" when absent', () => {
    const product = normalizeProduct(makeRawProduct({ price: undefined }));
    expect(product.price).toBe('0');
  });

  it('defaults currency to EUR when absent', () => {
    const product = normalizeProduct(makeRawProduct({ currency: undefined }));
    expect(product.currency).toBe('EUR');
  });

  it('defaults is_available to true when absent', () => {
    const product = normalizeProduct(makeRawProduct({ is_available: undefined }));
    expect(product.is_available).toBe(true);
  });

  it('defaults sold_out to false when absent', () => {
    const product = normalizeProduct(makeRawProduct({ sold_out: undefined }));
    expect(product.sold_out).toBe(false);
  });

  it('handles products with modifier_groups', () => {
    const modifierGroups = [
      { id: 1, name: 'Sauces', modifiers: [{ id: 10, name: 'Ketchup', price: '0.50' }] },
    ];
    const product = normalizeProduct(makeRawProduct({ modifier_groups: modifierGroups }));
    expect(product.modifier_groups).toEqual(modifierGroups);
  });

  it('defaults modifier_groups to empty array when absent', () => {
    const product = normalizeProduct(makeRawProduct({ modifier_groups: undefined }));
    expect(product.modifier_groups).toEqual([]);
  });

  it('handles products with tags', () => {
    const product = normalizeProduct(makeRawProduct({ tags: ['vegan', 'spicy'] }));
    expect(product.tags).toEqual(['vegan', 'spicy']);
  });

  it('defaults tags to empty array when absent', () => {
    const product = normalizeProduct(makeRawProduct({ tags: undefined }));
    expect(product.tags).toEqual([]);
  });

  it('preserves the full images array', () => {
    const images = [
      { image_url: 'https://img.test/a.jpg', alt_text: 'A', position: 0 },
      { image_url: 'https://img.test/b.jpg', alt_text: 'B', position: 1 },
    ];
    const product = normalizeProduct(makeRawProduct({ images }));
    expect(product.images).toEqual(images);
  });

  it('defaults compare_at_price to null when absent', () => {
    const product = normalizeProduct(makeRawProduct({ compare_at_price: undefined }));
    expect(product.compare_at_price).toBeNull();
  });

  it('preserves compare_at_price when present', () => {
    const product = normalizeProduct(makeRawProduct({ compare_at_price: '12.00' }));
    expect(product.compare_at_price).toBe('12.00');
  });

  it('derives percentage discount from compare_at_price when no explicit discount', () => {
    const product = normalizeProduct(makeRawProduct({ price: '1.07', compare_at_price: '2.13' }));
    expect(product.discount).toEqual({ type: 'percentage', value: 50 });
    // price is set to compare_at_price so pricing functions compute correctly
    expect(product.price).toBe('2.13');
  });

  it('does not derive discount when compare_at_price equals price', () => {
    const product = normalizeProduct(makeRawProduct({ price: '5.00', compare_at_price: '5.00' }));
    expect(product.discount).toBeNull();
    expect(product.price).toBe('5.00');
  });

  it('does not derive discount when compare_at_price is less than price', () => {
    const product = normalizeProduct(makeRawProduct({ price: '5.00', compare_at_price: '3.00' }));
    expect(product.discount).toBeNull();
    expect(product.price).toBe('5.00');
  });

  it('preserves explicit API discount over compare_at_price derivation', () => {
    const product = normalizeProduct(
      makeRawProduct({
        price: '10.00',
        compare_at_price: '12.00',
        discount: { type: 'percentage', value: 20 },
      }),
    );
    expect(product.discount).toEqual({ type: 'percentage', value: 20 });
    // price stays as-is when explicit discount exists
    expect(product.price).toBe('10.00');
  });

  it('defaults discount to null when neither discount nor compare_at_price present', () => {
    const product = normalizeProduct(makeRawProduct({ price: '5.00' }));
    expect(product.discount).toBeNull();
  });

  it('defaults description and intro to null when absent', () => {
    const product = normalizeProduct(makeRawProduct({ description: undefined, intro: undefined }));
    expect(product.description).toBeNull();
    expect(product.intro).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeProduct fulfillment fields
// ---------------------------------------------------------------------------
describe('normalizeProduct fulfillment fields', () => {
  it('extracts available_fulfillment_types and pickup_only', () => {
    const raw = {
      id: 42,
      title: 'Bitterballen',
      price: '8.50',
      available_fulfillment_types: ['local_delivery', 'pickup'],
      pickup_only: false,
    };

    const product = normalizeProduct(raw);
    expect(product.availableFulfillmentTypes).toEqual(['local_delivery', 'pickup']);
    expect(product.pickupOnly).toBe(false);
  });

  it('defaults fulfillment fields when absent', () => {
    const raw = { id: 1, title: 'Falafel' };
    const product = normalizeProduct(raw);
    expect(product.availableFulfillmentTypes).toEqual([]);
    expect(product.pickupOnly).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractIdFromSlug
// ---------------------------------------------------------------------------
describe('extractIdFromSlug', () => {
  it('extracts ID after last -- separator', () => {
    expect(extractIdFromSlug('falafel-wrap--prod-1')).toBe('prod-1');
  });

  it('extracts numeric ID after --', () => {
    expect(extractIdFromSlug('bitterballen--42')).toBe('42');
  });

  it('handles slugs with multiple -- (splits on last)', () => {
    expect(extractIdFromSlug('some--extra--id-99')).toBe('id-99');
  });

  it('legacy fallback: extracts numeric ID from end of slug', () => {
    expect(extractIdFromSlug('falafel-wrap-42')).toBe('42');
  });

  it('returns full slug when no separator and no trailing number', () => {
    expect(extractIdFromSlug('bare-slug')).toBe('bare-slug');
  });

  it('returns full slug for a single word', () => {
    expect(extractIdFromSlug('hello')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(extractIdFromSlug('')).toBe('');
  });

  it('handles slug that is just a number', () => {
    // Legacy match: "-(\d+)$" won't match because there's no leading hyphen
    expect(extractIdFromSlug('42')).toBe('42');
  });

  it('handles -- at the very start', () => {
    expect(extractIdFromSlug('--123')).toBe('123');
  });
});

// ---------------------------------------------------------------------------
// normalizeCollection
// ---------------------------------------------------------------------------
describe('normalizeCollection', () => {
  function makeRawCollection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 10,
      title: 'Appetizers',
      slug: 'appetizers',
      description: 'Tasty starters',
      image_url: 'https://img.test/appetizers.jpg',
      product_count: 5,
      ...overrides,
    };
  }

  it('maps title to name', () => {
    const cat = normalizeCollection(makeRawCollection());
    expect(cat.name).toBe('Appetizers');
  });

  it('uses name when title is absent', () => {
    const cat = normalizeCollection(makeRawCollection({ title: undefined, name: 'Desserts' }));
    expect(cat.name).toBe('Desserts');
  });

  it('defaults name to empty string when neither title nor name', () => {
    const cat = normalizeCollection(makeRawCollection({ title: undefined, name: undefined }));
    expect(cat.name).toBe('');
  });

  it('maps all fields to NormalizedCategory shape', () => {
    const cat = normalizeCollection(makeRawCollection());
    expect(cat).toEqual({
      id: 10,
      name: 'Appetizers',
      slug: 'appetizers',
      description: 'Tasty starters',
      image_url: 'https://img.test/appetizers.jpg',
      product_count: 5,
    });
  });

  it('handles missing fields gracefully', () => {
    const cat = normalizeCollection({ id: 1, slug: 'test' } as Record<string, unknown>);
    expect(cat.name).toBe('');
    expect(cat.description).toBe('');
    expect(cat.image_url).toBe('');
    expect(cat.product_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// flattenCategories
// ---------------------------------------------------------------------------
describe('flattenCategories', () => {
  it('returns leaf nodes from hierarchical input', () => {
    const categories = [
      {
        id: 1,
        name: 'Food',
        slug: 'food',
        children: [
          { id: 2, name: 'Burgers', slug: 'burgers', product_count: 3 },
          { id: 3, name: 'Wraps', slug: 'wraps', product_count: 2 },
        ],
      },
    ];
    const result = flattenCategories(categories as Record<string, unknown>[]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Burgers');
    expect(result[1].name).toBe('Wraps');
  });

  it('handles already-flat input (no children)', () => {
    const categories = [
      { id: 1, name: 'Burgers', slug: 'burgers', product_count: 5 },
      { id: 2, name: 'Drinks', slug: 'drinks', product_count: 8 },
    ];
    const result = flattenCategories(categories as Record<string, unknown>[]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Burgers');
    expect(result[1].name).toBe('Drinks');
  });

  it('handles deeply nested input', () => {
    const categories = [
      {
        id: 1,
        name: 'Menu',
        slug: 'menu',
        children: [
          {
            id: 2,
            name: 'Food',
            slug: 'food',
            children: [
              {
                id: 3,
                name: 'Burgers',
                slug: 'burgers',
                children: [
                  { id: 4, name: 'Classic Burgers', slug: 'classic-burgers', product_count: 3 },
                ],
              },
            ],
          },
        ],
      },
    ];
    const result = flattenCategories(categories as Record<string, unknown>[]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Classic Burgers');
    expect(result[0].id).toBe(4);
  });

  it('returns empty array for empty input', () => {
    expect(flattenCategories([])).toEqual([]);
  });

  it('fills in defaults for missing optional fields', () => {
    const categories = [{ id: 1, name: 'Test', slug: 'test' }];
    const result = flattenCategories(categories as Record<string, unknown>[]);
    expect(result[0].description).toBe('');
    expect(result[0].image_url).toBe('');
    expect(result[0].product_count).toBe(0);
  });

  it('handles mix of leaf and parent categories', () => {
    const categories = [
      { id: 1, name: 'Drinks', slug: 'drinks', product_count: 4 },
      {
        id: 2,
        name: 'Food',
        slug: 'food',
        children: [{ id: 3, name: 'Burgers', slug: 'burgers', product_count: 3 }],
      },
    ];
    const result = flattenCategories(categories as Record<string, unknown>[]);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Drinks');
    expect(result[1].name).toBe('Burgers');
  });

  it('treats empty children array as leaf node', () => {
    const categories = [{ id: 1, name: 'Solo', slug: 'solo', children: [] }];
    const result = flattenCategories(categories as Record<string, unknown>[]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Solo');
  });
});

// ---------------------------------------------------------------------------
// parseMetadataMap
// ---------------------------------------------------------------------------
describe('parseMetadataMap', () => {
  it('converts [{key, value}] array to Map', () => {
    const raw = [
      { key: 'allergens', value: 'gluten, dairy' },
      { key: 'calories', value: '450' },
    ];
    const map = parseMetadataMap(raw);
    expect(map.get('allergens')).toBe('gluten, dairy');
    expect(map.get('calories')).toBe('450');
    expect(map.size).toBe(2);
  });

  it('handles empty array', () => {
    const map = parseMetadataMap([]);
    expect(map.size).toBe(0);
  });

  it('handles undefined input', () => {
    const map = parseMetadataMap(undefined);
    expect(map.size).toBe(0);
  });

  it('handles null input', () => {
    const map = parseMetadataMap(null);
    expect(map.size).toBe(0);
  });

  it('converts numeric values to strings', () => {
    const raw = [{ key: 'weight', value: 250 }];
    const map = parseMetadataMap(raw);
    expect(map.get('weight')).toBe('250');
  });

  it('skips entries with null value', () => {
    const raw = [
      { key: 'valid', value: 'yes' },
      { key: 'empty', value: null },
    ];
    const map = parseMetadataMap(raw);
    expect(map.size).toBe(1);
    expect(map.has('empty')).toBe(false);
  });

  it('skips entries without key or value fields', () => {
    const raw = [
      { notKey: 'a', notValue: 'b' },
      { key: 'valid', value: 'yes' },
    ];
    const map = parseMetadataMap(raw);
    expect(map.size).toBe(1);
    expect(map.get('valid')).toBe('yes');
  });

  it('skips entries with non-string keys', () => {
    const raw = [
      { key: 123, value: 'numeric-key' },
      { key: 'valid', value: 'yes' },
    ];
    const map = parseMetadataMap(raw);
    expect(map.size).toBe(1);
    expect(map.get('valid')).toBe('yes');
  });

  it('handles non-array input (string)', () => {
    const map = parseMetadataMap('not-an-array');
    expect(map.size).toBe(0);
  });

  it('handles non-array input (object)', () => {
    const map = parseMetadataMap({ key: 'a', value: 'b' });
    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeCart shipping_estimate
// ---------------------------------------------------------------------------
describe('normalizeCart shipping_estimate', () => {
  it('extracts shipping_estimate from API response', () => {
    const raw = {
      id: 'cart-1',
      line_items: [],
      cart_total: '13.50',
      item_count: 1,
      shipping_estimate: {
        groups: [
          {
            provider_name: 'Uber Direct',
            fulfillment_type: 'local_delivery',
            status: 'quoted',
            estimated_cost: '3.50',
            items: ['Burger'],
          },
        ],
        total_shipping: '3.50',
        ships_in_parts: false,
      },
    };

    const cart = normalizeCart(raw);
    expect(cart.shipping_estimate).toBeDefined();
    expect(cart.shipping_estimate!.groups).toHaveLength(1);
    expect(cart.shipping_estimate!.total_shipping).toBe('3.50');
  });

  it('derives status from cost_known when no explicit status field', () => {
    const raw = {
      id: 'cart-ck',
      line_items: [],
      cart_total: '20.06',
      item_count: 2,
      shipping_estimate: {
        groups: [
          {
            provider_name: 'Uber Direct',
            fulfillment_type: 'local_delivery',
            cost_known: true,
            estimated_cost: '2.99',
            estimated_minutes: null,
            free_delivery_remaining: '4.94',
            product_ids: [87, 58],
          },
        ],
        total_shipping: '2.99',
        ships_in_parts: false,
      },
    };

    const cart = normalizeCart(raw);
    expect(cart.shipping_estimate).toBeDefined();
    expect(cart.shipping_estimate!.groups[0].status).toBe('quoted');
    expect(cart.shipping_estimate!.groups[0].estimated_cost).toBe('2.99');
    expect(cart.shipping_estimate!.total_shipping).toBe('2.99');
  });

  it('defaults to pending when cost_known is false and no status', () => {
    const raw = {
      id: 'cart-ck2',
      line_items: [],
      cart_total: '10.00',
      item_count: 1,
      shipping_estimate: {
        groups: [
          {
            provider_name: 'PostNL',
            fulfillment_type: 'shipping',
            cost_known: false,
            estimated_cost: null,
          },
        ],
        total_shipping: null,
        ships_in_parts: false,
      },
    };

    const cart = normalizeCart(raw);
    expect(cart.shipping_estimate!.groups[0].status).toBe('pending');
  });

  it('handles missing shipping_estimate gracefully', () => {
    const raw = {
      id: 'cart-2',
      line_items: [],
      cart_total: '10.00',
      item_count: 0,
    };

    const cart = normalizeCart(raw);
    expect(cart.shipping_estimate).toBeUndefined();
  });
});
