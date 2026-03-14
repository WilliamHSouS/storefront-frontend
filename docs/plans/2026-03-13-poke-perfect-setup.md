# Poke Perfect Demo Setup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up the Poke Perfect demo merchant with themed config, modal-based product browsing with shallow routing, and a category drawer.

**Architecture:** Three independent features. Task 1 is standalone JSON config. Task 2 wires product card clicks to the existing ProductDetail modal with URL sync via `history.pushState`. Task 3 adds a new CategoryDrawer Preact island mounted in StickyNav.

**Tech Stack:** Astro 5, Preact, Nanostores, Tailwind CSS, TypeScript

---

### Task 1: Poke Perfect Demo Merchant Config

**Files:**
- Create: `src/merchants/poke-perfect-demo.json`

**Step 1: Create the merchant config file**

```json
{
  "slug": "poke-perfect-demo",
  "merchantId": "POKE_PERFECT_DEMO_01",
  "name": "Poké Perfect",
  "description": "Fresh poké bowls made with premium ingredients. Build your own or try our signature creations.",
  "logo": "/merchants/poke-perfect-demo/logo.svg",
  "heroImage": "/merchants/poke-perfect-demo/hero.jpg",
  "favicon": "/merchants/poke-perfect-demo/favicon.ico",
  "languages": ["nl", "en"],
  "defaultLanguage": "nl",
  "currency": "EUR",
  "theme": {
    "background": "0 0% 100%",
    "foreground": "0 0% 7%",
    "card": "0 0% 100%",
    "cardForeground": "0 0% 7%",
    "cardImage": "160 10% 94%",
    "primary": "160 43% 52%",
    "primaryForeground": "0 0% 100%",
    "secondary": "160 20% 96%",
    "secondaryForeground": "160 30% 25%",
    "muted": "0 0% 96%",
    "mutedForeground": "0 0% 45%",
    "accent": "160 30% 94%",
    "accentForeground": "160 40% 30%",
    "destructive": "0 72% 51%",
    "destructiveForeground": "0 0% 100%",
    "border": "0 0% 90%",
    "input": "0 0% 90%",
    "ring": "160 43% 52%",
    "radius": "0.75rem",
    "fontHeading": "DM Sans",
    "fontBody": "Inter"
  },
  "layout": "grid",
  "contact": {
    "phone": "+31 20 555 0100",
    "email": "info@pokeperfect.nl",
    "address": "Haarlemmerstraat 52, 1013 ES Amsterdam"
  },
  "hours": [
    { "days": "Mon-Fri", "open": "11:00", "close": "22:00" },
    { "days": "Sat-Sun", "open": "12:00", "close": "22:00" }
  ],
  "social": {
    "instagram": "https://instagram.com/pokeperfect"
  },
  "hmacSecret": "0000000000000000000000000000000000000000000000000000000000000000",
  "seo": {
    "titleTemplate": "%s | Poké Perfect",
    "defaultDescription": "Bestel online bij Poké Perfect — Verse poké bowls in Amsterdam"
  }
}
```

**Step 2: Verify the config loads**

Run: `pnpm build 2>&1 | head -20`
Expected: No errors about merchant config loading.

**Step 3: Commit**

```bash
git add src/merchants/poke-perfect-demo.json
git commit -m "feat: add poke-perfect-demo merchant config with mint green theme"
```

---

### Task 2: Product Modal with Shallow Routing

**Goal:** Clicking a product card opens the ProductDetail modal (instead of navigating to the SSR page) and updates the browser URL for bookmarkability. The SSR page remains for direct navigation and SEO.

**Files:**
- Modify: `src/stores/ui.ts` — add `slug` to `SelectedProduct`
- Modify: `src/components/astro/ProductCard.astro` — add data attributes to `<a>`, pass `slug` to `AddToCartButton`
- Modify: `src/components/interactive/AddToCartButton.tsx` — accept `slug` prop, pass it to `$selectedProduct`
- Modify: `src/components/interactive/ProductDetail.tsx` — add URL sync and `open-product` event listener
- Modify: `src/components/astro/BaseLayout.astro` — add inline script to intercept product card link clicks

**Step 1: Add `slug` to `SelectedProduct` interface**

In `src/stores/ui.ts`, change:

```typescript
export interface SelectedProduct {
  id: string | number;
  name: string;
  /** When true, skip the detail view and show the upsell step directly. */
  skipToUpsell?: boolean;
}
```

To:

```typescript
export interface SelectedProduct {
  id: string | number;
  name: string;
  /** URL slug for shallow routing (e.g. "falafel-wrap--prod-1"). */
  slug?: string;
  /** When true, skip the detail view and show the upsell step directly. */
  skipToUpsell?: boolean;
}
```

**Step 2: Add data attributes to ProductCard link**

In `src/components/astro/ProductCard.astro`, change the `<a>` tag (line 115):

```html
<a href={`/${lang}/product/${product.slug}`} class="after:absolute after:inset-0">
```

To:

```html
<a
  href={`/${lang}/product/${product.slug}`}
  class="after:absolute after:inset-0"
  data-product-modal
  data-product-id={product.id}
  data-product-name={product.name}
  data-product-slug={product.slug}
>
```

**Step 3: Pass `slug` prop to AddToCartButton**

In `src/components/astro/ProductCard.astro`, change the `AddToCartButton` usage (line 149-156):

```html
<AddToCartButton
  client:idle
  productId={String(product.id)}
  productName={product.name}
  productSlug={product.slug}
  hasModifiers={hasModifiers}
  soldOut={product.sold_out ?? false}
  lang={lang}
/>
```

**Step 4: Update AddToCartButton to accept and pass `slug`**

In `src/components/interactive/AddToCartButton.tsx`:

Add `productSlug` to the Props interface:

```typescript
interface Props {
  productId: string;
  productName: string;
  productSlug?: string;
  hasModifiers: boolean;
  soldOut: boolean;
  lang: string;
}
```

Update the destructuring:

```typescript
export default function AddToCartButton({
  productId,
  productName,
  productSlug,
  hasModifiers,
  soldOut,
  lang,
}: Props) {
```

Update every `$selectedProduct.set()` call to include `slug`:

- Line 67: `$selectedProduct.set({ id: productId, name: productName, slug: productSlug });`
- Line 85: `$selectedProduct.set({ id: productId, name: productName, slug: productSlug });`
- Line 95: `$selectedProduct.set({ id: productId, name: productName, slug: productSlug, skipToUpsell: true });`

**Step 5: Add product card click interception script to BaseLayout**

In `src/components/astro/BaseLayout.astro`, add an inline script before the analytics script (before line 101):

```html
<script is:inline>
  document.addEventListener('click', function (e) {
    var link = e.target.closest('[data-product-modal]');
    if (!link) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('open-product', {
      detail: {
        id: link.getAttribute('data-product-id'),
        name: link.getAttribute('data-product-name'),
        slug: link.getAttribute('data-product-slug')
      }
    }));
  });
</script>
```

**Step 6: Add URL sync and event listener to ProductDetail**

In `src/components/interactive/ProductDetail.tsx`:

Add a ref to track whether we pushed history state:

```typescript
const didPushState = useRef(false);
```

Add a `useEffect` to listen for the `open-product` custom event (after existing effects):

```typescript
// Listen for product card click events (dispatched from inline script)
useEffect(() => {
  const handler = (e: Event) => {
    const { id, name, slug } = (e as CustomEvent).detail;
    $selectedProduct.set({ id, name, slug });
  };
  window.addEventListener('open-product', handler);
  return () => window.removeEventListener('open-product', handler);
}, []);
```

Update the `close` function to handle history:

```typescript
const close = () => {
  const wasPushed = didPushState.current;
  didPushState.current = false;
  $selectedProduct.set(null);
  // Pop the shallow-routed URL entry after clearing state,
  // so the popstate handler (which checks didPushState) won't double-fire.
  if (wasPushed) {
    history.back();
  }
};
```

Add a `useEffect` for URL sync (push state when modal opens, listen for popstate):

```typescript
// Shallow routing: sync URL with modal state
useEffect(() => {
  if (selectedProduct?.slug && !selectedProduct.skipToUpsell) {
    // Don't push if we're already on a product URL
    if (!window.location.pathname.includes('/product/')) {
      const langPrefix = (window as { __LANG__?: string }).__LANG__ || 'en';
      history.pushState(
        { productModal: true },
        '',
        `/${langPrefix}/product/${selectedProduct.slug}`,
      );
      didPushState.current = true;
    }
  }
}, [selectedProduct]);

// Handle browser back button
useEffect(() => {
  const onPopState = () => {
    // Only react if we pushed state and modal is still open
    if (didPushState.current) {
      didPushState.current = false;
      $selectedProduct.set(null);
    }
  };
  window.addEventListener('popstate', onPopState);
  return () => window.removeEventListener('popstate', onPopState);
}, []);
```

**Step 7: Run existing tests to verify nothing breaks**

Run: `pnpm test`
Expected: All unit tests pass.

Run: `pnpm check`
Expected: No type errors.

**Step 8: Commit**

```bash
git add src/stores/ui.ts src/components/astro/ProductCard.astro src/components/interactive/AddToCartButton.tsx src/components/interactive/ProductDetail.tsx src/layouts/BaseLayout.astro
git commit -m "feat: product modal with shallow routing for bookmarkable URLs"
```

---

### Task 3: Category Drawer

**Goal:** Hamburger icon button to the left of category tabs. Dropdown popover on desktop, full-screen overlay on mobile. Clicking a category scrolls to it and closes the drawer.

**Files:**
- Create: `src/components/interactive/CategoryDrawer.tsx`
- Modify: `src/components/astro/StickyNav.astro` — add trigger button + mount island

**Step 1: Create the CategoryDrawer component**

Create `src/components/interactive/CategoryDrawer.tsx`:

```tsx
import { useStore } from '@nanostores/preact';
import { useEffect, useRef } from 'preact/hooks';
import { $isCategoryDrawerOpen, $activeCategory } from '@/stores/ui';
import { t } from '@/i18n';

interface Category {
  id: string | number;
  name: string;
}

interface Props {
  categories: Category[];
  lang: string;
}

export default function CategoryDrawer({ categories, lang }: Props) {
  const isOpen = useStore($isCategoryDrawerOpen);
  const activeCategory = useStore($activeCategory);
  const panelRef = useRef<HTMLDivElement>(null);

  // Listen for trigger button click
  useEffect(() => {
    const handler = () => $isCategoryDrawerOpen.set(!$isCategoryDrawerOpen.get());
    window.addEventListener('toggle-category-drawer', handler);
    return () => window.removeEventListener('toggle-category-drawer', handler);
  }, []);

  // Lock body scroll on mobile when open
  useEffect(() => {
    if (!isOpen) return;
    const mq = window.matchMedia('(max-width: 767px)');
    if (mq.matches) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isOpen]);

  // Close on click outside (desktop popover)
  // Deferred registration avoids catching the opening click event
  useEffect(() => {
    if (!isOpen) return;
    let id: ReturnType<typeof setTimeout>;
    const handler = (e: MouseEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const trigger = document.querySelector('[data-category-drawer-trigger]');
      if (
        !panel.contains(e.target as Node) &&
        !trigger?.contains(e.target as Node)
      ) {
        $isCategoryDrawerOpen.set(false);
      }
    };
    id = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', handler);
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') $isCategoryDrawerOpen.set(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  const handleSelect = (categoryId: string) => {
    $activeCategory.set(categoryId);
    $isCategoryDrawerOpen.set(false);
    const section = document.getElementById(`collection-${categoryId}`);
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (!isOpen) return <div />;

  return (
    <>
      {/* Mobile: full-screen overlay */}
      <div class="fixed inset-0 z-50 flex flex-col bg-background md:hidden">
        <div class="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 class="font-heading text-lg font-semibold text-foreground">{t('menu', lang)}</h2>
          <button
            type="button"
            onClick={() => $isCategoryDrawerOpen.set(false)}
            class="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
            aria-label={t('close', lang)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        <nav data-category-drawer class="flex-1 overflow-y-auto px-4 py-4">
          <ul class="space-y-1">
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(String(cat.id))}
                  class={`w-full rounded-lg px-4 py-3 text-left text-base font-medium transition-colors ${
                    activeCategory === String(cat.id)
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  {cat.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {/* Desktop: dropdown popover */}
      <div
        ref={panelRef}
        class="absolute left-0 top-full z-50 mt-2 hidden w-56 rounded-xl border border-border bg-card p-2 shadow-lg md:block"
      >
        <nav data-category-drawer>
          <ul class="space-y-0.5">
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(String(cat.id))}
                  class={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                    activeCategory === String(cat.id)
                      ? 'bg-primary text-primary-foreground'
                      : 'text-card-foreground hover:bg-muted'
                  }`}
                >
                  {cat.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
```

**Step 2: Add trigger button and mount CategoryDrawer in StickyNav**

In `src/components/astro/StickyNav.astro`, add the import at the top of the frontmatter:

```typescript
import CategoryDrawer from '@/components/interactive/CategoryDrawer';
```

Replace the inner `<div>` content (lines 18-46) with:

```html
<div class="sticky top-0 z-30 bg-background pt-2 pb-3 sm:pt-3 sm:pb-4">
  <div class="mx-auto flex max-w-[1160px] items-center gap-3 px-4 sm:px-6 lg:px-8">
    {/* Wrap trigger + drawer in relative container so desktop popover anchors to the button */}
    <div class="relative">
      <button
        type="button"
        data-category-drawer-trigger
        class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-foreground hover:bg-card/80"
        aria-label={t('menu', lang)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" x2="20" y1="12" y2="12" />
          <line x1="4" x2="20" y1="6" y2="6" />
          <line x1="4" x2="20" y1="18" y2="18" />
        </svg>
      </button>
      <CategoryDrawer client:idle categories={categories} lang={lang} />
    </div>

    <CategoryTabs client:idle categories={categories} />

    <AddressBar client:idle lang={lang} />

    <div class="flex items-center gap-1">
      <button
        type="button"
        class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-card text-foreground hover:bg-card/80"
        aria-label={t('search', lang)}
        data-search-trigger
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>
        </svg>
      </button>
      <CartBadge client:load lang={lang} />
    </div>
  </div>
</div>
```

**Step 3: Wire the trigger button to the store**

Add an inline script at the bottom of `StickyNav.astro`:

```html
<script is:inline>
  document.querySelector('[data-category-drawer-trigger]')?.addEventListener('click', function () {
    window.dispatchEvent(new CustomEvent('toggle-category-drawer'));
  });
</script>
```

The `CategoryDrawer` component already listens for this event via a `useEffect` (included in Step 1).

**Step 4: Run tests**

Run: `pnpm test`
Expected: All unit tests pass.

Run: `pnpm check`
Expected: No type errors.

**Step 5: Commit**

```bash
git add src/components/interactive/CategoryDrawer.tsx src/components/astro/StickyNav.astro
git commit -m "feat: category drawer with dropdown on desktop, full-screen overlay on mobile"
```

---

### Task 4: E2E Tests

**Files:**
- Modify: `e2e/product-detail.spec.ts` — add test for modal URL sync
- Modify: `e2e/navigation.spec.ts` — add test for category drawer

**Step 1: Add E2E test for product modal shallow routing**

Add to `e2e/product-detail.spec.ts`:

```typescript
test('product card click opens modal and updates URL', async ({ page }) => {
  // Click first product card link
  const productCard = page.locator('[data-product-modal]').first();
  const slug = await productCard.getAttribute('data-product-slug');
  await productCard.click();

  // Modal should be visible
  await expect(page.locator('[role="dialog"]')).toBeVisible();

  // URL should contain the product slug
  expect(page.url()).toContain(`/product/${slug}`);

  // Close modal
  await page.keyboard.press('Escape');

  // URL should revert to menu page
  await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  expect(page.url()).not.toContain('/product/');
});
```

**Step 2: Add E2E test for category drawer**

Add to `e2e/navigation.spec.ts`:

```typescript
test('category drawer opens and navigates to section', async ({ page }) => {
  // Click the category drawer trigger
  await page.click('[data-category-drawer-trigger]');

  // Drawer nav should appear (uses data-category-drawer attribute for specificity)
  const drawerNav = page.locator('[data-category-drawer]');
  await expect(drawerNav.first()).toBeVisible();

  // Click a category
  const categoryButton = drawerNav.first().locator('button').first();
  await categoryButton.click();

  // Drawer should close
  await expect(drawerNav.first()).not.toBeVisible();
});
```

**Step 3: Run E2E tests**

Run: `pnpm test:e2e`
Expected: New tests pass alongside existing tests.

**Step 4: Commit**

```bash
git add e2e/product-detail.spec.ts e2e/navigation.spec.ts
git commit -m "test: add E2E tests for product modal routing and category drawer"
```
