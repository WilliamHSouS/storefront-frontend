/**
 * Normalizes API response shapes to the field names the frontend components expect.
 *
 * The backend API uses `title` and `images[]` while frontend components use `name`
 * and `image`. This adapter keeps the mapping in one place so components don't need
 * to know about the raw API shape.
 */

import type { Cart, CartLineItem } from '@/stores/cart';

/**
 * Extract the product ID from a URL slug.
 * Slugs use a `--` separator: `{name}--{id}` (e.g. "bitterballen--42", "falafel-wrap--prod-1").
 * Supports legacy `{name}-{numericId}` slugs as a fallback.
 */
export function extractIdFromSlug(slug: string): string {
  const sepIndex = slug.lastIndexOf('--');
  if (sepIndex !== -1) return slug.slice(sepIndex + 2);
  const legacyMatch = slug.match(/-(\d+)$/);
  return legacyMatch ? legacyMatch[1] : slug;
}

/** Convert a string to a URL-friendly slug. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The shape frontend components expect for a product. */
export interface NormalizedProduct {
  id: number | string;
  slug: string;
  name: string;
  image: string | null;
  image_alt: string | null;
  price: string;
  compare_at_price: string | null;
  currency: string;
  description: string | null;
  intro: string | null;
  is_available: boolean;
  sold_out: boolean;
  modifier_groups: Array<Record<string, unknown>>;
  tags: string[];
  images: Array<{ image_url: string; alt_text: string; position: number }>;
  /** Pass-through for any fields we don't explicitly map. */
  [key: string]: unknown;
}

/** The shape frontend components expect for a category. */
export interface NormalizedCategory {
  id: number | string;
  name: string;
  slug: string;
  description: string;
  image_url: string;
  product_count: number;
}

/** Raw product shape from the API list endpoint. */
interface RawProduct {
  id: number;
  slug?: string;
  title?: string;
  name?: string;
  images?: Array<{ image_url: string; alt_text: string; position: number }>;
  image?: string;
  price?: string;
  compare_at_price?: string | null;
  currency?: string;
  description?: string | null;
  intro?: string | null;
  is_available?: boolean;
  sold_out?: boolean;
  modifier_groups?: Array<Record<string, unknown>>;
  tags?: string[];
  [key: string]: unknown;
}

/** Raw category shape from the API (hierarchical). */
interface RawCategory {
  id: number;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  is_active?: boolean;
  parent_id?: number | null;
  depth?: number;
  children?: RawCategory[];
  product_count?: number;
}

/**
 * Normalize a raw API product to the shape components expect.
 * Handles both `title` (API) and `name` (if already normalized).
 */
export function normalizeProduct(raw: Record<string, unknown>): NormalizedProduct {
  const r = raw as RawProduct;
  const images = r.images ?? [];
  const primaryImage = images.length > 0 ? images[0] : null;
  const name = r.title ?? r.name ?? '';

  return {
    ...r,
    id: r.id,
    slug: r.slug?.includes('--') ? r.slug : `${slugify(r.slug ?? name)}--${r.id}`,
    name,
    image: primaryImage?.image_url ?? r.image ?? null,
    image_alt: primaryImage?.alt_text ?? null,
    price: r.price ?? '0',
    compare_at_price: r.compare_at_price ?? null,
    currency: r.currency ?? 'EUR',
    description: r.description ?? null,
    intro: r.intro ?? null,
    is_available: r.is_available ?? true,
    sold_out: r.sold_out ?? false,
    modifier_groups: r.modifier_groups ?? [],
    tags: r.tags ?? [],
    images,
  };
}

/** Raw collection shape from the API. */
interface RawCollection {
  id: number;
  title?: string;
  name?: string;
  slug: string;
  description?: string;
  image_url?: string;
  product_count?: number;
}

/**
 * Normalize a raw collection to the same shape as NormalizedCategory.
 * Collections use `title` while categories use `name` — this maps both.
 */
export function normalizeCollection(raw: Record<string, unknown>): NormalizedCategory {
  const r = raw as unknown as RawCollection;
  return {
    id: r.id,
    name: r.title ?? r.name ?? '',
    slug: r.slug ?? '',
    description: r.description ?? '',
    image_url: r.image_url ?? '',
    product_count: r.product_count ?? 0,
  };
}

/** Parse a metadata array of `{ key, value }` pairs into a lookup Map. */
export function parseMetadataMap(rawMetadata: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(rawMetadata)) return map;
  for (const entry of rawMetadata) {
    if (typeof entry === 'object' && entry !== null && 'key' in entry && 'value' in entry) {
      if (typeof entry.key === 'string' && entry.value != null) {
        map.set(entry.key, String(entry.value));
      }
    }
  }
  return map;
}

/**
 * Flatten hierarchical categories to leaf nodes for menu display.
 * Parent categories with children become section headers; only leaf
 * categories (no children or empty children) appear as filterable sections.
 *
 * If all categories are already flat (no children), returns them as-is.
 */
export function flattenCategories(categories: Record<string, unknown>[]): NormalizedCategory[] {
  const result: NormalizedCategory[] = [];

  function collect(cat: RawCategory) {
    const children = cat.children ?? [];
    if (children.length === 0) {
      // Leaf category — use it as a menu section
      result.push({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        description: cat.description ?? '',
        image_url: cat.image_url ?? '',
        product_count: cat.product_count ?? 0,
      });
    } else {
      // Parent category — recurse into children
      for (const child of children) {
        collect(child);
      }
    }
  }

  for (const entry of categories) {
    collect(entry as unknown as RawCategory);
  }

  return result;
}

/**
 * Normalize a raw API cart response to the shape frontend components expect.
 *
 * Maps `options[].option_title` → `selected_options[].name` and
 * `options[].price_modifier` → `selected_options[].price`, consistent
 * with the boundary-normalization pattern used for products and categories.
 */
export function normalizeCart(raw: Record<string, unknown>): Cart {
  const r = raw as Record<string, unknown>;
  const lineItems = (r.line_items ?? []) as Array<Record<string, unknown>>;

  return {
    id: r.id as string,
    line_items: lineItems.map((item): CartLineItem => {
      const rawOptions = (item.options ?? []) as Array<Record<string, unknown>>;
      const fallbackOptions = (item.selected_options ?? []) as Array<{
        id: number | string;
        name: string;
        price: string;
        quantity: number;
      }>;

      const selectedOptions =
        rawOptions.length > 0
          ? rawOptions.map((opt) => ({
              id: (opt.option_id ?? opt.id) as number | string,
              name: (opt.option_title ?? opt.name ?? '') as string,
              price: (opt.price_modifier ?? opt.price ?? '0') as string,
              quantity: (opt.quantity ?? 1) as number,
            }))
          : fallbackOptions;

      return {
        id: item.id as string,
        product_id: item.product_id as number | string,
        product_title: item.product_title as string,
        product_image: item.product_image as string | undefined,
        quantity: item.quantity as number,
        unit_price: item.unit_price as string,
        line_total: item.line_total as string,
        selected_options: selectedOptions,
        discount: item.discount as CartLineItem['discount'],
        notes: item.notes as string | undefined,
      };
    }),
    cart_total: r.cart_total as string,
    cart_savings: r.cart_savings as string | undefined,
    item_count: r.item_count as number,
  };
}
