# Poke Perfect Demo Setup — Design

## Overview

Set up the Poke Perfect demo merchant with three features:

1. Merchant config with mint green theme
2. Product modal URL sync (shallow routing) for bookmarkability/SEO
3. Category drawer (dropdown on desktop, full-screen overlay on mobile)

---

## 1. Merchant Config

**File:** `src/merchants/poke-perfect-demo.json`

- Slug: `poke-perfect-demo`
- Merchant ID: `POKE_PERFECT_DEMO_01`
- Theme: mint/seafoam green primary, red destructive for discount badges
- Languages: `["nl", "en"]`, default `"nl"`
- Layout: `grid`
- Radius: `0.75rem`
- Fonts: DM Sans (headings), Inter (body)

No code changes — the existing CSS variable system picks up new merchant configs automatically via `import.meta.glob()`.

---

## 2. Product Modal URL Sync (Shallow Routing)

**Goal:** URL updates to `/{lang}/product/{slug}` when the modal opens, reverts when closed. Direct navigation renders the existing SSR product page.

### Changes

**`src/stores/ui.ts`** — Add optional `slug` field to `SelectedProduct` interface.

**`src/components/interactive/ProductDetail.tsx`** — In the `useEffect` that fires when `selectedProduct` changes:

- On open: `history.pushState(null, '', '/{lang}/product/{slug}')` (only when slug is present and we're not already on a product URL)
- On close: `history.back()` (only if we pushed state)
- Listen for `popstate` event → close modal
- Track `didPushState` ref to avoid double back navigation

**`src/components/interactive/AddToCartButton.tsx`** — Pass `slug` through when setting `$selectedProduct`.

**`src/components/astro/ProductCard.astro`** — Already has slug from `normalizeProduct()`, pass it to `AddToCartButton`.

### URL lifecycle

- Click product → modal opens → URL becomes `/{lang}/product/{slug}`
- Close modal → `history.back()` → URL reverts to menu page
- Browser back → `popstate` → modal closes
- Direct navigation to product URL → SSR page renders (no modal)

### No changes to

Middleware, routing, SSR product page, sitemap, normalize.ts.

---

## 3. Category Drawer

**Goal:** Hamburger icon next to category tabs opens a category list. Dropdown on desktop, full-screen overlay on mobile.

### New component

**`src/components/interactive/CategoryDrawer.tsx`** — Preact island

- Reads `$isCategoryDrawerOpen` and `$activeCategory` stores
- **Desktop (md+):** Absolute-positioned dropdown below trigger, category list, click-outside-to-close
- **Mobile (<md):** Fixed full-screen overlay with backdrop, close button, larger touch targets
- Click category → scroll to section via `document.getElementById('collection-{id}').scrollIntoView()`, close drawer, set `$activeCategory`
- Body scroll lock on mobile when open

### StickyNav changes

**`src/components/astro/StickyNav.astro`** — Add hamburger trigger button + mount `<CategoryDrawer client:idle />` before `CategoryTabs`.

Trigger button toggles `$isCategoryDrawerOpen` (store already exists in `src/stores/ui.ts`).

---

## Implementation Order

1. Merchant config (standalone, no dependencies)
2. Product modal URL sync (touches stores + 2 components)
3. Category drawer (new component + StickyNav change)
