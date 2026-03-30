# Shopping UX Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 3 high-impact changes to the pre-checkout shopping experience to boost add-to-cart rate and AOV: popular badges on product cards, cart suggestions repositioning, and search bar zero-state with keyboard navigation.

**Architecture:** All three changes are frontend-only. Popular badges use a tag-based approach — if a product's `tags[]` array contains `"popular"`, we render a badge. This is future-compatible: when the backend later adds `is_popular` to the product serializer, we update the check. Cart suggestions reorder is a one-line swap in `CartFooter`. Search zero-state fetches the default product list (limited to 6) on open and adds arrow-key navigation.

**Tech Stack:** Astro 5, Preact islands, Nanostores, Tailwind CSS, Vitest, Playwright

**Backend dependency status:** Backend team confirmed feasibility (bus discussion #18). They will add:

- `is_popular: boolean | null` and `popularity_rank: int | null` on product list/detail serializer
- `?ordering=-popularity` query param on `ProductViewSet`
- Both merchant-scoped via a new `ProductPopularityStats` read model

**Phased approach:**

- **Phase 1 (Tasks 1–8 below):** Ships now with zero backend dependency. Tag-based popular badges, search zero-state using default product list.
- **Phase 2 (Task 9 below):** When backend ships the read model + serializer changes and bumps the SDK, upgrade to data-driven popularity.

---

## File Structure

### New files

- `src/components/astro/PopularBadge.astro` — "Popular" badge component (mirrors PromoBadge pattern)
- `src/components/astro/PopularBadge.test.ts` — Unit tests for badge rendering logic

### Modified files

- `src/components/astro/ProductCard.astro` — Add PopularBadge overlay
- `src/components/interactive/CartDrawer.tsx:109-167` — Reorder CartFooter children
- `src/components/interactive/SearchBar.tsx` — Add zero-state, arrow-key nav, recent searches
- `src/i18n/messages/en.json` — New translation keys
- `src/i18n/messages/nl.json` — New translation keys
- `src/i18n/messages/de.json` — New translation keys
- `e2e/fixtures/products.ts` — Add `tags: ['popular']` to fixture products
- `e2e/helpers/mock-api.ts` — Ensure tags are included in product responses

---

## Task 1: Popular Badge Component

**Files:**

- Create: `src/components/astro/PopularBadge.astro`
- Test: `src/components/astro/PopularBadge.test.ts`
- Modify: `src/i18n/messages/en.json`, `src/i18n/messages/nl.json`, `src/i18n/messages/de.json`

- [ ] **Step 1: Add translation keys for "Popular" in all 3 languages**

In `src/i18n/messages/en.json`, add:

```json
"popular": "Popular"
```

In `src/i18n/messages/nl.json`, add:

```json
"popular": "Populair"
```

In `src/i18n/messages/de.json`, add:

```json
"popular": "Beliebt"
```

Add each key near the existing `"soldOut"` key for logical grouping.

- [ ] **Step 2: Create PopularBadge.astro**

```astro
---
import { t } from '@/i18n';

interface Props {
  tags: string[];
  lang: string;
  overlay?: boolean;
}

const { tags, lang, overlay = false } = Astro.props;
const isPopular = tags.some((tag) => tag.toLowerCase() === 'popular');
---

{
  isPopular && (
    <span
      class:list={[
        'inline-flex items-center justify-center font-semibold leading-none whitespace-nowrap',
        overlay
          ? 'absolute top-1.5 right-1.5 z-10 rounded-full bg-amber-500 px-2.5 py-1 text-[12px] text-white sm:top-2 sm:right-2'
          : 'rounded-sm bg-amber-500 px-1.5 py-0.5 text-xs font-medium text-white',
      ]}
    >
      {t('popular', lang)}
    </span>
  )
}
```

Key decisions:

- Uses `right-1.5` (not `left-1.5`) to avoid overlapping with `PromoBadge` which uses `left-1.5`
- Uses `bg-amber-500` to differentiate from the red `bg-destructive` used by `PromoBadge`
- Case-insensitive tag match for resilience against backend tag casing

- [ ] **Step 3: Run Astro type check**

Run: `pnpm check`
Expected: PASS — no type errors

- [ ] **Step 4: Commit**

```bash
git add src/components/astro/PopularBadge.astro src/i18n/messages/en.json src/i18n/messages/nl.json src/i18n/messages/de.json
git commit -m "feat: add PopularBadge component and translation keys"
```

---

## Task 2: Add Popular Badge to Product Cards

**Files:**

- Modify: `src/components/astro/ProductCard.astro`
- Modify: `e2e/fixtures/products.ts`

- [ ] **Step 1: Import and render PopularBadge in ProductCard**

In `src/components/astro/ProductCard.astro`, add the import after the existing `PromoBadge` import (line 10):

```astro
import PopularBadge from './PopularBadge.astro';
```

Update the Props interface to include `tags`:

```typescript
interface Props {
  product: {
    id: number | string;
    slug: string;
    name: string;
    description?: string | null;
    intro?: string | null;
    price: string;
    compare_at_price?: string | null;
    image?: string | null;
    sold_out?: boolean;
    discount?: PricedItem['discount'];
    modifier_groups?: unknown[];
    tags?: string[];
  };
  lang: string;
  currency: string;
  variant?: 'grid' | 'list';
}
```

After the `PromoBadge` render (line 103), add `PopularBadge`:

```astro
{
  product.discount && (
    <PromoBadge item={pricedItem} currency={currency} locale={locale} lang={lang} overlay />
  )
}
<PopularBadge tags={product.tags ?? []} lang={lang} overlay />
```

- [ ] **Step 2: Add `tags: ['popular']` to a fixture product for testing**

In `e2e/fixtures/products.ts`, add `tags: ['popular']` to the first product (Falafel Wrap, `prod-1`). The `productDefaults()` function already provides `tags: []`, so override it:

```typescript
// In the products array, prod-1:
{
  ...productDefaults(),
  id: 'prod-1',
  title: 'Falafel Wrap',
  // ... existing fields ...
  tags: [{ label: 'popular' }], // or just ['popular'] depending on API shape
},
```

Check the actual tag shape in the API response — `NormalizedProduct.tags` is `string[]`, but the raw API may send `[{label: 'popular'}]`. Check `normalizeProduct()` to see how tags are mapped. At line 132+ of `src/lib/normalize.ts`, look for how `tags` is processed. If it's passed through as-is, the fixture should match the raw API shape.

- [ ] **Step 3: Verify locally in browser**

Run: `pnpm dev`
Navigate to the menu page. The product with the "popular" tag should show an amber badge in the top-right corner of its image. Products with both a discount and the popular tag should show both badges (PromoBadge top-left, PopularBadge top-right).

- [ ] **Step 4: Run type check and existing tests**

Run: `pnpm check && pnpm test`
Expected: All pass — no regressions

- [ ] **Step 5: Commit**

```bash
git add src/components/astro/ProductCard.astro e2e/fixtures/products.ts
git commit -m "feat: render popular badge on product cards with popular tag"
```

---

## Task 3: Reorder Cart Suggestions Above Pricing Breakdown

**Files:**

- Modify: `src/components/interactive/CartDrawer.tsx:127-166`

- [ ] **Step 1: Move CartSuggestions above PricingBreakdown in CartFooter**

In `src/components/interactive/CartDrawer.tsx`, the `CartFooter` function (line 109) currently renders children in this order:

```
DiscountCodeInput → PricingBreakdown → CartSuggestions → checkout link
```

Change to:

```
DiscountCodeInput → CartSuggestions → PricingBreakdown → checkout link
```

Edit the return JSX of `CartFooter` (lines 127-166). Move the `<CartSuggestions lang={lang} />` line (currently at line 157) to immediately after `<DiscountCodeInput cart={cart} lang={lang} />` (line 132):

```tsx
return (
  <div class="max-h-[50vh] shrink-0 overflow-y-auto border-t border-border px-4 py-3" style={style}>
    <DiscountCodeInput cart={cart} lang={lang} />
    <CartSuggestions lang={lang} />

    <PricingBreakdown
      lang={lang as 'nl' | 'en' | 'de'}
      currency={currency}
      locale={locale}
      subtotal={cart.subtotal ?? '0.00'}
      shipping={legacyShipping}
      tax={cart.tax_total ?? '0.00'}
      discount={discountNum > 0 ? cart.discount_amount! : null}
      total={cartTotal}
      surchargeTotal={cart.surcharge_total}
      promotionDiscount={cart.promotion_discount_amount}
      productSavings={savings ?? undefined}
      taxIncluded={taxIncluded}
      showShippingFree={hasAddress}
      shippingSlot={
        <ShippingEstimate
          lang={lang}
          currency={currency}
          shippingEstimate={cart.shipping_estimate}
        />
      }
    />

    <a
      href={`/${lang}/checkout`}
      class={`flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 ${loading ? 'pointer-events-none opacity-50' : ''}`}
      aria-disabled={loading}
    >
      {t('nextCheckout', lang)}
    </a>
  </div>
);
```

- [ ] **Step 2: Run existing cart e2e tests to verify no regression**

Run: `pnpm test:e2e -- --grep "cart"`
Expected: All cart-related e2e tests still pass. The suggestions should now appear above the pricing breakdown when the cart drawer opens.

- [ ] **Step 3: Commit**

```bash
git add src/components/interactive/CartDrawer.tsx
git commit -m "feat: move cart suggestions above pricing for better visibility"
```

---

## Task 4: Search Bar Zero-State Content

**Files:**

- Modify: `src/components/interactive/SearchBar.tsx`
- Modify: `src/i18n/messages/en.json`, `src/i18n/messages/nl.json`, `src/i18n/messages/de.json`

- [ ] **Step 1: Add translation keys for search zero-state**

In `src/i18n/messages/en.json`:

```json
"popularItems": "Popular items",
"recentSearches": "Recent searches"
```

In `src/i18n/messages/nl.json`:

```json
"popularItems": "Populaire items",
"recentSearches": "Recente zoekopdrachten"
```

In `src/i18n/messages/de.json`:

```json
"popularItems": "Beliebte Artikel",
"recentSearches": "Letzte Suchanfragen"
```

- [ ] **Step 2: Add zero-state product fetching**

In `src/components/interactive/SearchBar.tsx`, add state for featured products and recent searches. After the existing state declarations (line 23):

```tsx
const [featured, setFeatured] = useState<NormalizedProduct[]>([]);
const [recentSearches, setRecentSearches] = useState<string[]>([]);
```

Add a `useEffect` to fetch featured products when the overlay opens. Place it after the existing `useEffect` blocks (after line 128):

```tsx
// Fetch featured products for zero-state (once when first opened)
useEffect(() => {
  if (!isOpen || featured.length > 0) return;

  const controller = new AbortController();
  const fetchFeatured = async () => {
    try {
      const client = getClient();
      const { data } = await client.GET('/api/v1/products/', {
        params: { query: { page_size: '6' } },
        signal: controller.signal,
      });
      if (data) {
        const page = data as { results: Array<Record<string, unknown>> };
        setFeatured((page.results ?? []).map(normalizeProduct));
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      log.error('search', 'Failed to fetch featured products:', err);
    }
  };
  fetchFeatured();
  return () => controller.abort();
}, [isOpen]);

// Load recent searches from localStorage
useEffect(() => {
  if (!isOpen) return;
  try {
    const stored = localStorage.getItem('recentSearches');
    if (stored) setRecentSearches(JSON.parse(stored));
  } catch {
    // Ignore — localStorage may be unavailable
  }
}, [isOpen]);
```

- [ ] **Step 3: Save searches to localStorage on select**

Update the `handleSelect` function (line 99) to save the current query:

```tsx
const handleSelect = (result: NormalizedProduct) => {
  if (query.length >= 2) {
    try {
      const stored = localStorage.getItem('recentSearches');
      const existing: string[] = stored ? JSON.parse(stored) : [];
      const updated = [query, ...existing.filter((s) => s !== query)].slice(0, 5);
      localStorage.setItem('recentSearches', JSON.stringify(updated));
    } catch {
      // Ignore
    }
  }
  closeSearch();
  $selectedProduct.set({ id: String(result.id), name: result.name, slug: result.slug });
};
```

- [ ] **Step 4: Render zero-state UI**

Replace the empty state area. Currently, when `query.length < 2` and `results.length === 0`, nothing is shown below the search input. After the results `</div>` closing tag (line 211) and before the no-results message (line 214), add the zero-state block:

```tsx
{
  query.length < 2 && results.length === 0 && (
    <div class="max-h-64 overflow-y-auto">
      {/* Recent searches */}
      {recentSearches.length > 0 && (
        <div class="border-b border-border px-3 py-2">
          <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('recentSearches', lang)}
          </h3>
          <ul>
            {recentSearches.map((term) => (
              <li key={term}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(term);
                    search(term);
                  }}
                  class="flex w-full items-center gap-2 rounded px-1 py-1.5 text-sm text-card-foreground hover:bg-accent"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="text-muted-foreground"
                  >
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  {term}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Featured products */}
      {featured.length > 0 && (
        <div class="px-3 py-2">
          <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('popularItems', lang)}
          </h3>
          <ul role="listbox" aria-label={t('popularItems', lang)}>
            {featured.map((product) => (
              <li key={product.id} role="option" aria-selected="false">
                <button
                  type="button"
                  onClick={() => handleSelect(product)}
                  class="flex w-full items-center gap-3 rounded px-1 py-2 text-left hover:bg-accent"
                >
                  {product.image && (
                    <div class="h-10 w-10 shrink-0 overflow-hidden rounded bg-card-image">
                      <img
                        src={optimizedImageUrl(product.image, { width: 80 })}
                        alt=""
                        class="h-full w-full object-cover"
                        width="40"
                        height="40"
                        loading="lazy"
                      />
                    </div>
                  )}
                  <div class="flex-1">
                    <span class="text-sm font-medium text-card-foreground">{product.name}</span>
                  </div>
                  <span class="text-sm text-muted-foreground">
                    {formatPrice(product.price, currency, locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run type check**

Run: `pnpm check`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/interactive/SearchBar.tsx src/i18n/messages/en.json src/i18n/messages/nl.json src/i18n/messages/de.json
git commit -m "feat: add zero-state content to search bar with popular items and recent searches"
```

---

## Task 5: Search Bar Keyboard Navigation

**Files:**

- Modify: `src/components/interactive/SearchBar.tsx`

- [ ] **Step 1: Add activeIndex state**

In `src/components/interactive/SearchBar.tsx`, after the existing state declarations, add:

```tsx
const [activeIndex, setActiveIndex] = useState(-1);
const listRef = useRef<HTMLUListElement>(null);
```

Reset `activeIndex` when results change. Add to the end of the `search` function (inside the `finally` block or after `setResults`):

```tsx
setActiveIndex(-1);
```

- [ ] **Step 2: Add keyboard handler for ArrowDown, ArrowUp, Enter**

Replace the existing `Escape` keydown handler (lines 105-112) with a combined handler:

```tsx
useEffect(() => {
  if (!isOpen) return;
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeSearch();
      return;
    }

    // Determine the active list: search results when query >= 2, else featured products
    const activeList = query.length >= 2 ? results : featured;
    if (activeList.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => {
        const next = prev < activeList.length - 1 ? prev + 1 : 0;
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => {
        const next = prev > 0 ? prev - 1 : activeList.length - 1;
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
        return next;
      });
    } else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < activeList.length) {
      e.preventDefault();
      handleSelect(activeList[activeIndex]);
    }
  };

  document.addEventListener('keydown', handleKeyDown);
  return () => document.removeEventListener('keydown', handleKeyDown);
}, [isOpen, results, featured, activeIndex, query]);
```

- [ ] **Step 3: Add visual highlight to active item**

For both the search results `<ul>` and the featured products `<ul>`, add `ref={listRef}` to whichever list is currently active. Since both lists use the same item shape, update the button class in both result lists to include an active highlight:

In the search results list (`results.map`), update the `<button>` class:

```tsx
class={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent ${
  query.length >= 2 && idx === activeIndex ? 'bg-accent' : ''
}`}
```

Add `idx` to the `.map()` call: `results.map((result, idx) => ...)`.

In the featured products list, do the same:

```tsx
class={`flex w-full items-center gap-3 rounded px-1 py-2 text-left hover:bg-accent ${
  query.length < 2 && idx === activeIndex ? 'bg-accent' : ''
}`}
```

Add `idx` to the `.map()` call: `featured.map((product, idx) => ...)`.

Add `aria-selected` based on active state:

```tsx
aria-selected={idx === activeIndex}
```

- [ ] **Step 4: Add `ref={listRef}` to both `<ul>` elements**

For the search results `<ul>` (line 177), add `ref={listRef}` when results are shown:

```tsx
<ul
  ref={query.length >= 2 ? listRef : undefined}
  class="max-h-64 overflow-y-auto py-1"
  role="listbox"
  aria-label={t('search', lang)}
>
```

For the featured products `<ul>`, add:

```tsx
<ul
  ref={query.length < 2 ? listRef : undefined}
  role="listbox"
  aria-label={t('popularItems', lang)}
>
```

- [ ] **Step 5: Reset activeIndex when query changes**

In the `handleInput` function, add `setActiveIndex(-1)` at the top:

```tsx
const handleInput = (value: string) => {
  setQuery(value);
  setActiveIndex(-1);
  clearTimeout(debounceRef.current);
  debounceRef.current = setTimeout(() => search(value), 300);
};
```

- [ ] **Step 6: Run type check and tests**

Run: `pnpm check && pnpm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/interactive/SearchBar.tsx
git commit -m "feat: add keyboard navigation to search bar results"
```

---

## Task 6: E2E Tests for Popular Badge

**Files:**

- Modify: `e2e/fixtures/products.ts`
- Modify: `e2e/helpers/mock-api.ts` (if tags aren't already included in responses)

- [ ] **Step 1: Verify tags are passed through in mock API responses**

Check `e2e/helpers/mock-api.ts`. The `GET /api/v1/products/` handler returns products from the fixtures array. Verify that the `tags` field from the fixture products is included in the response. If the mock strips fields, ensure `tags` is preserved.

In `e2e/fixtures/products.ts`, update `prod-1` to include a popular tag:

```typescript
tags: [{ label: 'popular' }],
```

Check how `normalizeProduct` processes tags. In `src/lib/normalize.ts`, look at how `tags` is mapped. If it expects `[{label: string}]` and maps to `string[]`, match that shape. If it passes through as-is, match the raw API shape.

- [ ] **Step 2: Verify the popular badge renders in dev mode**

Run: `pnpm dev`
Open `http://localhost:4321/en/` — the Falafel Wrap card should show an amber "Popular" badge in the top-right corner of its image.

- [ ] **Step 3: Run full e2e suite to check for regressions**

Run: `pnpm test:e2e`
Expected: All tests pass. No existing tests should break since we only added a visual badge.

- [ ] **Step 4: Commit any fixture/mock updates**

```bash
git add e2e/fixtures/products.ts e2e/helpers/mock-api.ts
git commit -m "test: add popular tag to product fixtures for badge testing"
```

---

## Task 7: E2E Test for Search Zero-State

**Files:**

- Create or modify: `e2e/search.spec.ts` (if it exists, add to it; if not, create it)

- [ ] **Step 1: Check if a search e2e test file exists**

Run: `ls e2e/search*.spec.ts 2>/dev/null || echo "none"`

If it exists, add tests to it. If not, create `e2e/search.spec.ts`.

- [ ] **Step 2: Write e2e test for zero-state**

```typescript
import { test, expect } from '@playwright/test';
import { setupTest } from './helpers/test-utils';

test.describe('Search', () => {
  test.beforeEach(async ({ page }) => {
    await setupTest(page);
  });

  test('shows popular items when search opens with no query', async ({ page }) => {
    // Open search
    await page.locator('[data-search-trigger]').first().click();

    // Wait for the search overlay
    await expect(page.locator('input[type="search"]')).toBeVisible();

    // Should show "Popular items" section
    await expect(page.getByText('Popular items')).toBeVisible({ timeout: 5000 });

    // Should show product items in the zero-state
    const items = page.locator('[role="option"]');
    await expect(items.first()).toBeVisible({ timeout: 5000 });
  });

  test('navigates results with arrow keys', async ({ page }) => {
    await page.locator('[data-search-trigger]').first().click();
    await expect(page.locator('input[type="search"]')).toBeVisible();

    // Wait for featured products to load
    await expect(page.locator('[role="option"]').first()).toBeVisible({ timeout: 5000 });

    // Press ArrowDown — first item should be highlighted
    await page.keyboard.press('ArrowDown');
    const firstOption = page.locator('[role="option"]').first();
    await expect(firstOption).toHaveAttribute('aria-selected', 'true');

    // Press ArrowDown again — second item highlighted
    await page.keyboard.press('ArrowDown');
    const secondOption = page.locator('[role="option"]').nth(1);
    await expect(secondOption).toHaveAttribute('aria-selected', 'true');
  });

  test('saves and shows recent searches', async ({ page }) => {
    // Open search, type a query, select a result
    await page.locator('[data-search-trigger]').first().click();
    await page.locator('input[type="search"]').fill('falafel');
    await expect(page.locator('[role="option"]').first()).toBeVisible({ timeout: 5000 });
    await page.locator('[role="option"]').first().click();

    // Reopen search — should show "Recent searches" with "falafel"
    await page.locator('[data-search-trigger]').first().click();
    await expect(page.getByText('Recent searches')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('falafel')).toBeVisible();
  });
});
```

Adjust `setupTest` import and page setup to match existing e2e patterns in the repo. Check `e2e/helpers/test-utils.ts` for the exact helper signature.

- [ ] **Step 3: Run the search e2e tests**

Run: `npx playwright test e2e/search.spec.ts`
Expected: All 3 tests pass

- [ ] **Step 4: Commit**

```bash
git add e2e/search.spec.ts
git commit -m "test: add e2e tests for search zero-state and keyboard navigation"
```

---

## Task 8: Bundle Size Check

- [ ] **Step 1: Run bundle size check**

Run: `pnpm size:check`
Expected: PASS — under 65 KB gzipped budget. The changes add minimal JS: zero-state fetch is a small `useEffect`, keyboard nav is ~30 lines, PopularBadge is server-rendered (zero client JS).

- [ ] **Step 2: If over budget, investigate**

Run: `pnpm build` and check the output for the largest chunks. The SearchBar changes are the only ones that add client-side JS. If needed, lazy-load the featured products fetch or reduce the number of featured items from 6 to 4.

- [ ] **Step 3: Final commit if any size-related adjustments were needed**

```bash
git add -u
git commit -m "fix: adjust bundle for size budget"
```

---

## Task 9: Phase 2 — Upgrade to Data-Driven Popularity (after backend ships)

> **Blocked on:** Backend shipping `is_popular` + `popularity_rank` fields on product serializer and `?ordering=-popularity` param. Track via bus discussion #18. When the SDK is bumped with these fields, proceed.

**Files:**

- Modify: `src/components/astro/PopularBadge.astro`
- Modify: `src/components/interactive/SearchBar.tsx`
- Modify: `src/lib/normalize.ts`
- Modify: `e2e/fixtures/products.ts`
- Modify: `e2e/helpers/mock-api.ts`

- [ ] **Step 1: Update SDK dependency**

```bash
pnpm update @poweredbysous/storefront-sdk
```

Run: `pnpm check`
Expected: New fields `is_popular` and `popularity_rank` should be available on product types.

- [ ] **Step 2: Add `is_popular` and `popularity_rank` to NormalizedProduct**

In `src/lib/normalize.ts`, add to the `NormalizedProduct` interface:

```typescript
is_popular: boolean;
popularity_rank: number | null;
```

In the `normalizeProduct` function, map the new fields:

```typescript
is_popular: !!(raw as Record<string, unknown>).is_popular,
popularity_rank: ((raw as Record<string, unknown>).popularity_rank as number) ?? null,
```

- [ ] **Step 3: Update PopularBadge to prefer `is_popular` over tag check**

In `src/components/astro/PopularBadge.astro`, update the Props and logic:

```astro
---
import { t } from '@/i18n';

interface Props {
  isPopular?: boolean;
  tags?: string[];
  lang: string;
  overlay?: boolean;
}

const { isPopular, tags = [], lang, overlay = false } = Astro.props;
// Prefer API field, fall back to tag-based detection
const showBadge = isPopular ?? tags.some((tag) => tag.toLowerCase() === 'popular');
---

{
  showBadge && (
    <span
      class:list={[
        'inline-flex items-center justify-center font-semibold leading-none whitespace-nowrap',
        overlay
          ? 'absolute top-1.5 right-1.5 z-10 rounded-full bg-amber-500 px-2.5 py-1 text-[12px] text-white sm:top-2 sm:right-2'
          : 'rounded-sm bg-amber-500 px-1.5 py-0.5 text-xs font-medium text-white',
      ]}
    >
      {t('popular', lang)}
    </span>
  )
}
```

Update `ProductCard.astro` to pass the new prop:

```astro
<PopularBadge isPopular={product.is_popular} tags={product.tags ?? []} lang={lang} overlay />
```

- [ ] **Step 4: Update SearchBar to use `?ordering=-popularity`**

In `src/components/interactive/SearchBar.tsx`, update the featured products fetch:

```tsx
const { data } = await client.GET('/api/v1/products/', {
  params: { query: { ordering: '-popularity', page_size: '6' } },
  signal: controller.signal,
});
```

- [ ] **Step 5: Update fixtures and mock API**

In `e2e/fixtures/products.ts`, add to `productDefaults()`:

```typescript
is_popular: false,
popularity_rank: null,
```

Set `is_popular: true, popularity_rank: 1` on `prod-1` (Falafel Wrap).

In `e2e/helpers/mock-api.ts`, ensure the `?ordering=-popularity` query param is handled. Sort the products array by `popularity_rank` (nulls last) when this ordering is requested.

- [ ] **Step 6: Run contract tests**

Run: `npx playwright test e2e/contract.spec.ts`
Expected: PASS — mock responses match updated OpenAPI schema

- [ ] **Step 7: Run full test suite**

Run: `pnpm check && pnpm test && pnpm test:e2e`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add -u
git commit -m "feat: upgrade popular badges and search to use API popularity data"
```
