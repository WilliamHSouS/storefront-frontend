# Structured Data Enrichment — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add comprehensive Schema.org structured data across all page types to maximize rich result eligibility in Google Search.

**Architecture:** Extend existing `structured-data.ts` generators with new schemas. Simplify `StructuredData.astro` to a dumb JSON-LD renderer — pages pass pre-built objects. All data comes from existing merchant config and product/collection types — no new API calls needed.

**Tech Stack:** Schema.org JSON-LD, Astro SSR components, Vitest

**Post-debate changes:**
- Dual-type products as `["Product", "MenuItem"]` for Google rich result eligibility
- Hardened `expandDayRange()` with comma-separated day support + graceful fallback
- Added `servesCuisine` and `priceRange` to Restaurant schema
- Dropped Task 4 (WebSite schema) — no value for subdomain storefronts
- Capped homepage ItemList to 20 products max
- Simplified StructuredData.astro to a pass-through renderer

---

### Task 1: Simplify StructuredData.astro to a pass-through renderer

**Files:**
- Modify: `src/components/astro/StructuredData.astro`

**Step 1: Rewrite component to accept pre-built JSON-LD**

Replace the switch-based component with a simple pass-through:

```astro
---
interface Props {
  data: Record<string, unknown>;
}
const { data } = Astro.props;
---
{data && <script type="application/ld+json" set:html={JSON.stringify(data)} />}
```

**Step 2: Update all existing page usages to call generators directly**

In `src/pages/[lang]/index.astro`:
```astro
import { generateRestaurantLD } from '@/lib/structured-data';
// ...
<StructuredData slot="head" data={generateRestaurantLD(merchant, Astro.url.origin, lang)} />
```

In `src/pages/[lang]/product/[slug].astro`:
```astro
import { generateMenuItemLD, generateBreadcrumbLD } from '@/lib/structured-data';
// ...
<StructuredData slot="head" data={generateMenuItemLD(product, merchant.currency, productUrl)} />
<StructuredData slot="head" data={generateBreadcrumbLD(breadcrumbs)} />
```

In `src/pages/[lang]/collection/[slug].astro`:
```astro
import { generateBreadcrumbLD } from '@/lib/structured-data';
// ...
<StructuredData slot="head" data={generateBreadcrumbLD(breadcrumbs)} />
```

**Step 3: Verify build passes**

Run: `pnpm build`
Expected: PASS — existing structured data output is identical.

**Step 4: Commit**

```bash
git add src/components/astro/StructuredData.astro \
  src/pages/[lang]/index.astro \
  src/pages/[lang]/product/[slug].astro \
  src/pages/[lang]/collection/[slug].astro
git commit -m "refactor(seo): simplify StructuredData.astro to pass-through JSON-LD renderer"
```

---

### Task 2: Enrich Restaurant schema with opening hours, cuisine, social profiles

**Files:**
- Modify: `src/lib/structured-data.ts` — `generateRestaurantLD()` + add `expandDayRange()`
- Modify: `src/lib/structured-data.test.ts` — add tests

**Step 1: Write failing tests**

```typescript
// In existing describe('generateRestaurantLD')
it('includes openingHoursSpecification from merchant hours', () => {
  const ld = generateRestaurantLD(merchant, 'https://bar-sumac.poweredbysous.com', 'nl');
  const specs = ld.openingHoursSpecification as Array<Record<string, unknown>>;
  expect(specs).toHaveLength(1);
  expect(specs[0]['@type']).toBe('OpeningHoursSpecification');
  expect(specs[0].dayOfWeek).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  expect(specs[0].opens).toBe('11:00');
  expect(specs[0].closes).toBe('22:00');
});

it('includes menu link and sameAs social profiles', () => {
  const ld = generateRestaurantLD(merchant, 'https://bar-sumac.poweredbysous.com', 'nl');
  expect(ld.menu).toBe('https://bar-sumac.poweredbysous.com');
  expect(ld.sameAs).toEqual(['https://instagram.com/barsumac']);
});

it('omits sameAs when social is empty', () => {
  const m = { ...merchant, social: {} };
  const ld = generateRestaurantLD(m, 'https://example.com', 'nl');
  expect(ld.sameAs).toBeUndefined();
});

it('omits openingHoursSpecification when hours is empty', () => {
  const m = { ...merchant, hours: [] };
  const ld = generateRestaurantLD(m, 'https://example.com', 'nl');
  expect(ld.openingHoursSpecification).toBeUndefined();
});

it('handles comma-separated days in hours', () => {
  const m = { ...merchant, hours: [{ days: 'Mon, Wed, Fri', open: '10:00', close: '18:00' }] };
  const ld = generateRestaurantLD(m, 'https://example.com', 'nl');
  const specs = ld.openingHoursSpecification as Array<Record<string, unknown>>;
  expect(specs[0].dayOfWeek).toEqual(['Monday', 'Wednesday', 'Friday']);
});

it('skips hours entries with unrecognized day format', () => {
  const m = { ...merchant, hours: [{ days: 'Gibberish', open: '10:00', close: '18:00' }] };
  const ld = generateRestaurantLD(m, 'https://example.com', 'nl');
  expect(ld.openingHoursSpecification).toBeUndefined();
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/lib/structured-data.test.ts`
Expected: FAIL

**Step 3: Implement expandDayRange and enrich generateRestaurantLD**

Add to `structured-data.ts`:

```typescript
const DAY_MAP: Record<string, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Expand "Mon-Fri" or "Mon, Wed, Fri" into Schema.org day names. Returns [] on bad input. */
export function expandDayRange(days: string): string[] {
  const trimmed = days.trim().toLowerCase();

  // Comma-separated: "Mon, Wed, Fri"
  if (trimmed.includes(',')) {
    return trimmed.split(',')
      .map((s) => s.trim().slice(0, 3))
      .filter((d) => DAY_MAP[d])
      .map((d) => DAY_MAP[d]);
  }

  // Range: "Mon-Fri"
  if (trimmed.includes('-')) {
    const parts = trimmed.split('-').map((s) => s.trim().slice(0, 3));
    if (parts.length === 2) {
      const start = DAY_ORDER.indexOf(parts[0]);
      const end = DAY_ORDER.indexOf(parts[1]);
      if (start >= 0 && end >= 0 && start <= end) {
        return DAY_ORDER.slice(start, end + 1).map((d) => DAY_MAP[d]);
      }
    }
  }

  // Single day: "Mon"
  const key = trimmed.slice(0, 3);
  if (DAY_MAP[key]) return [DAY_MAP[key]];

  return [];
}
```

Then enrich `generateRestaurantLD`:
- `openingHoursSpecification` from `merchant.hours` — skip entries where `expandDayRange` returns `[]`, omit field entirely if no valid entries
- `menu: siteUrl`
- `sameAs: Object.values(merchant.social)` — omit if empty
- `servesCuisine` — from `merchant.cuisine` if present (optional field on MerchantConfig)
- `priceRange` — from `merchant.priceRange` if present (optional field on MerchantConfig)

**Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run src/lib/structured-data.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/structured-data.ts src/lib/structured-data.test.ts
git commit -m "feat(seo): enrich Restaurant schema with opening hours, cuisine, social profiles"
```

---

### Task 3: Dual-type products as Product+MenuItem with availability and images

**Files:**
- Modify: `src/lib/structured-data.ts` — rename + update `generateMenuItemLD()`
- Modify: `src/lib/structured-data.test.ts` — update tests
- Modify: `src/pages/[lang]/product/[slug].astro` — pass extra product fields

**Step 1: Write failing tests**

```typescript
describe('generateProductLD', () => {
  it('uses dual Product+MenuItem type', () => {
    const product = { name: 'Falafel Wrap', price: '8.50' };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel');
    expect(ld['@type']).toEqual(['Product', 'MenuItem']);
  });

  it('includes availability when provided', () => {
    const product = { name: 'Falafel Wrap', price: '8.50', is_available: true, sold_out: false };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel') as JsonLd;
    expect(ld.offers.availability).toBe('https://schema.org/InStock');
  });

  it('marks as SoldOut when sold_out is true', () => {
    const product = { name: 'Falafel Wrap', price: '8.50', is_available: true, sold_out: true };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel') as JsonLd;
    expect(ld.offers.availability).toBe('https://schema.org/SoldOut');
  });

  it('marks as Discontinued when not available', () => {
    const product = { name: 'Falafel Wrap', price: '8.50', is_available: false };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel') as JsonLd;
    expect(ld.offers.availability).toBe('https://schema.org/Discontinued');
  });

  it('uses images array when provided', () => {
    const product = {
      name: 'Falafel Wrap', price: '8.50',
      image: 'https://example.com/img1.jpg',
      images: [
        { image_url: 'https://example.com/img1.jpg', alt_text: 'front' },
        { image_url: 'https://example.com/img2.jpg', alt_text: 'side' },
      ],
    };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel');
    expect(ld.image).toEqual([
      'https://example.com/img1.jpg',
      'https://example.com/img2.jpg',
    ]);
  });

  it('falls back to single image string', () => {
    const product = { name: 'Falafel Wrap', price: '8.50', image: 'https://example.com/img1.jpg' };
    const ld = generateProductLD(product, 'EUR', 'https://example.com/product/falafel');
    expect(ld.image).toBe('https://example.com/img1.jpg');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/lib/structured-data.test.ts`

**Step 3: Implement generateProductLD**

Rename `generateMenuItemLD` → `generateProductLD`. Keep the old name as a re-export for backwards compat (or update all call sites).

```typescript
export function generateProductLD(
  product: {
    name: string;
    price: string;
    description?: string;
    image?: string | null;
    images?: Array<{ image_url: string; alt_text: string }>;
    is_available?: boolean;
    sold_out?: boolean;
  },
  currency: string,
  productUrl: string,
): Record<string, unknown> {
  const imageList = product.images?.length
    ? product.images.map((img) => img.image_url)
    : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': ['Product', 'MenuItem'],
    name: product.name,
    ...(product.description ? { description: product.description } : {}),
    ...(imageList ? { image: imageList } : product.image ? { image: product.image } : {}),
    url: productUrl,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: currency,
      ...(product.is_available != null
        ? {
            availability: product.sold_out
              ? 'https://schema.org/SoldOut'
              : product.is_available
                ? 'https://schema.org/InStock'
                : 'https://schema.org/Discontinued',
          }
        : {}),
    },
  };
}

/** @deprecated Use generateProductLD */
export const generateMenuItemLD = generateProductLD;
```

**Step 4: Update product page to pass extra fields**

In `src/pages/[lang]/product/[slug].astro`, update the StructuredData call:
```typescript
const productUrl = `${Astro.url.origin}/${lang}/product/${product.slug}`;
// ...
<StructuredData slot="head" data={generateProductLD(
  {
    name: product.name,
    price: product.price,
    description: product.description ?? undefined,
    image: product.image,
    images: product.images,
    is_available: product.is_available,
    sold_out: product.sold_out,
  },
  merchant.currency,
  productUrl,
)} />
```

**Step 5: Update existing test for old MenuItem behavior**

The existing `generateMenuItemLD` test should still pass via the re-export.

**Step 6: Run tests to verify they pass**

Run: `pnpm test -- --run src/lib/structured-data.test.ts`

**Step 7: Commit**

```bash
git add src/lib/structured-data.ts src/lib/structured-data.test.ts \
  src/pages/[lang]/product/[slug].astro
git commit -m "feat(seo): dual-type Product+MenuItem with availability and images array"
```

---

### Task 4: Add ItemList schema to collection pages

**Files:**
- Modify: `src/lib/structured-data.ts` — add `generateItemListLD()`
- Modify: `src/lib/structured-data.test.ts` — add tests
- Modify: `src/pages/[lang]/collection/[slug].astro` — add StructuredData

**Step 1: Write failing test**

```typescript
describe('generateItemListLD', () => {
  it('returns an ItemList with ListItems for each product', () => {
    const products = [
      { name: 'Falafel Wrap', url: 'https://example.com/nl/product/falafel-wrap--1' },
      { name: 'Hummus', url: 'https://example.com/nl/product/hummus--2' },
    ];
    const ld = generateItemListLD('Mezze', products);
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('ItemList');
    expect(ld.name).toBe('Mezze');
    expect(ld.numberOfItems).toBe(2);
    const items = ld.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      url: 'https://example.com/nl/product/falafel-wrap--1',
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run src/lib/structured-data.test.ts`

**Step 3: Implement generateItemListLD**

```typescript
export function generateItemListLD(
  name: string,
  products: Array<{ name: string; url: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    numberOfItems: products.length,
    itemListElement: products.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: p.url,
    })),
  };
}
```

**Step 4: Use in collection page**

In `src/pages/[lang]/collection/[slug].astro`:
```astro
import { generateBreadcrumbLD, generateItemListLD } from '@/lib/structured-data';
// ... after products are fetched:
const productUrls = products.map((p) => ({
  name: p.name,
  url: `${Astro.url.origin}/${lang}/product/${p.slug}`,
}));
// ...
<StructuredData slot="head" data={generateItemListLD(category.name, productUrls)} />
```

**Step 5: Run tests and verify**

Run: `pnpm test -- --run src/lib/structured-data.test.ts`

**Step 6: Commit**

```bash
git add src/lib/structured-data.ts src/lib/structured-data.test.ts \
  src/pages/[lang]/collection/[slug].astro
git commit -m "feat(seo): add ItemList schema to collection pages"
```

---

### Task 5: Add capped ItemList for homepage menu products

**Files:**
- Modify: `src/pages/[lang]/index.astro` — add ItemList StructuredData

**Step 1: Add StructuredData with capped product list**

In `src/pages/[lang]/index.astro`, import `generateItemListLD` and add:

```astro
import { generateRestaurantLD, generateItemListLD } from '@/lib/structured-data';
// ...
const MAX_HOMEPAGE_ITEMS = 20;
const homepageProductUrls = allProducts.slice(0, MAX_HOMEPAGE_ITEMS).map((p) => ({
  name: p.name,
  url: `${Astro.url.origin}/${lang}/product/${p.slug}`,
}));
// ...
<StructuredData slot="head" data={generateItemListLD(merchant.name, homepageProductUrls)} />
```

**Step 2: Verify build passes**

Run: `pnpm build`

**Step 3: Commit**

```bash
git add src/pages/[lang]/index.astro
git commit -m "feat(seo): add capped ItemList schema for homepage menu products"
```
