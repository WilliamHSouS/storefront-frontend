/**
 * Normalizes API response shapes to the field names the frontend components expect.
 *
 * The backend API uses `title` and `images[]` while frontend components use `name`
 * and `image`. This adapter keeps the mapping in one place so components don't need
 * to know about the raw API shape.
 */

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

/** A single option within a modifier group (e.g. "Extra cheese", "Large"). */
export interface ModifierOption {
  id: string | number;
  title?: string;
  name?: string;
  price_modifier?: string;
  price?: string;
  is_available?: boolean;
  [key: string]: unknown;
}

/** A group of modifiers for a product (e.g. "Size", "Toppings"). */
export interface ModifierGroup {
  id: string | number;
  title?: string;
  name?: string;
  selection_type?: string;
  required?: boolean;
  min_selections?: number;
  max_selections?: number;
  modifiers?: ModifierOption[];
  options?: ModifierOption[];
  [key: string]: unknown;
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
  modifier_groups: ModifierGroup[];
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
  modifier_groups?: ModifierGroup[];
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
