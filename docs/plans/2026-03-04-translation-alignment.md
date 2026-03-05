# Translation Alignment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align the frontend with backend translation changes so all API-fetched content is properly translated.

**Architecture:** The backend now returns translated content via `Accept-Language` header (set by the SDK's `language` parameter). Most product/category content already flows through normalization functions that map `title → name`. The main gap is the **cart line item options** — the frontend types and mock API use different field names than the real API. Additionally, a hardcoded `'Yes'/'No'` in ProductDetail needs i18n keys.

**Tech Stack:** Astro 5 + Preact + Nanostores + TypeScript, Vitest (unit), Playwright (e2e)

---

## Background: What the Backend Changed

The backend PR adds multi-language support to all public-facing endpoints:

- **Language resolution:** New middleware resolves language from `Accept-Language` header (primary) or `?lang=` query param (fallback). Sets `Content-Language` on responses.
- **Translated fields:** `TranslatedField` DRF field replaces `SerializerMethodField` boilerplate. Products (`title`, `description`, `intro`), categories (`name`, `description`), modifier groups (`title`), modifiers (`title`), CMS pages (`title`, `meta_title`, `meta_description`), pickup locations (`name`, `pickup_instructions`), discounts (`name`).
- **Cart read-time overlay:** Cart snapshots store the merchant's default locale. At read time, `serialize_cart(lang=...)` batch-fetches translated titles and overlays them on `product_title`, `option_title`, `option_group_title`.

## What Already Works (No Changes Needed)

| Area                          | Why it works                                                                                                                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Product names & descriptions  | `normalizeProduct()` maps `title → name` — translated `title` flows through                                                               |
| Category names                | API returns `name` (TranslatedField) — frontend reads `name` directly                                                                     |
| Modifier group & option names | `mapModifierGroup()` maps `raw.title → name` — translated `title` flows through                                                           |
| Cart `product_title`          | Frontend `CartLineItem.product_title` matches API field name                                                                              |
| SDK sends language            | Both server-side (middleware) and client-side (`document.documentElement.lang`) pass language to SDK, which sets `Accept-Language` header |
| Collection names              | `normalizeCollection()` maps `title → name`                                                                                               |

## What Needs Changing

### Gap 1: Cart Option Field Name Mismatches

The frontend `CartLineItem.selected_options` and mock API use **different field names** than the real backend API:

| Real API field                        | Frontend field     | Used in                                                |
| ------------------------------------- | ------------------ | ------------------------------------------------------ |
| `options` (on line item)              | `selected_options` | `CartLineItem` interface, `CartDrawer`, `recalcCart()` |
| `option_id`                           | `id`               | `CartLineItem.selected_options[].id`                   |
| `option_title` (now translated)       | `name`             | `CartDrawer` renders `m.name`                          |
| `option_group_title` (now translated) | _(missing)_        | Not displayed                                          |
| `price_modifier`                      | `price`            | `recalcCart()` in mock API                             |

**Approach:** Add a `normalizeCart()` function (consistent with existing `normalizeProduct()` pattern) that maps the API response shape to the frontend `Cart` interface. Call it at the boundary in the cart store. This keeps component code unchanged while fixing the API alignment.

### Gap 2: Hardcoded 'Yes'/'No' for Boolean Attributes

`ProductDetail.tsx:349` has:

```typescript
display = attr.value_boolean ? 'Yes' : 'No';
```

These need `t('yes', lang)` / `t('no', lang)` translation keys.

### Gap 3: Mock API Fixture Alignment

The mock API fixtures don't match the real API field names. This means:

- E2e tests don't exercise the normalization layer for products
- Cart operations bypass the `normalizeCart()` function we'll add

**Approach:** Update fixtures to use real API field names (`title` for products/modifiers, `option_title`/`option_id`/`price_modifier` for cart options).

---

## Tasks

### Task 1: Add `yes`/`no` Translation Keys

**Files:**

- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/nl.json`
- Modify: `src/i18n/messages/de.json`
- Modify: `src/components/interactive/ProductDetail.tsx:349`

**Step 1: Add keys to all three translation files**

`en.json` — add:

```json
"yes": "Yes",
"no": "No"
```

`nl.json` — add:

```json
"yes": "Ja",
"no": "Nee"
```

`de.json` — add:

```json
"yes": "Ja",
"no": "Nein"
```

**Step 2: Use translation keys in ProductDetail.tsx**

Replace line 349:

```typescript
// Before
display = attr.value_boolean ? 'Yes' : 'No';

// After
display = attr.value_boolean ? t('yes', lang) : t('no', lang);
```

**Step 3: Run type check**

Run: `pnpm check`
Expected: PASS (new keys are auto-detected from nl.json)

**Step 4: Commit**

```bash
git add src/i18n/messages/ src/components/interactive/ProductDetail.tsx
git commit -m "feat(i18n): add yes/no translation keys for boolean attributes"
```

---

### Task 2: Add `normalizeCart()` Function

**Files:**

- Modify: `src/lib/normalize.ts`
- Test: `src/lib/__tests__/normalize.test.ts` (create if needed)

**Step 1: Write the failing test**

Create `src/lib/__tests__/normalize.test.ts` (or add to existing test file):

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeCart, type Cart } from '@/lib/normalize';

describe('normalizeCart', () => {
  it('maps API cart response to frontend Cart shape', () => {
    const apiResponse = {
      id: 'cart-1',
      line_items: [
        {
          id: 'li-1',
          product_id: 42,
          product_title: 'Falafel Wrap',
          unit_price: '8.50',
          quantity: 2,
          line_total: '17.00',
          options: [
            {
              option_id: 10,
              option_group_id: 5,
              option_title: 'Large',
              option_group_title: 'Size',
              price_modifier: '3.00',
              quantity: 1,
            },
          ],
        },
      ],
      cart_total: '17.00',
      item_count: 2,
    };

    const cart = normalizeCart(apiResponse);

    expect(cart.id).toBe('cart-1');
    expect(cart.line_items[0].product_title).toBe('Falafel Wrap');
    expect(cart.line_items[0].selected_options).toHaveLength(1);
    expect(cart.line_items[0].selected_options![0]).toEqual({
      id: 10,
      name: 'Large',
      price: '3.00',
      quantity: 1,
    });
  });

  it('handles cart with no options', () => {
    const apiResponse = {
      id: 'cart-1',
      line_items: [
        {
          id: 'li-1',
          product_id: 42,
          product_title: 'Falafel',
          unit_price: '8.50',
          quantity: 1,
          line_total: '8.50',
          options: [],
        },
      ],
      cart_total: '8.50',
      item_count: 1,
    };

    const cart = normalizeCart(apiResponse);
    expect(cart.line_items[0].selected_options).toEqual([]);
  });

  it('handles missing options field', () => {
    const apiResponse = {
      id: 'cart-1',
      line_items: [
        {
          id: 'li-1',
          product_id: 42,
          product_title: 'Falafel',
          unit_price: '8.50',
          quantity: 1,
          line_total: '8.50',
        },
      ],
      cart_total: '8.50',
      item_count: 1,
    };

    const cart = normalizeCart(apiResponse);
    expect(cart.line_items[0].selected_options).toEqual([]);
  });

  it('preserves cart_savings when present', () => {
    const apiResponse = {
      id: 'cart-1',
      line_items: [],
      cart_total: '5.10',
      cart_savings: '0.90',
      item_count: 1,
    };

    const cart = normalizeCart(apiResponse);
    expect(cart.cart_savings).toBe('0.90');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/__tests__/normalize.test.ts`
Expected: FAIL — `normalizeCart` is not exported

**Step 3: Implement `normalizeCart()`**

Add to `src/lib/normalize.ts`:

```typescript
/**
 * Raw cart option shape from the API.
 * The API uses `option_title` and `price_modifier`; frontend uses `name` and `price`.
 */
interface RawCartOption {
  option_id: number | string;
  option_group_id?: number | string;
  option_title: string;
  option_group_title?: string;
  price_modifier: string;
  quantity: number;
}

/** Raw cart line item shape from the API. */
interface RawCartLineItem {
  id: string;
  product_id: number | string;
  product_title: string;
  product_image?: string;
  unit_price: string;
  quantity: number;
  line_total: string;
  options?: RawCartOption[];
  // Fallback fields for backward compat with mock API
  selected_options?: Array<{ id: number | string; name: string; price: string; quantity: number }>;
  discount?: { type: string; label: string; savings: string };
  notes?: string;
}

/** Raw cart shape from the API. */
interface RawCart {
  id: string;
  line_items: RawCartLineItem[];
  cart_total: string;
  cart_savings?: string;
  item_count: number;
}

/**
 * Normalize a raw API cart response to the shape frontend components expect.
 *
 * Maps `options[].option_title` → `selected_options[].name` and
 * `options[].price_modifier` → `selected_options[].price`, consistent
 * with the boundary-normalization pattern used for products and categories.
 */
export function normalizeCart(raw: Record<string, unknown>): Cart {
  const r = raw as unknown as RawCart;
  return {
    id: r.id,
    line_items: (r.line_items ?? []).map((item) => {
      // Support both `options` (real API) and `selected_options` (mock/fallback)
      const rawOptions = item.options ?? [];
      const fallbackOptions = item.selected_options ?? [];

      const selectedOptions =
        rawOptions.length > 0
          ? rawOptions.map((opt) => ({
              id: opt.option_id,
              name: opt.option_title,
              price: opt.price_modifier,
              quantity: opt.quantity,
            }))
          : fallbackOptions;

      return {
        id: item.id,
        product_id: item.product_id,
        product_title: item.product_title,
        product_image: item.product_image,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_total: item.line_total,
        selected_options: selectedOptions,
        discount: item.discount,
        notes: item.notes,
      };
    }),
    cart_total: r.cart_total,
    cart_savings: r.cart_savings,
    item_count: r.item_count,
  };
}
```

Note: Import `Cart` type from the cart store, or re-export it from normalize. Since `Cart` is defined in `stores/cart.ts`, either:

- Move the `Cart` and `CartLineItem` interfaces to `types/` or `normalize.ts` and import from both places
- Or import `Cart` from the store into normalize.ts

The cleanest approach: keep `Cart` and `CartLineItem` types in `stores/cart.ts` (where they're used most) and import them in normalize.ts. The function returns `Cart`.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/__tests__/normalize.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/normalize.ts src/lib/__tests__/normalize.test.ts
git commit -m "feat: add normalizeCart() to map API cart response to frontend shape"
```

---

### Task 3: Wire `normalizeCart()` into Cart Store and Components

**Files:**

- Modify: `src/stores/cart.ts` — call `normalizeCart()` after API responses
- Modify: `src/components/interactive/CartDrawer.tsx` — call `normalizeCart()` after mutations
- Modify: `src/components/interactive/ProductDetail.tsx` — call `normalizeCart()` after add-to-cart

**Step 1: Update cart store**

In `src/stores/cart.ts`, import and use `normalizeCart`:

```typescript
import { normalizeCart } from '@/lib/normalize';
```

In `ensureCart()`, replace:

```typescript
// Before
$cart.set(data as Cart);

// After
$cart.set(normalizeCart(data as Record<string, unknown>));
```

Apply this in both places in `ensureCart()` (the GET and POST calls).

**Step 2: Update CartDrawer.tsx**

In `handleUpdateQuantity` and `handleRemove`, replace:

```typescript
// Before
if (data) $cart.set(data as typeof cart);

// After
if (data) $cart.set(normalizeCart(data as Record<string, unknown>));
```

Add import at top:

```typescript
import { normalizeCart } from '@/lib/normalize';
```

**Step 3: Update ProductDetail.tsx**

In `handleSubmit`, replace:

```typescript
// Before
const cartData = data as Cart;
$cart.set(cartData);
if (cartData.id) setStoredCartId(cartData.id);

// After
const cartData = normalizeCart(data as Record<string, unknown>);
$cart.set(cartData);
if (cartData.id) setStoredCartId(cartData.id);
```

Add import at top:

```typescript
import { normalizeCart } from '@/lib/normalize';
```

**Step 4: Run existing tests**

Run: `pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/cart.ts src/components/interactive/CartDrawer.tsx src/components/interactive/ProductDetail.tsx
git commit -m "feat: wire normalizeCart() into cart store and components"
```

---

### Task 4: Update Mock API Product Fixtures to Use `title`

The real API returns `title` for products and modifiers. The mock API uses `name`. Update fixtures to match reality so the normalization layer is tested in e2e.

**Files:**

- Modify: `e2e/fixtures/products.ts` — rename `name` → `title` on products, modifier groups, and modifier options
- Modify: `e2e/helpers/mock-api.ts` — update references to `product.name` → `product.title`; update cart add handler to use `title` fields; update search handler to search `title`

**Step 1: Update product fixtures**

In `e2e/fixtures/products.ts`:

Products array — rename `name` to `title`:

```typescript
{ id: 'prod-1', title: 'Falafel Wrap', slug: 'falafel-wrap', ... }
```

Modifier groups in `shawarmaDetail` — rename `name` to `title` on groups AND options:

```typescript
modifier_groups: [
  {
    id: 'mod-size',
    title: 'Size',            // was: name
    ...
    options: [
      { id: 'opt-regular', title: 'Regular', price_modifier: '0.00' },  // was: name, price
      { id: 'opt-large', title: 'Large', price_modifier: '3.00' },
    ],
  },
  ...
]
```

Cross-sells — rename `name` to `title`.

Also rename modifier option `price` → `price_modifier` to match real API.

**Step 2: Update mock-api.ts references**

- Search handler (line 137): `p.name` → `p.title`
- Cart add handler (line 228): `product.name` → `product.title`
- Cart add modifier lookup (line 218): `opt?.name` → `opt?.title`
- Cart add option shape (line 217-222): Use API field names:
  ```typescript
  return {
    option_id: m.option_id,
    option_title: opt?.title ?? String(m.option_id),
    option_group_title: '', // mock doesn't need this
    price_modifier: opt?.price_modifier ?? '0.00',
    quantity: m.quantity,
  };
  ```
- Cart line item shape (line 225-235): Update `product_title` source:
  ```typescript
  product_title: product.title,
  ```
- Cart line item options field: rename `selected_options` → `options` in line item shape

**Step 3: Update cart fixture**

In `e2e/fixtures/cart.ts`, update `CartFixture` type and fixture functions to use API field names:

- `selected_options` → `options`
- Option shape: `{ option_id, option_title, option_group_title, price_modifier, quantity }`

For example `cartWithMultipleItems()`:

```typescript
options: [{ option_id: 'opt-regular', option_title: 'Regular', option_group_title: 'Size', price_modifier: '0.00', quantity: 1 }],
```

Also update `recalcCart()` in mock-api.ts to use `price_modifier` instead of `price`.

**Step 4: Run e2e tests**

Run: `pnpm test:e2e`
Expected: PASS (normalizeCart handles the API shape correctly)

**Step 5: Commit**

```bash
git add e2e/
git commit -m "test: align mock API fixtures with real backend field names"
```

---

### Task 5: Type Check, Unit Test, and Bundle Size

**Step 1: Run type check**

Run: `pnpm check`
Expected: PASS

**Step 2: Run unit tests**

Run: `pnpm test`
Expected: PASS

**Step 3: Run bundle size check**

Run: `pnpm size:check`
Expected: PASS (under 65 KB gzipped — normalizeCart adds minimal code)

**Step 4: Run e2e tests**

Run: `pnpm test:e2e`
Expected: PASS

**Step 5: Final commit (if any fixes needed)**

---

## Summary

| Change                         | Reason                                                  | Files                                                   |
| ------------------------------ | ------------------------------------------------------- | ------------------------------------------------------- |
| Add `yes`/`no` i18n keys       | Boolean attributes had hardcoded English                | `src/i18n/messages/*.json`, `ProductDetail.tsx`         |
| Add `normalizeCart()`          | Cart API uses different field names than frontend types | `src/lib/normalize.ts`                                  |
| Wire normalizeCart into stores | All cart API responses need normalization               | `stores/cart.ts`, `CartDrawer.tsx`, `ProductDetail.tsx` |
| Align mock API fixtures        | E2e tests should match real API shape                   | `e2e/fixtures/*.ts`, `e2e/helpers/mock-api.ts`          |

## Not In Scope (Pre-existing / Future)

- **`product_image` not in cart API:** The real cart serializer doesn't return `product_image`. The frontend displays it when available. This is a pre-existing gap — the product image could be fetched separately or the backend could add it later.
- **Pickup location `pickup_instructions`:** New translatable field. The frontend doesn't currently have a pickup location display — this can be added when the checkout flow is built.
- **Discount name translation:** The cart serializer returns `discount` with translated labels. The frontend already displays `item.discount.label` — this should work once connected to the real API.
