# Cart Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the cart drawer with four missing features: discount code redemption, promotion eligibility display, richer modifier display, and shipping/tax breakdown.

**Architecture:** All four features build on existing backend APIs that are already implemented but not consumed by the frontend. The cart currently shows a flat `cart_total`; we'll extend the `Cart` interface to include `subtotal`, `tax_total`, `shipping_cost`, `discount_amount`, and `promotion_discount_amount` fields that the backend already returns. Tasks 1-2 (modifiers, order summary) consume data the backend cart API already provides. Tasks 3-4 (discount codes, promotions) require **backend cart-level discount endpoints** that don't exist yet — the backend currently only supports discounts on the checkout object. This plan assumes the backend team will add `POST /api/v1/cart/{cart_id}/apply-discount/` as a thin proxy. See "Backend Dependencies" section for the fallback if they can't.

**Tech Stack:** Preact islands, Nanostores, Tailwind CSS, TypeScript, Vitest (unit), Playwright (E2E)

**Backend reference:** `/Users/williamhurst/SOUS/worktrees/storefront-v2-1nb/storefront_backend/storefront_backend/`

---

## Debate Review Summary

This plan was reviewed by Codex and Claude. The following critical and major issues were identified and resolved in this version:

| ID  | Severity | Issue                                                                        | Resolution                                                                                            |
| --- | -------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| C1  | Critical | Architecture header said "checkout bridge" but Task 3 assumed cart endpoints | Removed ambiguity; plan clearly states cart-level endpoints required, with concrete Option B fallback |
| C2  | Critical | Mock API read `body.modifiers` but `ProductDetail.tsx` sends `body.options`  | Fixed all mock API code to use `body.options`                                                         |
| C3  | Critical | Promotion eligibility `useEffect` had no cancellation — race condition       | Added `AbortController` + 300ms debounce pattern                                                      |
| M1  | Major    | `$eligiblePromotions` atom was not cart-scoped — stale banners               | Clear promotions when cart empties or changes ID                                                      |
| M2  | Major    | Discount input lacked accessible `<label>`                                   | Added `aria-label`                                                                                    |
| M3  | Major    | Error handling always showed "invalid code"                                  | Parse error `detail` field to show specific messages                                                  |
| M4  | Major    | No loading indicator during async cart operations                            | Added `$cartLoading` check with disabled state on footer                                              |
| M5  | Major    | "You save" + "Discount" + "Promotion" rows could confuse users               | "You save" only shows for product-level savings (not code/promo)                                      |
| M6  | Major    | Modifier rendering tests assigned to store test file                         | Removed; covered by E2E only                                                                          |
| M7  | Major    | E2E tests were comment placeholders                                          | Replaced with concrete selectors and assertions                                                       |
| M8  | Major    | Promo endpoint spammed on every cart change                                  | Debounced (300ms) with AbortController                                                                |
| M9  | Major    | Mock used `group?.title` but fixtures use `modifier_groups[].name`           | Fixed to `group?.name`                                                                                |
| M10 | Major    | Option B fallback was understated                                            | Expanded with checkout lifecycle details                                                              |
| M11 | Major    | Hard-coded 9% tax in mock                                                    | Added clarifying comment; acceptable for test mock                                                    |

---

## Feature Overview

| #   | Feature                                           | Scope  | Key Files                                                                        | Blocked?                |
| --- | ------------------------------------------------- | ------ | -------------------------------------------------------------------------------- | ----------------------- |
| 1   | Richer modifier display in cart                   | Small  | `CartDrawer.tsx`, `cart.ts`, i18n, mock-api, tests                               | No                      |
| 2   | Order summary breakdown (subtotal, tax, shipping) | Medium | `CartDrawer.tsx`, `cart.ts`, `CartBar.tsx`, i18n, mock-api, tests                | No                      |
| 3   | Discount code input                               | Medium | New `DiscountCodeInput.tsx`, `cart.ts`, `cart-actions.ts`, i18n, mock-api, tests | **Yes — needs backend** |
| 4   | Promotion eligibility display                     | Medium | New `PromoBanner.tsx`, `cart-actions.ts`, i18n, mock-api, tests                  | No (display only)       |

Tasks are ordered by dependency: modifiers are self-contained, then order summary (which the discount/promo features depend on for displaying updated totals), then discount codes, then promotions.

---

## Task 1: Richer Modifier Display in Cart Line Items

Currently, modifiers show only comma-joined names truncated to 1 line. We'll show group-name-prefixed names and individual prices when non-zero, with multi-line support.

**Files:**

- Modify: `src/components/interactive/CartDrawer.tsx:53-57`
- Modify: `src/stores/cart.ts:12-17` (extend `selected_options` type)
- Modify: `e2e/fixtures/cart.ts:13-18` (extend fixture type)
- Modify: `e2e/helpers/mock-api.ts:216-229` (return group names)
- Test: `e2e/cart.spec.ts` (E2E modifier display test)

### Step 1: Extend the CartLineItem selected_options type

Add `group_name` field to match backend's `option_group_title`:

```typescript
// src/stores/cart.ts — CartLineItem.selected_options
selected_options?: Array<{
  id: number | string;
  name: string;
  group_name?: string;
  price: string;
  quantity: number;
}>;
```

### Step 2: Extend CartFixture to match

```typescript
// e2e/fixtures/cart.ts — selected_options in CartFixture
selected_options: Array<{
  id: string;
  name: string;
  group_name?: string;
  price: string;
  quantity: number;
}>;
```

### Step 3: Update the mock API to return group_name

In `e2e/helpers/mock-api.ts`, update the `selectedOptions` mapping inside the "Cart: add item" handler to include `group_name`.

**Note:** `ProductDetail.tsx` sends `body.options` (not `body.modifiers`). The existing mock already reads `body.modifiers`; update it to read `body.options` to match the actual frontend request. Fixture modifier groups use `.name` (not `.title`).

```typescript
const selectedOptions = (body.options ?? []).map(
  (m: { option_id: string; option_group_id: string; quantity: number }) => {
    const detail = productDetails[product.id] as typeof shawarmaDetail | undefined;
    const group = detail?.modifier_groups?.find((g) => g.options.some((o) => o.id === m.option_id));
    const opt = group?.options.find((o) => o.id === m.option_id);
    return {
      id: m.option_id,
      name: opt?.name ?? m.option_id,
      group_name: group?.name,
      price: opt?.price ?? '0.00',
      quantity: m.quantity,
    };
  },
);
```

### Step 4: Update the cartWithMultipleItems fixture

Add `group_name` to the Shawarma Bowl's selected option:

```typescript
selected_options: [{ id: 'opt-regular', name: 'Regular', group_name: 'Size', price: '0.00', quantity: 1 }],
```

### Step 5: Add a cartWithModifiers fixture

```typescript
// e2e/fixtures/cart.ts
export function cartWithModifiers(): CartFixture {
  return {
    id: 'cart-test-001',
    line_items: [
      {
        id: 'li-1',
        product_id: 'prod-2',
        product_title: 'Shawarma Bowl',
        product_image: 'https://images.example.com/shawarma-bowl.jpg',
        quantity: 1,
        unit_price: '14.50',
        line_total: '16.50',
        selected_options: [
          { id: 'opt-regular', name: 'Regular', group_name: 'Size', price: '0.00', quantity: 1 },
          {
            id: 'opt-cheese',
            name: 'Extra Cheese',
            group_name: 'Extras',
            price: '2.00',
            quantity: 1,
          },
        ],
      },
    ],
    cart_total: '16.50',
    item_count: 1,
  };
}
```

### Step 6: Update CartLineItem in CartDrawer.tsx

Replace the modifier display (lines 53-57) with a richer rendering:

```tsx
{
  item.selected_options && item.selected_options.length > 0 && (
    <div class="mt-0.5 space-y-0.5">
      {item.selected_options.map((opt) => (
        <p key={String(opt.id)} class="text-xs text-muted-foreground">
          {opt.group_name ? `${opt.group_name}: ` : ''}
          {opt.name}
          {opt.quantity > 1 ? ` x${opt.quantity}` : ''}
          {parseFloat(opt.price) > 0 ? ` (+${formatPrice(opt.price, currency, locale)})` : ''}
        </p>
      ))}
    </div>
  );
}
```

### Step 7: Run existing tests to verify nothing breaks

```bash
pnpm test -- --run
```

### Step 8: Commit

```bash
git add src/stores/cart.ts src/components/interactive/CartDrawer.tsx e2e/fixtures/cart.ts e2e/helpers/mock-api.ts
git commit -m "feat(cart): show modifier group names and prices in cart line items"
```

---

## Task 2: Order Summary Breakdown (Subtotal, Tax, Shipping)

Currently the cart shows a single "Total" number. We'll add subtotal, tax, and shipping rows to the CartFooter. These fields already exist in the backend's checkout response.

**Files:**

- Modify: `src/stores/cart.ts:26-32` (extend `Cart` interface)
- Modify: `src/components/interactive/CartDrawer.tsx:81-114` (CartFooter)
- Modify: `src/components/interactive/CartBar.tsx` (show subtotal in bar)
- Modify: `src/i18n/messages/en.json`, `nl.json`, `de.json` (new keys)
- Modify: `e2e/fixtures/cart.ts` (add new fields to fixtures)
- Modify: `e2e/helpers/mock-api.ts` (return new fields in recalcCart)
- Test: `e2e/cart.spec.ts` (E2E order summary test)

### Step 1: Add i18n keys

Add to all three language files (`en.json`, `nl.json`, `de.json`):

```json
// en.json
"subtotal": "Subtotal",
"shipping": "Shipping",
"shippingFree": "Free",
"tax": "Tax",
"taxIncluded": "incl. tax",
"discount": "Discount",
"promotion": "Promotion",

// nl.json
"subtotal": "Subtotaal",
"shipping": "Verzendkosten",
"shippingFree": "Gratis",
"tax": "BTW",
"taxIncluded": "incl. BTW",
"discount": "Korting",
"promotion": "Actie",

// de.json
"subtotal": "Zwischensumme",
"shipping": "Versandkosten",
"shippingFree": "Kostenlos",
"tax": "MwSt.",
"taxIncluded": "inkl. MwSt.",
"discount": "Rabatt",
"promotion": "Aktion",
```

### Step 2: Extend the Cart interface

```typescript
// src/stores/cart.ts
export interface Cart {
  id: string;
  line_items: CartLineItem[];
  cart_total: string;
  cart_savings?: string;
  item_count: number;
  subtotal?: string;
  tax_total?: string;
  tax_included?: boolean;
  shipping_cost?: string;
  discount_amount?: string;
  promotion_discount_amount?: string;
  applied_discount?: {
    id: string;
    code: string;
    name: string;
    discount_amount: string;
  };
}
```

### Step 3: Update CartFixture

```typescript
// e2e/fixtures/cart.ts — add optional fields to CartFixture interface
subtotal?: string;
tax_total?: string;
tax_included?: boolean;
shipping_cost?: string;
discount_amount?: string;
promotion_discount_amount?: string;
applied_discount?: {
  id: string;
  code: string;
  name: string;
  discount_amount: string;
};
```

### Step 4: Update recalcCart in mock-api.ts

```typescript
function recalcCart(cart: CartFixture) {
  let subtotal = 0;
  let count = 0;
  for (const item of cart.line_items) {
    const modTotal = item.selected_options.reduce(
      (s, m) => s + parseFloat(m.price) * m.quantity,
      0,
    );
    const lineTotal = (parseFloat(item.unit_price) + modTotal) * item.quantity;
    item.line_total = lineTotal.toFixed(2);
    subtotal += lineTotal;
    count += item.quantity;
  }
  cart.subtotal = subtotal.toFixed(2);
  // Test approximation: 9% BTW tax-inclusive. Real backend uses per-product
  // vat_rate and may use Stripe Tax or Avalara. This is sufficient for E2E.
  const taxRate = 0.09;
  cart.tax_total = ((subtotal * taxRate) / (1 + taxRate)).toFixed(2);
  cart.tax_included = true;
  cart.shipping_cost = cart.shipping_cost ?? '0.00';
  const discount = parseFloat(cart.discount_amount ?? '0');
  const promoDiscount = parseFloat(cart.promotion_discount_amount ?? '0');
  cart.cart_total = (subtotal + parseFloat(cart.shipping_cost) - discount - promoDiscount).toFixed(
    2,
  );
  cart.item_count = count;
}
```

### Step 5: Update CartFooter in CartDrawer.tsx

Replace the CartFooter component. Key changes from original plan:

- Accept `cart` prop directly (replaces individual field extraction)
- "You save" row only shows when there are product-level savings AND no separate discount/promo rows (avoids confusion about overlapping discounts)
- Add `$cartLoading` check to disable checkout button during async operations

```tsx
import { useStore } from '@nanostores/preact';
import { $cartLoading } from '@/stores/cart';

interface CartFooterProps {
  cart: Cart;
  cartTotal: string;
  currency: string;
  locale: string;
  lang: string;
  style?: Record<string, string>;
}

function CartFooter({ cart, cartTotal, currency, locale, lang, style }: CartFooterProps) {
  const loading = useStore($cartLoading);
  const subtotal = cart.subtotal;
  const shipping = cart.shipping_cost;
  const taxTotal = cart.tax_total;
  const taxIncluded = cart.tax_included ?? true;
  const discountAmount = cart.discount_amount;
  const promoDiscount = cart.promotion_discount_amount;

  // "You save" only for product-level savings (not code/promo discounts)
  const hasCodeOrPromo =
    (discountAmount && parseFloat(discountAmount) > 0) ||
    (promoDiscount && parseFloat(promoDiscount) > 0);
  const savings =
    !hasCodeOrPromo && cart.cart_savings && parseFloat(cart.cart_savings) > 0
      ? cart.cart_savings
      : null;

  return (
    <div class="border-t border-border px-4 py-3" style={style}>
      {/* Subtotal */}
      {subtotal && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('subtotal', lang)}</span>
          <span class="text-card-foreground">{formatPrice(subtotal, currency, locale)}</span>
        </div>
      )}

      {/* Shipping */}
      {shipping && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('shipping', lang)}</span>
          <span class="text-card-foreground">
            {parseFloat(shipping) === 0
              ? t('shippingFree', lang)
              : formatPrice(shipping, currency, locale)}
          </span>
        </div>
      )}

      {/* Discount code savings */}
      {discountAmount && parseFloat(discountAmount) > 0 && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('discount', lang)}</span>
          <span class="font-medium text-destructive">
            -{formatPrice(discountAmount, currency, locale)}
          </span>
        </div>
      )}

      {/* Promotion savings */}
      {promoDiscount && parseFloat(promoDiscount) > 0 && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('promotion', lang)}</span>
          <span class="font-medium text-destructive">
            -{formatPrice(promoDiscount, currency, locale)}
          </span>
        </div>
      )}

      {/* You save (product-level only — hidden when code/promo discounts are active) */}
      {savings && (
        <div class="mb-1 flex items-center justify-between text-sm">
          <span class="text-muted-foreground">{t('youSave', lang)}</span>
          <span class="font-medium text-destructive">{formatPrice(savings, currency, locale)}</span>
        </div>
      )}

      {/* Tax */}
      {taxTotal && (
        <div class="mb-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{taxIncluded ? t('taxIncluded', lang) : t('tax', lang)}</span>
          <span>{formatPrice(taxTotal, currency, locale)}</span>
        </div>
      )}

      {/* Total */}
      <div class="mb-3 flex items-center justify-between border-t border-border pt-2">
        <span class="text-sm font-medium text-card-foreground">{t('orderTotal', lang)}</span>
        <span class="text-lg font-bold text-card-foreground">
          {formatPrice(cartTotal, currency, locale)}
        </span>
      </div>

      <a
        href={`/${lang}/checkout`}
        class={`flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 ${loading ? 'pointer-events-none opacity-50' : ''}`}
        aria-disabled={loading}
      >
        {t('nextCheckout', lang)}
      </a>
    </div>
  );
}
```

### Step 6: Update CartFooter call sites

Update both CartFooter call sites in CartDrawer to use the new props:

```tsx
<CartFooter cart={cart!} cartTotal={cartTotal} currency={currency} locale={locale} lang={lang} />
```

And the one with safe-area padding:

```tsx
<CartFooter
  cart={cart!}
  cartTotal={cartTotal}
  currency={currency}
  locale={locale}
  lang={lang}
  style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
/>
```

### Step 7: Run tests

```bash
pnpm test -- --run
pnpm check
```

### Step 8: Commit

```bash
git add src/stores/cart.ts src/components/interactive/CartDrawer.tsx src/i18n/messages/ e2e/fixtures/cart.ts e2e/helpers/mock-api.ts
git commit -m "feat(cart): add order summary breakdown with subtotal, tax, and shipping rows"
```

---

## Task 3: Discount Code Input

**BLOCKED: Requires backend to add cart-level discount endpoints.** See "Backend Dependencies" section.

Add a text input in the CartFooter where users can enter a promo code. The backend currently has `POST /api/v1/checkout/{id}/apply-discount/` and `DELETE /api/v1/checkout/{id}/remove-discount/` on the checkout object. This plan requires equivalent cart-level endpoints.

**Files:**

- Create: `src/components/interactive/DiscountCodeInput.tsx`
- Modify: `src/stores/cart-actions.ts` (add applyDiscount / removeDiscount)
- Modify: `src/components/interactive/CartDrawer.tsx` (render DiscountCodeInput in footer)
- Modify: `src/i18n/messages/en.json`, `nl.json`, `de.json`
- Modify: `e2e/helpers/mock-api.ts` (add discount endpoint)
- Test: `src/stores/cart-actions.test.ts` (unit tests for apply/remove)
- Test: `e2e/cart.spec.ts` (E2E discount code test)

### Step 1: Add i18n keys

```json
// en.json
"discountCode": "Discount code",
"discountCodePlaceholder": "Enter code",
"applyDiscount": "Apply",
"removeDiscount": "Remove",
"discountApplied": "Discount applied",
"discountInvalid": "Invalid discount code",
"discountExpired": "This discount code has expired",
"discountMinOrder": "Minimum order amount not met",

// nl.json
"discountCode": "Kortingscode",
"discountCodePlaceholder": "Voer code in",
"applyDiscount": "Toepassen",
"removeDiscount": "Verwijderen",
"discountApplied": "Korting toegepast",
"discountInvalid": "Ongeldige kortingscode",
"discountExpired": "Deze kortingscode is verlopen",
"discountMinOrder": "Minimaal bestelbedrag niet bereikt",

// de.json
"discountCode": "Rabattcode",
"discountCodePlaceholder": "Code eingeben",
"applyDiscount": "Einlösen",
"removeDiscount": "Entfernen",
"discountApplied": "Rabatt angewendet",
"discountInvalid": "Ungültiger Rabattcode",
"discountExpired": "Dieser Rabattcode ist abgelaufen",
"discountMinOrder": "Mindestbestellwert nicht erreicht",
```

### Step 2: Add cart actions for discount codes

The error detail from the backend's response is used to select the appropriate i18n error message, rather than always showing "invalid code":

```typescript
// src/stores/cart-actions.ts

/** Map backend error detail strings to i18n keys. */
const DISCOUNT_ERROR_MAP: Record<string, string> = {
  'Invalid discount code': 'discountInvalid',
  'Discount code expired': 'discountExpired',
  'Minimum order amount not met': 'discountMinOrder',
};

export async function applyDiscountCode(
  cartId: string,
  code: string,
  client?: StorefrontClient,
): Promise<Cart> {
  $cartLoading.set(true);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.POST(`/api/v1/cart/{cart_id}/apply-discount/`, {
      params: { path: { cart_id: cartId } },
      body: { code },
    });
    if (error || !data) {
      const detail = errorDetail(error);
      const err = new Error(detail);
      // Attach the raw detail for callers to map to i18n
      (err as Error & { apiDetail?: string }).apiDetail = detail;
      throw err;
    }
    $cart.set(data as Cart);
    return data as Cart;
  } finally {
    $cartLoading.set(false);
  }
}

export async function removeDiscountCode(cartId: string, client?: StorefrontClient): Promise<Cart> {
  $cartLoading.set(true);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.DELETE(`/api/v1/cart/{cart_id}/remove-discount/`, {
      params: { path: { cart_id: cartId } },
    });
    if (error || !data) {
      throw new Error(`Failed to remove discount: ${errorDetail(error)}`);
    }
    $cart.set(data as Cart);
    return data as Cart;
  } finally {
    $cartLoading.set(false);
  }
}
```

### Step 3: Create DiscountCodeInput component

Key changes from original plan:

- `aria-label` for accessibility (M2)
- Parse error `apiDetail` to show specific error messages (M3)
- `maxLength={50}` to limit input length (m1)

```tsx
// src/components/interactive/DiscountCodeInput.tsx
import { useState } from 'preact/hooks';
import { t } from '@/i18n';
import { applyDiscountCode, removeDiscountCode, DISCOUNT_ERROR_MAP } from '@/stores/cart-actions';
import { showToast } from '@/stores/toast';
import type { Cart } from '@/stores/cart';

interface Props {
  cart: Cart;
  lang: string;
}

export default function DiscountCodeInput({ cart, lang }: Props) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const appliedDiscount = cart.applied_discount;

  const handleApply = async () => {
    if (!code.trim()) return;
    setLoading(true);
    try {
      await applyDiscountCode(cart.id, code.trim());
      setCode('');
      showToast(t('discountApplied', lang), 'success');
    } catch (err) {
      const detail = (err as Error & { apiDetail?: string }).apiDetail ?? '';
      const i18nKey = DISCOUNT_ERROR_MAP[detail] ?? 'discountInvalid';
      showToast(t(i18nKey, lang));
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    setLoading(true);
    try {
      await removeDiscountCode(cart.id);
    } catch {
      showToast(t('toastCartUpdateFailed', lang));
    } finally {
      setLoading(false);
    }
  };

  if (appliedDiscount) {
    return (
      <div class="mb-2 flex items-center justify-between rounded-md bg-accent/50 px-3 py-2">
        <div>
          <span class="text-xs font-medium text-card-foreground">{appliedDiscount.code}</span>
          <span class="ml-2 text-xs text-muted-foreground">{appliedDiscount.name}</span>
        </div>
        <button
          type="button"
          onClick={handleRemove}
          disabled={loading}
          class="text-xs font-medium text-destructive hover:underline disabled:opacity-50"
        >
          {t('removeDiscount', lang)}
        </button>
      </div>
    );
  }

  return (
    <div class="mb-2 flex gap-2">
      <input
        type="text"
        value={code}
        onInput={(e) => setCode((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === 'Enter' && handleApply()}
        placeholder={t('discountCodePlaceholder', lang)}
        aria-label={t('discountCode', lang)}
        maxLength={50}
        class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-card-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        disabled={loading}
      />
      <button
        type="button"
        onClick={handleApply}
        disabled={loading || !code.trim()}
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {t('applyDiscount', lang)}
      </button>
    </div>
  );
}
```

### Step 4: Add DiscountCodeInput to CartFooter

Insert `<DiscountCodeInput cart={cart} lang={lang} />` at the top of the CartFooter, above the subtotal row.

### Step 5: Add mock API discount endpoints

In `e2e/helpers/mock-api.ts`, add these route handlers. Note the mock returns structured error details that the frontend maps to i18n keys:

```typescript
// ── Cart: apply discount code ──
const cartDiscountApplyMatch = path.match(/^\/api\/v1\/cart\/([^/]+)\/apply-discount\/$/);
if (method === 'POST' && cartDiscountApplyMatch) {
  const state = getCartState(req);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    json(res, { detail: 'Invalid request body' }, 400);
    return;
  }
  const code = (body.code as string)?.toUpperCase();

  // Known test codes
  const testDiscounts: Record<string, { id: string; name: string; type: string; value: number }> = {
    SAVE10: { id: 'disc-1', name: '10% Off', type: 'percentage', value: 10 },
    FLAT5: { id: 'disc-2', name: '€5 Off', type: 'fixed_amount', value: 5 },
    EXPIRED: { id: 'disc-3', name: 'Expired Code', type: 'percentage', value: 0 },
  };

  const discount = testDiscounts[code];
  if (!discount) {
    json(res, { detail: 'Invalid discount code' }, 400);
    return;
  }
  if (code === 'EXPIRED') {
    json(res, { detail: 'Discount code expired' }, 400);
    return;
  }

  const subtotal = parseFloat(state.cart.subtotal ?? state.cart.cart_total);
  const discountAmount =
    discount.type === 'percentage'
      ? (subtotal * discount.value) / 100
      : Math.min(discount.value, subtotal);

  state.cart.applied_discount = {
    id: discount.id,
    code,
    name: discount.name,
    discount_amount: discountAmount.toFixed(2),
  };
  state.cart.discount_amount = discountAmount.toFixed(2);
  recalcCart(state.cart);
  json(res, state.cart);
  return;
}

// ── Cart: remove discount code ──
const cartDiscountRemoveMatch = path.match(/^\/api\/v1\/cart\/([^/]+)\/remove-discount\/$/);
if (method === 'DELETE' && cartDiscountRemoveMatch) {
  const state = getCartState(req);
  delete state.cart.applied_discount;
  state.cart.discount_amount = '0.00';
  recalcCart(state.cart);
  json(res, state.cart);
  return;
}
```

### Step 6: Run tests

```bash
pnpm test -- --run
pnpm check
```

### Step 7: Commit

```bash
git add src/components/interactive/DiscountCodeInput.tsx src/stores/cart-actions.ts src/stores/cart.ts src/components/interactive/CartDrawer.tsx src/i18n/messages/ e2e/helpers/mock-api.ts
git commit -m "feat(cart): add discount code input with apply and remove"
```

---

## Task 4: Promotion Eligibility Display

Show a banner when the user's cart qualifies for a promotion (e.g., "Buy 2 Falafel Wraps, get 1 free!"). The backend has `POST /api/v1/promotions/eligible/` which checks cart contents against active promotions.

**Files:**

- Create: `src/components/interactive/PromoBanner.tsx`
- Modify: `src/stores/cart-actions.ts` (add checkPromotionEligibility)
- Modify: `src/stores/cart.ts` (add promotion-related atoms)
- Modify: `src/components/interactive/CartDrawer.tsx` (render PromoBanner above line items)
- Modify: `src/i18n/messages/en.json`, `nl.json`, `de.json`
- Modify: `e2e/helpers/mock-api.ts` (add eligible promotions endpoint)
- Test: `e2e/cart.spec.ts` (E2E promotion banner test)

### Step 1: Add i18n keys

```json
// en.json
"promoEligible": "Special offer available!",
"promoApply": "Apply deal",
"promoApplied": "Deal applied!",
"promoBogo": "Buy {buy} get {get} free",
"promoAlmostEligible": "Add {needed} more to qualify",

// nl.json
"promoEligible": "Speciale aanbieding beschikbaar!",
"promoApply": "Deal toepassen",
"promoApplied": "Deal toegepast!",
"promoBogo": "Koop {buy} krijg {get} gratis",
"promoAlmostEligible": "Voeg nog {needed} toe om in aanmerking te komen",

// de.json
"promoEligible": "Sonderangebot verfügbar!",
"promoApply": "Deal anwenden",
"promoApplied": "Deal angewendet!",
"promoBogo": "Kaufe {buy} erhalte {get} gratis",
"promoAlmostEligible": "Füge noch {needed} hinzu, um berechtigt zu sein",
```

### Step 2: Add promotion state atoms

```typescript
// src/stores/cart.ts — add after existing atoms

export interface EligiblePromotion {
  id: number;
  name: string;
  promotion_type: string;
  benefit_type: string;
  benefit_quantity: number;
  discount_amount: string;
  is_best_deal: boolean;
}

export const $eligiblePromotions = atom<EligiblePromotion[]>([]);
```

### Step 3: Add checkPromotionEligibility action

Accepts an `AbortSignal` for cancellation support:

```typescript
// src/stores/cart-actions.ts

import { $eligiblePromotions, type EligiblePromotion } from '@/stores/cart';

export async function checkPromotionEligibility(
  cart: Cart,
  client?: StorefrontClient,
  signal?: AbortSignal,
): Promise<EligiblePromotion[]> {
  const sdk = client ?? getClient();
  const cartItems = cart.line_items.map((item) => ({
    product_id: item.product_id,
    quantity: item.quantity,
    price: item.unit_price,
  }));

  const { data, error } = await sdk.POST('/api/v1/promotions/eligible/', {
    body: { cart_items: cartItems },
    signal,
  });

  // Don't update state if request was aborted
  if (signal?.aborted) return [];

  if (error || !data) {
    $eligiblePromotions.set([]);
    return [];
  }

  const promos = (data as { eligible_promotions: EligiblePromotion[] }).eligible_promotions;
  $eligiblePromotions.set(promos);
  return promos;
}
```

### Step 4: Create PromoBanner component

```tsx
// src/components/interactive/PromoBanner.tsx
import { t } from '@/i18n';
import type { EligiblePromotion } from '@/stores/cart';

interface Props {
  promotions: EligiblePromotion[];
  lang: string;
}

export default function PromoBanner({ promotions, lang }: Props) {
  if (promotions.length === 0) return null;

  const best = promotions.find((p) => p.is_best_deal) ?? promotions[0];

  return (
    <div class="mx-4 mb-2 rounded-md bg-accent/50 px-3 py-2" role="status">
      <p class="text-xs font-medium text-card-foreground">{t('promoEligible', lang)}</p>
      <p class="text-xs text-muted-foreground">{best.name}</p>
    </div>
  );
}
```

### Step 5: Add PromoBanner to CartDrawer

Import `PromoBanner` and `$eligiblePromotions`. Render it above the line items list in both inline and drawer modes:

```tsx
const eligiblePromotions = useStore($eligiblePromotions);

// Inside the body, before the <ul> of line items:
{
  lineItems.length > 0 && <PromoBanner promotions={eligiblePromotions} lang={lang} />;
}
```

### Step 6: Trigger eligibility check when cart changes (debounced + cancellable)

In `CartDrawer.tsx`, add an effect that fires `checkPromotionEligibility` when the cart changes. Uses 300ms debounce and `AbortController` to prevent race conditions and API spam:

```tsx
import { useEffect } from 'preact/hooks';
import { checkPromotionEligibility } from '@/stores/cart-actions';
import { $eligiblePromotions } from '@/stores/cart';

// Inside CartDrawer component:
useEffect(() => {
  // Clear stale promotions when cart is empty
  if (!cart || cart.line_items.length === 0) {
    $eligiblePromotions.set([]);
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    checkPromotionEligibility(cart, undefined, controller.signal).catch(() => {});
  }, 300);

  return () => {
    clearTimeout(timeout);
    controller.abort();
  };
}, [cart?.line_items.length, cart?.cart_total]);
```

### Step 7: Add mock API eligible promotions endpoint

```typescript
// e2e/helpers/mock-api.ts

// ── Promotions: eligible ──
if (method === 'POST' && path === '/api/v1/promotions/eligible/') {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    json(res, { detail: 'Invalid request body' }, 400);
    return;
  }
  const cartItems =
    (body.cart_items as Array<{ product_id: string; quantity: number; price: string }>) ?? [];
  const eligible: unknown[] = [];

  // Test promotion: Buy 2 Falafel Wraps get 1 free
  const falafelItem = cartItems.find((i) => i.product_id === 'prod-1');
  if (falafelItem && falafelItem.quantity >= 2) {
    eligible.push({
      id: 1,
      name: 'Buy 2 Falafel Wraps, get 1 free!',
      promotion_type: 'bogo',
      benefit_type: 'free',
      benefit_product_ids: ['prod-1'],
      benefit_quantity: 1,
      discount_amount: falafelItem.price,
      is_best_deal: true,
    });
  }

  json(res, {
    eligible_promotions: eligible,
    best_promotion_id: eligible.length > 0 ? 1 : null,
  });
  return;
}
```

### Step 8: Run tests

```bash
pnpm test -- --run
pnpm check
```

### Step 9: Commit

```bash
git add src/components/interactive/PromoBanner.tsx src/stores/cart.ts src/stores/cart-actions.ts src/components/interactive/CartDrawer.tsx src/i18n/messages/ e2e/helpers/mock-api.ts
git commit -m "feat(cart): show promotion eligibility banner in cart drawer"
```

---

## Task 5: E2E Tests for All Features

Write comprehensive E2E tests with concrete selectors and assertions.

**Files:**

- Modify: `e2e/cart.spec.ts`

### Step 1: Add test for modifier display

```typescript
test.describe('Cart — modifier display', () => {
  test('shows modifier group names and prices in cart', async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await page.goto(menuPage());
    await waitForHydration(page);

    // Add Shawarma Bowl with modifiers via product detail
    await openProductDetailModal(page, shawarma.id);
    // Select "Large" size (+€3.00)
    await page.getByRole('radio', { name: 'Large' }).click();
    await page.getByRole('button', { name: /add to order|toevoegen/i }).click();
    await openCartDrawer(page);

    // Assert modifier group name and price visible
    const cartItem = page.locator('[data-product-id="prod-2"]').first();
    await expect(cartItem.locator('text=Size: Large')).toBeVisible();
    await expect(cartItem.locator('text=+€')).toBeVisible();
  });
});
```

### Step 2: Add test for order summary breakdown

```typescript
test.describe('Cart — order summary', () => {
  test('shows subtotal and tax rows', async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);
    await openCartDrawer(page);

    // Assert subtotal row
    await expect(page.locator('text=Subtotaal')).toBeVisible();
    // Assert tax row (Dutch: "incl. BTW")
    await expect(page.locator('text=incl. BTW')).toBeVisible();
    // Assert total row
    await expect(page.locator('text=Totaal')).toBeVisible();
  });
});
```

### Step 3: Add test for discount code

```typescript
test.describe('Cart — discount codes', () => {
  test('applies and removes a discount code', async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);
    await openCartDrawer(page);

    // Enter discount code and apply
    const discountInput = page.getByRole('textbox', { name: /kortingscode/i });
    await discountInput.fill('SAVE10');
    await page.getByRole('button', { name: /toepassen/i }).click();

    // Assert: discount badge visible with code
    await expect(page.locator('text=SAVE10')).toBeVisible();
    // Assert: discount row visible in summary
    await expect(page.locator('text=Korting')).toBeVisible();

    // Remove discount
    await page.getByRole('button', { name: /verwijderen/i }).click();

    // Assert: discount input visible again
    await expect(discountInput).toBeVisible();
  });

  test('shows error for invalid discount code', async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);
    await openCartDrawer(page);

    const discountInput = page.getByRole('textbox', { name: /kortingscode/i });
    await discountInput.fill('INVALID');
    await page.getByRole('button', { name: /toepassen/i }).click();

    // Assert: error toast visible
    await expect(page.locator('[role="alert"]').first()).toBeVisible();
  });

  test('shows specific error for expired code', async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);
    await openCartDrawer(page);

    const discountInput = page.getByRole('textbox', { name: /kortingscode/i });
    await discountInput.fill('EXPIRED');
    await page.getByRole('button', { name: /toepassen/i }).click();

    // Assert: expired-specific error toast
    await expect(page.locator('[role="alert"]').filter({ hasText: /verlopen/i })).toBeVisible();
  });
});
```

### Step 4: Add test for promotion banner

```typescript
test.describe('Cart — promotion banner', () => {
  test('shows promotion banner when eligible', async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await page.goto(menuPage());
    await waitForHydration(page);

    // Add 2 Falafel Wraps to trigger BOGO promo
    await addSimpleProductToCart(page, falafel.id);
    await addSimpleProductToCart(page, falafel.id);
    await openCartDrawer(page);

    // Assert: promotion banner visible
    await expect(page.locator('[role="status"]').filter({ hasText: /falafel/i })).toBeVisible();
  });

  test('hides promotion banner when cart is emptied', async ({ page }) => {
    await resetMockApi(page);
    await blockAnalytics(page);
    await page.goto(menuPage());
    await waitForHydration(page);

    await addSimpleProductToCart(page, falafel.id);
    await addSimpleProductToCart(page, falafel.id);
    await openCartDrawer(page);

    // Banner should be visible
    await expect(page.locator('[role="status"]').filter({ hasText: /falafel/i })).toBeVisible();

    // Remove both items
    const removeButtons = page.getByRole('button', { name: /verwijderen|remove/i });
    await removeButtons.first().click();
    await removeButtons.first().click();

    // Banner should be gone
    await expect(page.locator('[role="status"]').filter({ hasText: /falafel/i })).not.toBeVisible();
  });
});
```

### Step 5: Run E2E tests

```bash
pnpm test:e2e
```

### Step 6: Commit

```bash
git add e2e/cart.spec.ts
git commit -m "test(e2e): add tests for modifiers, order summary, discounts, and promotions"
```

---

## Task 6: Bundle Size Check

The project has a 65 KB gzipped budget. The new `DiscountCodeInput` and `PromoBanner` islands are small (~1-2 KB each), but we need to verify.

### Step 1: Run size check

```bash
pnpm size:check
```

### Step 2: If over budget, split into separate chunks

`DiscountCodeInput` and `PromoBanner` are rendered inside `CartDrawer` (not as separate islands), so they're already part of the CartDrawer chunk. If the CartDrawer chunk is too large:

1. Extract them as lazy-loaded imports within CartDrawer using dynamic `import()`:

```tsx
// Inside CartDrawer, lazy-load DiscountCodeInput
const [DiscountCodeInput, setDiscountCodeInput] = useState<ComponentType<Props> | null>(null);
useEffect(() => {
  import('./DiscountCodeInput').then((m) => setDiscountCodeInput(() => m.default));
}, []);
```

2. This splits them into a separate chunk that loads only when CartDrawer renders.

### Step 3: Commit if changes needed

```bash
git add src/components/interactive/CartDrawer.tsx
git commit -m "perf(cart): lazy-load discount and promo components to stay within bundle budget"
```

---

## Backend Dependencies

### Required: Cart-level discount endpoints

This plan requires the backend to add:

```
POST   /api/v1/cart/{cart_id}/apply-discount/     → body: { code: string }
DELETE /api/v1/cart/{cart_id}/remove-discount/
```

These should be thin wrappers around the existing checkout discount logic (`promotions/services.py`). The cart response should include the `applied_discount` object and updated `discount_amount` / `cart_total`.

### Fallback: Option B — Checkout-based discounts

If the backend cannot add cart-level endpoints, the frontend must:

1. **Create a checkout from the cart** before applying discounts. This requires:
   - A new `$checkout` atom in `src/stores/cart.ts` to hold the checkout ID
   - A `createCheckout(cartId)` action calling `POST /api/v1/checkout/` (body: `{ cart_id: cartId }`)
   - Checkout ID persistence in `sessionStorage` (not `localStorage` — checkouts are session-scoped)

2. **Apply discounts against the checkout ID:**
   - `POST /api/v1/checkout/{checkout_id}/apply-discount/`
   - `DELETE /api/v1/checkout/{checkout_id}/remove-discount/`

3. **Reconcile checkout totals back to the cart UI.** The checkout response includes `subtotal`, `tax_total`, `shipping_cost`, `discount_amount`, and `total` — but these live on the checkout object, not the cart. The `CartFooter` would need to read from `$checkout` instead of (or in addition to) `$cart`.

4. **Handle checkout lifecycle:** Checkouts can expire. If the checkout is stale, the frontend must recreate it before applying discounts. This adds retry logic and error recovery that Option A avoids.

**This is materially more complex than Option A** — it's not just a path swap. Estimated additional effort: ~2 days.

### Already available (no backend changes needed)

- Cart API already returns `subtotal`, `tax_total`, `shipping_cost` fields (Tasks 1-2)
- `POST /api/v1/promotions/eligible/` already exists (Task 4)
- Product modifier groups with `name` field already in cart line item responses (Task 1)
