import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchCollectionsOrCategories } from './collections';
import type { StorefrontClient } from './sdk-stub';

function makeSdk(overrides: Partial<StorefrontClient> = {}): StorefrontClient {
  return {
    GET: vi.fn().mockResolvedValue({ data: null, error: null }),
    POST: vi.fn().mockResolvedValue({ data: null, error: null }),
    PATCH: vi.fn().mockResolvedValue({ data: null, error: null }),
    DELETE: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
}

describe('fetchCollectionsOrCategories', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns collections when the collections endpoint has results', async () => {
    const sdk = makeSdk({
      GET: vi.fn().mockResolvedValue({
        data: {
          results: [
            {
              id: 1,
              title: 'Starters',
              slug: 'starters',
              description: 'Appetizers',
              product_count: 3,
            },
            { id: 2, title: 'Mains', slug: 'mains', description: 'Main courses', product_count: 5 },
          ],
        },
        error: null,
      }),
    });

    const result = await fetchCollectionsOrCategories(sdk);

    expect(result.source).toBe('collections');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].name).toBe('Starters');
    expect(result.sections[1].name).toBe('Mains');
  });

  it('returns normalized NormalizedCategory shape from collections', async () => {
    const sdk = makeSdk({
      GET: vi.fn().mockResolvedValue({
        data: {
          results: [
            {
              id: 10,
              title: 'Drinks',
              slug: 'drinks',
              description: 'Beverages',
              image_url: '/img.jpg',
              product_count: 7,
            },
          ],
        },
        error: null,
      }),
    });

    const result = await fetchCollectionsOrCategories(sdk);

    expect(result.source).toBe('collections');
    expect(result.sections[0]).toEqual({
      id: 10,
      name: 'Drinks',
      slug: 'drinks',
      description: 'Beverages',
      image_url: '/img.jpg',
      product_count: 7,
    });
  });

  it('falls back to categories when collections returns empty results', async () => {
    const sdk = makeSdk({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: { results: [] }, error: null }) // collections: empty
        .mockResolvedValueOnce({
          data: {
            results: [
              {
                id: 1,
                name: 'Appetizers',
                slug: 'appetizers',
                description: 'Starters',
                product_count: 4,
              },
            ],
          },
          error: null,
        }), // categories
    });

    const result = await fetchCollectionsOrCategories(sdk);

    expect(result.source).toBe('categories');
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].name).toBe('Appetizers');
    expect(sdk.GET).toHaveBeenCalledTimes(2);
  });

  it('falls back to categories when collections endpoint errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const sdk = makeSdk({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: { status: 500, statusText: 'Server Error' } }) // collections: error
        .mockResolvedValueOnce({
          data: {
            results: [{ id: 5, name: 'Salads', slug: 'salads', description: '', product_count: 2 }],
          },
          error: null,
        }), // categories
    });

    const result = await fetchCollectionsOrCategories(sdk);

    expect(result.source).toBe('categories');
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].name).toBe('Salads');
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('returns fallback "Menu" section when both collections and categories fail', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const sdk = makeSdk({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: { status: 500, statusText: 'Server Error' } }) // collections
        .mockResolvedValueOnce({ data: null, error: { status: 500, statusText: 'Server Error' } }), // categories
    });

    const result = await fetchCollectionsOrCategories(sdk);

    expect(result.source).toBe('categories');
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].name).toBe('Menu');
    expect(result.sections[0].id).toBe(0);
    expect(consoleSpy).toHaveBeenCalledTimes(2);

    consoleSpy.mockRestore();
  });

  it('flattens hierarchical categories in the fallback path', async () => {
    const sdk = makeSdk({
      GET: vi
        .fn()
        .mockResolvedValueOnce({ data: { results: [] }, error: null }) // collections: empty
        .mockResolvedValueOnce({
          data: {
            results: [
              {
                id: 1,
                name: 'Food',
                slug: 'food',
                children: [
                  { id: 2, name: 'Hot', slug: 'hot', product_count: 3 },
                  { id: 3, name: 'Cold', slug: 'cold', product_count: 1 },
                ],
              },
            ],
          },
          error: null,
        }), // categories with hierarchy
    });

    const result = await fetchCollectionsOrCategories(sdk);

    expect(result.source).toBe('categories');
    // Parent "Food" should be flattened away, only leaf nodes remain
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].name).toBe('Hot');
    expect(result.sections[1].name).toBe('Cold');
  });
});
