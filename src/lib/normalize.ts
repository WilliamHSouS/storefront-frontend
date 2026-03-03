/**
 * Normalizes API response shapes to the field names the frontend components expect.
 *
 * The backend API uses `title` and `images[]` while frontend components use `name`
 * and `image`. This adapter keeps the mapping in one place so components don't need
 * to know about the raw API shape.
 */

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
    slug: (r.slug as string) ?? slugify(name),
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
