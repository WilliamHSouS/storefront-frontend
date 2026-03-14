import type { StorefrontClient } from './sdk-stub';
import type { NormalizedCategory } from './normalize';
import { normalizeCollection, flattenCategories } from './normalize';
import * as log from '@/lib/logger';

export interface SectionsResult {
  sections: NormalizedCategory[];
  source: 'collections' | 'categories';
}

/**
 * Fetch collections from the API, falling back to flattened categories
 * if the collections endpoint returns empty or errors.
 */
export async function fetchCollectionsOrCategories(sdk: StorefrontClient): Promise<SectionsResult> {
  const collectionsResult = await sdk.GET('/api/v1/collections/');

  if (collectionsResult.error) {
    log.error('collections', 'API error, falling back to categories', collectionsResult.error);
  }

  const rawCollections =
    (collectionsResult.data as { results: Array<Record<string, unknown>> } | null)?.results ?? [];

  if (rawCollections.length > 0) {
    return { sections: rawCollections.map(normalizeCollection), source: 'collections' };
  }

  // Fallback: use categories
  const categoriesResult = await sdk.GET('/api/v1/categories/');
  if (categoriesResult.error) {
    log.error('collections', 'Categories fallback also failed', categoriesResult.error);
  }
  const rawCategories =
    (categoriesResult.data as { results: Array<Record<string, unknown>> } | null)?.results ?? [];
  const flatCats = flattenCategories(rawCategories);

  if (flatCats.length > 0) {
    return { sections: flatCats, source: 'categories' };
  }

  // Final fallback: no collections or categories — create a single "Menu" section
  // so products still display. The menu page fetches products per section; with
  // source='categories' and id=0 it will use /api/v1/products/ without a filter.
  return {
    sections: [
      { id: 0, name: 'Menu', slug: 'menu', description: '', image_url: '', product_count: 0 },
    ],
    source: 'categories',
  };
}
