# Checkout Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a single-page, mobile-first checkout flow with Stripe payments, pickup/delivery fulfillment, and scheduled time slots.

**Architecture:** Single Preact island (`CheckoutPage`, `client:load`) containing all form sections. `$checkout` nanostore for server state, local `useReducer` for form fields. PATCH queue with AbortController prevents race conditions. Stripe Payment Element mounted after delivery section complete. Express checkout (Apple Pay/Google Pay) at top of page. Webhook-first order completion with frontend fast-path.

**Tech Stack:** Astro 5 + Preact + Nanostores + Stripe.js + Tailwind CSS + TypeScript. Vitest (unit), Playwright (E2E).

**Design doc:** `docs/plans/2026-03-17-checkout-flow-design.md`

---

## Phase 1: Foundation (Types, Stores, Utilities)

### Task 1: Shared ID Validation Utility

**Files:**
- Create: `src/lib/validate-id.ts`
- Create: `src/lib/validate-id.test.ts`
- Modify: `src/stores/cart.ts:140-156` (extract CART_ID_PATTERN)

**Step 1: Write the failing test**

```typescript
// src/lib/validate-id.test.ts
import { describe, it, expect } from 'vitest';
import { validateStorageId } from './validate-id';

describe('validateStorageId', () => {
  it('accepts valid UUID', () => {
    expect(validateStorageId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts alphanumeric with hyphens and underscores', () => {
    expect(validateStorageId('cart_123-abc')).toBe(true);
  });

  it('rejects path traversal attempts', () => {
    expect(validateStorageId('../../../etc/passwd')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validateStorageId('')).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(validateStorageId(null as unknown as string)).toBe(false);
    expect(validateStorageId(undefined as unknown as string)).toBe(false);
  });

  it('rejects strings with special characters', () => {
    expect(validateStorageId('id;DROP TABLE')).toBe(false);
    expect(validateStorageId('id<script>')).toBe(false);
  });
});
```

**Step 2:** Run `pnpm test src/lib/validate-id.test.ts` — expect FAIL (module not found).

**Step 3: Implement**

```typescript
// src/lib/validate-id.ts
const STORAGE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function validateStorageId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && STORAGE_ID_PATTERN.test(id);
}
```

**Step 4:** Run `pnpm test src/lib/validate-id.test.ts` — expect PASS.

**Step 5: Refactor cart.ts to use shared utility**

In `src/stores/cart.ts`, replace the local `CART_ID_PATTERN` (line 140) and its inline usage in `getStoredCartId()` (line 146) with the shared `validateStorageId`:

```typescript
// In getStoredCartId(), replace:
//   if (id && !CART_ID_PATTERN.test(id)) {
// With:
import { validateStorageId } from '@/lib/validate-id';
// ...
if (id && !validateStorageId(id)) {
```

Remove the local `const CART_ID_PATTERN` line.

**Step 6:** Run `pnpm test` — expect all existing tests still PASS.

**Step 7:** Commit: `feat(checkout): extract shared ID validation utility`

---

### Task 2: Checkout TypeScript Types

**Files:**
- Create: `src/types/checkout.ts`

**Step 1: Create the type file**

```typescript
// src/types/checkout.ts

export type FulfillmentType = 'local_delivery' | 'pickup' | 'nationwide_delivery';

export type CheckoutStatus = 'created' | 'delivery_set' | 'shipping_pending' | 'paid' | 'completed';

export interface CheckoutAddress {
  first_name: string;
  last_name: string;
  street_address_1: string;
  street_address_2?: string;
  city: string;
  postal_code: string;
  country_code: string;
  phone_number?: string;
}

export interface CheckoutLineItem {
  product_id: number | string;
  variant_id: string;
  product_title: string;
  title: string;
  quantity: number;
  unit_price: string;
  total_price: string;
  line_total: string;
  tax_rate: string;
  tax_amount: string;
  fulfillment_type: FulfillmentType | string;
  fulfillment_date: string | null;
  options: Array<{ name: string; value: string; surcharges?: unknown[] }>;
  product_type: string;
  surcharges: unknown[];
  gift_card_details?: unknown;
}

export interface Checkout {
  id: string;
  cart_id: string;
  merchant_id: number;
  channel_id: number | null;
  status: CheckoutStatus;
  currency: string;
  display_currency: string;
  fx_rate_to_display: string;
  email: string | null;
  shipping_address: CheckoutAddress | null;
  billing_address: CheckoutAddress | null;
  shipping_method: { id: string } | null;
  payment_method: string | null;
  payment_status: string | null;
  line_items: CheckoutLineItem[];
  subtotal: string;
  tax_total: string;
  shipping_cost: string;
  surcharge_total: string;
  display_surcharge_total: string;
  discount_amount: string;
  discount_code: string | null;
  applied_promotion_id: number | null;
  promotion_discount_amount: string;
  total: string;
  display_subtotal: string;
  display_tax_total: string;
  display_shipping_cost: string;
  display_discount_amount: string;
  display_promotion_discount_amount: string;
  display_total: string;
  fulfillment_slot_id: string | null;
  gift_card_details: unknown | null;
  order_number: string | null;
  purpose: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface PaymentResult extends Checkout {
  client_secret?: string;
  redirect_url?: string;
  payment_intent_id?: string;
}

export interface ShippingRate {
  id: string;
  name: string;
  cost: string;
  original_cost: string;
  rate_id: string;
  expires_at: string | null;
}

export interface ShippingGroup {
  id: string;
  shipping_cost: string;
  selected_rate_id: string | null;
  is_digital: boolean;
  available_rates: ShippingRate[];
  line_items: Array<{ product_id: number | string; title: string; quantity: number }>;
}

export interface TimeSlot {
  id: string;
  start_time: string;
  end_time: string;
  capacity: number;
  reserved_count: number;
  available: boolean;
  remaining_capacity: number;
}

export interface TimeSlotsResponse {
  location_id: number;
  date: string;
  time_slots: TimeSlot[];
}

export interface CheckoutFormState {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  street: string;
  city: string;
  postalCode: string;
  countryCode: string;
  fulfillmentMethod: 'delivery' | 'pickup';
  pickupLocationId: number | null;
  schedulingMode: 'asap' | 'scheduled';
  scheduledDate: string | null;
  selectedSlotId: string | null;
  selectedShippingRateId: string | null;
}
```

**Step 2:** Run `pnpm check` — expect PASS (types compile).

**Step 3:** Commit: `feat(checkout): add checkout TypeScript types`

---

### Task 3: Checkout Store + Derived Atoms

**Files:**
- Create: `src/stores/checkout.ts`
- Create: `src/stores/checkout.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/stores/checkout.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { $checkout, $checkoutTotals, $checkoutStatus, getStoredCheckoutId, setStoredCheckoutId, clearStoredCheckoutId } from './checkout';
import type { Checkout } from '@/types/checkout';

const mockCheckout: Checkout = {
  id: 'chk-123',
  cart_id: 'cart-456',
  merchant_id: 1,
  channel_id: null,
  status: 'delivery_set',
  currency: 'EUR',
  display_currency: 'EUR',
  fx_rate_to_display: '1.000000',
  email: 'test@example.com',
  shipping_address: null,
  billing_address: null,
  shipping_method: null,
  payment_method: null,
  payment_status: null,
  line_items: [],
  subtotal: '24.50',
  tax_total: '3.68',
  shipping_cost: '5.00',
  surcharge_total: '0.00',
  display_surcharge_total: '0.00',
  discount_amount: '0.00',
  discount_code: null,
  applied_promotion_id: null,
  promotion_discount_amount: '0.00',
  total: '33.18',
  display_subtotal: '24.50',
  display_tax_total: '3.68',
  display_shipping_cost: '5.00',
  display_discount_amount: '0.00',
  display_promotion_discount_amount: '0.00',
  display_total: '33.18',
  fulfillment_slot_id: null,
  gift_card_details: null,
  order_number: null,
  purpose: 'order',
  created_at: null,
  updated_at: null,
};

describe('checkout store', () => {
  beforeEach(() => {
    $checkout.set(null);
    sessionStorage.clear();
  });

  describe('$checkoutTotals', () => {
    it('returns zeros when checkout is null', () => {
      expect($checkoutTotals.get()).toEqual({
        subtotal: '0.00',
        shipping: '0.00',
        tax: '0.00',
        discount: '0.00',
        total: '0.00',
      });
    });

    it('derives display totals from checkout', () => {
      $checkout.set(mockCheckout);
      expect($checkoutTotals.get()).toEqual({
        subtotal: '24.50',
        shipping: '5.00',
        tax: '3.68',
        discount: '0.00',
        total: '33.18',
      });
    });
  });

  describe('$checkoutStatus', () => {
    it('returns null when checkout is null', () => {
      expect($checkoutStatus.get()).toBeNull();
    });

    it('returns status from checkout', () => {
      $checkout.set(mockCheckout);
      expect($checkoutStatus.get()).toBe('delivery_set');
    });
  });

  describe('checkout ID persistence', () => {
    it('stores and retrieves checkout ID', () => {
      setStoredCheckoutId('chk-123');
      expect(getStoredCheckoutId()).toBe('chk-123');
    });

    it('clears checkout ID', () => {
      setStoredCheckoutId('chk-123');
      clearStoredCheckoutId();
      expect(getStoredCheckoutId()).toBeNull();
    });

    it('rejects invalid checkout IDs', () => {
      sessionStorage.setItem('sous_checkout_id', '../hack');
      expect(getStoredCheckoutId()).toBeNull();
    });

    it('handles sessionStorage errors gracefully', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(getStoredCheckoutId()).toBeNull();
      spy.mockRestore();
    });
  });
});
```

**Step 2:** Run `pnpm test src/stores/checkout.test.ts` — expect FAIL.

**Step 3: Implement the store**

```typescript
// src/stores/checkout.ts
import { atom, computed } from 'nanostores';
import { validateStorageId } from '@/lib/validate-id';
import type { Checkout, CheckoutStatus } from '@/types/checkout';

const CHECKOUT_ID_KEY = 'sous_checkout_id';

// --- Atoms ---
export const $checkout = atom<Checkout | null>(null);
export const $checkoutLoading = atom<boolean>(false);
export const $checkoutError = atom<string | null>(null);

// --- Derived ---
export const $checkoutTotals = computed($checkout, (c) => ({
  subtotal: c?.display_subtotal ?? '0.00',
  shipping: c?.display_shipping_cost ?? '0.00',
  tax: c?.display_tax_total ?? '0.00',
  discount: c?.display_discount_amount ?? '0.00',
  total: c?.display_total ?? '0.00',
}));

export const $checkoutStatus = computed($checkout, (c): CheckoutStatus | null => c?.status ?? null);

// --- Checkout ID persistence (sessionStorage) ---
let fallbackCheckoutId: string | null = null;

export function getStoredCheckoutId(): string | null {
  try {
    const id = sessionStorage.getItem(CHECKOUT_ID_KEY);
    if (id && validateStorageId(id)) return id;
    if (id) sessionStorage.removeItem(CHECKOUT_ID_KEY);
    return fallbackCheckoutId;
  } catch {
    return fallbackCheckoutId;
  }
}

export function setStoredCheckoutId(id: string): void {
  fallbackCheckoutId = id;
  try {
    sessionStorage.setItem(CHECKOUT_ID_KEY, id);
  } catch {
    // Private browsing fallback — in-memory only
  }
}

export function clearStoredCheckoutId(): void {
  fallbackCheckoutId = null;
  try {
    sessionStorage.removeItem(CHECKOUT_ID_KEY);
  } catch {
    // Ignore
  }
}

// --- Form state persistence (sessionStorage, on blur) ---
const FORM_STATE_KEY = 'sous_checkout_form';

export function persistFormState(state: unknown): void {
  try {
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify(state));
  } catch {
    // Ignore
  }
}

export function restoreFormState<T>(): T | null {
  try {
    const raw = sessionStorage.getItem(FORM_STATE_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function clearFormState(): void {
  try {
    sessionStorage.removeItem(FORM_STATE_KEY);
  } catch {
    // Ignore
  }
}

// --- Fingerprint for cart-checkout comparison ---
// String() coercion handles product_id being number | string in both types
export function checkoutFingerprint(checkout: Checkout): string {
  return checkout.line_items
    .map((li) => `${String(li.product_id)}:${li.quantity}`)
    .sort()
    .join(',');
}

export function cartFingerprint(cart: { line_items: Array<{ product_id: number | string; quantity: number }> }): string {
  return cart.line_items
    .map((li) => `${String(li.product_id)}:${li.quantity}`)
    .sort()
    .join(',');
}
```

**Step 4:** Run `pnpm test src/stores/checkout.test.ts` — expect PASS.

**Step 5:** Commit: `feat(checkout): add checkout store with derived atoms and persistence`

---

### Task 4: Checkout Actions (PATCH Queue, Create, Complete)

**Files:**
- Create: `src/stores/checkout-actions.ts`
- Create: `src/stores/checkout-actions.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/stores/checkout-actions.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { $checkout } from './checkout';
import { createCheckout, patchDelivery } from './checkout-actions';

// Mock SDK client — follows makeClient pattern from cart-actions.test.ts
// Note: uses `as any` for now since checkout endpoints aren't in the SDK types yet.
// When the SDK adds checkout types, replace with proper StorefrontClient typing.
function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    GET: vi.fn().mockResolvedValue({ data: overrides.GET ?? null, error: null }),
    POST: vi.fn().mockResolvedValue({ data: overrides.POST ?? null, error: null }),
    PATCH: vi.fn().mockResolvedValue({ data: overrides.PATCH ?? null, error: null }),
    DELETE: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

describe('checkout-actions', () => {
  beforeEach(() => {
    $checkout.set(null);
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('createCheckout', () => {
    it('creates checkout and stores ID', async () => {
      const mockCheckout = { id: 'chk-new', cart_id: 'cart-1', status: 'created', line_items: [], total: '10.00', display_total: '10.00', display_subtotal: '10.00', display_tax_total: '0.00', display_shipping_cost: '0.00', display_discount_amount: '0.00' };
      const client = makeClient({ POST: mockCheckout });

      await createCheckout('cart-1', client as any);

      expect(client.POST).toHaveBeenCalledWith('/api/v1/checkout/', expect.objectContaining({
        body: { cart_id: 'cart-1' },
      }));
      expect($checkout.get()?.id).toBe('chk-new');
      expect(sessionStorage.getItem('sous_checkout_id')).toBe('chk-new');
    });
  });

  describe('patchDelivery', () => {
    it('debounces rapid calls', async () => {
      const mockResponse = { id: 'chk-1', status: 'delivery_set', total: '20.00', display_total: '20.00' };
      const client = makeClient({ PATCH: mockResponse });

      patchDelivery('chk-1', { email: 'a@b.com' }, client as any);
      patchDelivery('chk-1', { email: 'final@b.com' }, client as any);

      // Advance past debounce
      await vi.advanceTimersByTimeAsync(600);

      // Only one PATCH should have fired (the latest)
      expect(client.PATCH).toHaveBeenCalledTimes(1);
      expect(client.PATCH).toHaveBeenCalledWith(
        '/api/v1/checkout/chk-1/delivery/',
        expect.objectContaining({ body: { email: 'final@b.com' } }),
      );
    });
  });
});
```

**Step 2:** Run `pnpm test src/stores/checkout-actions.test.ts` — expect FAIL.

**Step 3: Implement checkout actions**

```typescript
// src/stores/checkout-actions.ts
import { $checkout, $checkoutLoading, $checkoutError, setStoredCheckoutId, clearStoredCheckoutId, clearFormState } from './checkout';
import { getClient } from '@/lib/api';
import type { Checkout, PaymentResult } from '@/types/checkout';

type SdkClient = ReturnType<typeof getClient>;

// --- PATCH Queue ---
let patchController: AbortController | null = null;
let patchGeneration = 0;
let patchTimer: ReturnType<typeof setTimeout> | null = null;

export function patchDelivery(
  checkoutId: string,
  data: Record<string, unknown>,
  client?: SdkClient,
): void {
  if (patchTimer) clearTimeout(patchTimer);
  patchController?.abort();

  const generation = ++patchGeneration;

  patchTimer = setTimeout(async () => {
    patchController = new AbortController();
    const sdk = client ?? getClient();

    try {
      $checkoutLoading.set(true);
      const { data: result, error } = await sdk.PATCH(
        `/api/v1/checkout/${checkoutId}/delivery/` as any,
        { body: data, signal: patchController.signal } as any,
      );

      if (generation === patchGeneration && result) {
        $checkout.set(result as Checkout);
        $checkoutError.set(null);
      }
      if (error) {
        $checkoutError.set((error as any).message ?? 'Delivery update failed');
      }
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') {
        $checkoutError.set('Connection lost. Please try again.');
      }
    } finally {
      if (generation === patchGeneration) {
        $checkoutLoading.set(false);
      }
    }
  }, 500);
}

// --- Create checkout ---
export async function createCheckout(
  cartId: string,
  client?: SdkClient,
): Promise<Checkout | null> {
  const sdk = client ?? getClient();
  $checkoutLoading.set(true);
  $checkoutError.set(null);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const { data, error } = await sdk.POST('/api/v1/checkout/' as any, {
      body: { cart_id: cartId },
      signal: controller.signal,
    } as any);

    if (error) {
      $checkoutError.set('Failed to create checkout');
      return null;
    }

    const checkout = data as Checkout;
    $checkout.set(checkout);
    setStoredCheckoutId(checkout.id);
    return checkout;
  } catch {
    $checkoutError.set('Checkout is taking longer than expected');
    return null;
  } finally {
    clearTimeout(timeout);
    $checkoutLoading.set(false);
  }
}

// --- Fetch checkout ---
export async function fetchCheckout(
  checkoutId: string,
  client?: SdkClient,
): Promise<Checkout | null> {
  const sdk = client ?? getClient();

  const { data, error } = await sdk.GET(
    `/api/v1/checkout/${checkoutId}/` as any,
  );

  if (error) return null;
  const checkout = data as Checkout;
  $checkout.set(checkout);
  return checkout;
}

// --- Initiate payment ---
export async function initiatePayment(
  checkoutId: string,
  client?: SdkClient,
): Promise<PaymentResult | null> {
  const sdk = client ?? getClient();

  const { data, error } = await sdk.POST(
    `/api/v1/checkout/${checkoutId}/payment/` as any,
    { body: { gateway_id: 'stripe' } } as any,
  );

  if (error) {
    $checkoutError.set('Payment initiation failed');
    return null;
  }

  return data as PaymentResult;
}

// --- Ensure payment and complete (shared by inline + bank redirect flows) ---
// Requires a Stripe instance — passed as parameter to avoid coupling to Stripe.js at module level
// Note: `as any` casts on SDK paths are temporary until @poweredbysous/storefront-sdk adds checkout types
export async function ensurePaymentAndComplete(
  checkoutId: string,
  clientSecret: string,
  stripe: { retrievePaymentIntent: (cs: string) => Promise<{ paymentIntent: { status: string } }> },
  lang: string,
  client?: SdkClient,
): Promise<void> {
  // Check if already completed (by webhook or prior attempt)
  const checkout = await fetchCheckout(checkoutId, client);
  if (checkout?.status === 'completed') {
    window.location.href = `/${lang}/checkout/success?order=${checkout.order_number}`;
    return;
  }

  // Verify payment status before calling /complete/
  const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);

  switch (paymentIntent.status) {
    case 'succeeded': {
      const result = await completeCheckout(checkoutId, client);
      if (result) {
        window.location.href = `/${lang}/checkout/success?order=${result.order_number}`;
      }
      break;
    }
    case 'processing':
      $checkoutError.set('paymentProcessing');
      break;
    case 'requires_action':
      $checkoutError.set('paymentRequiresAction');
      break;
    default:
      $checkoutError.set('paymentDeclined');
  }
}

// --- Complete checkout ---
export async function completeCheckout(
  checkoutId: string,
  client?: SdkClient,
): Promise<{ order_number: string } | null> {
  const sdk = client ?? getClient();

  const { data, error } = await sdk.POST(
    `/api/v1/checkout/${checkoutId}/complete/` as any,
  );

  if (error) return null;

  const result = data as Checkout;
  $checkout.set(result);
  clearStoredCheckoutId();
  clearFormState();
  return { order_number: result.order_number ?? '' };
}
```

**Step 4:** Run `pnpm test src/stores/checkout-actions.test.ts` — expect PASS.

**Step 5:** Commit: `feat(checkout): add checkout actions with PATCH queue and payment flow`

---

### Task 5: Add i18n Translation Keys

**Files:**
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/nl.json`
- Modify: `src/i18n/messages/de.json`

**Step 1:** Add all checkout keys from the design doc Section 10 to each language file.

**Important:** The design doc uses `{{count}}` (double braces) for interpolated keys, but the codebase's `t()` function uses `{count}` (single braces). Convert all interpolated keys:
- `"errorSummary_one": "There is {count} error"` (not `{{count}}`)
- `"errorSummary_other": "There are {count} errors"`
- `"itemCount_one": "{count} item"`
- `"itemCount_other": "{count} items"`

For `nl.json` and `de.json`, use the English text as placeholder values with a `[TODO: translate]` suffix — these will be translated before launch.

**Step 2:** Run `pnpm check` — expect PASS.

**Step 3:** Commit: `feat(checkout): add i18n translation keys for checkout flow`

---

## Phase 2: Page Shell & Layout

### Task 6: Checkout Astro Page

**Files:**
- Create: `src/pages/[lang]/checkout.astro`

**Step 1: Create the page**

```astro
---
// src/pages/[lang]/checkout.astro
import BaseLayout from '@/layouts/BaseLayout.astro';
import CheckoutPage from '@/components/interactive/CheckoutPage';
import { t } from '@/i18n';

const { lang, merchant } = Astro.locals;
const langValue = lang as 'nl' | 'en' | 'de';
---

<BaseLayout
  title={t('checkoutTitle', langValue)}
  hideSharedIslands={true}
>
  <CheckoutPage client:load lang={langValue} />
</BaseLayout>
```

**Step 2:** Create a minimal placeholder `CheckoutPage` so the build doesn't break:

```tsx
// src/components/interactive/CheckoutPage.tsx (placeholder — replaced in Task 10)
export default function CheckoutPage({ lang }: { lang: string }) {
  return <div class="min-h-screen px-4 py-8">Checkout loading...</div>;
}
```

**Step 3:** Run `pnpm build` — expect PASS.

**Step 4:** Commit: `feat(checkout): add checkout Astro page shell with placeholder island`

---

### Task 7: Checkout Success Page

**Files:**
- Create: `src/pages/[lang]/checkout/success.astro`
- Create: `src/components/interactive/CheckoutSuccess.tsx`

**Step 1: Create the success page**

```astro
---
// src/pages/[lang]/checkout/success.astro
import BaseLayout from '@/layouts/BaseLayout.astro';
import CheckoutSuccess from '@/components/interactive/CheckoutSuccess';
import { t } from '@/i18n';

const { lang, merchant } = Astro.locals;
const langValue = lang as 'nl' | 'en' | 'de';
---

<BaseLayout
  title={t('orderConfirmed', langValue)}
  hideSharedIslands={true}
>
  <CheckoutSuccess client:load lang={langValue} />
</BaseLayout>
```

**Step 2: Create a minimal CheckoutSuccess island**

```tsx
// src/components/interactive/CheckoutSuccess.tsx
import { useEffect, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $merchant } from '@/stores/merchant';
import { t } from '@/i18n';
import { formatPrice, langToLocale } from '@/lib/currency';

interface Props {
  lang: 'nl' | 'en' | 'de';
}

export default function CheckoutSuccess({ lang }: Props) {
  const merchant = useStore($merchant);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const order = params.get('order');
    const checkoutId = params.get('checkout_id');
    const paymentIntent = params.get('payment_intent');

    // Clean sensitive params from URL immediately
    if (paymentIntent) {
      const cleanUrl = order
        ? `/${lang}/checkout/success?order=${order}`
        : `/${lang}/checkout/success`;
      history.replaceState({}, '', cleanUrl);
    }

    if (order && !paymentIntent) {
      setOrderNumber(order);
      setLoading(false);
    } else if (checkoutId && paymentIntent) {
      // Bank redirect return — use ensurePaymentAndComplete (wired in Task 19)
      // For now, show confirming state. Task 19 will integrate the full
      // ensurePaymentAndComplete() flow with Stripe's retrievePaymentIntent.
      setLoading(false);
      setOrderNumber(null); // Will be set after /complete/ call
    } else {
      // No valid params — redirect to menu
      window.location.href = `/${lang}/`;
    }
  }, [lang]);

  if (loading) {
    return (
      <div class="flex items-center justify-center min-h-[60vh]">
        <p class="text-muted-foreground">{t('confirmingOrder', lang)}</p>
      </div>
    );
  }

  return (
    <div class="max-w-lg mx-auto px-4 py-12 text-center">
      <div class="mb-6">
        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
          <svg class="w-8 h-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width={2}>
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 class="text-2xl font-heading font-bold">{t('orderConfirmed', lang)}</h1>
        <p class="text-muted-foreground mt-2">{t('thankYou', lang)}</p>
      </div>

      {orderNumber && (
        <p class="text-sm text-muted-foreground">
          {t('orderNumber', lang)}: <span class="font-mono font-medium text-foreground">{orderNumber}</span>
        </p>
      )}

      <a
        href={`/${lang}/`}
        class="inline-block mt-8 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
      >
        {t('backToMenu', lang)}
      </a>
    </div>
  );
}
```

**Step 3:** Commit: `feat(checkout): add success page with order confirmation`

---

### Task 8: CartBar Suppression on Checkout

**Files:**
- Modify: `src/components/interactive/CartBar.tsx:49-51`

**Step 1:** In `CartBar.tsx`, fix two issues:

1. **Add checkout suppression** (before line 49): render an empty stable wrapper on checkout pages.
2. **Fix existing DOM stability bug** (line 49-51): the existing `return null` when cart is empty violates the CLAUDE.md island DOM stability gotcha. Replace with an empty wrapper.

Replace lines 48-51:
```tsx
  // OLD:
  // if (itemCount === 0 || isCartOpen || isCategoryDrawerOpen) {
  //   return null;
  // }

  // NEW: Always render a stable wrapper for DOM stability (CLAUDE.md gotcha)
  const emptyWrapper = <div class="fixed bottom-0 left-0 right-0 z-40 md:hidden" />;

  // Suppress on checkout pages
  if (typeof window !== 'undefined' && window.location.pathname.includes('/checkout')) {
    return emptyWrapper;
  }

  // Hide when: no items, cart drawer open, or category drawer open
  if (itemCount === 0 || isCartOpen || isCategoryDrawerOpen) {
    return emptyWrapper;
  }
```

**Step 2:** Run `pnpm test` — expect existing tests PASS.

**Step 3:** Commit: `fix: CartBar renders stable wrapper instead of null for DOM stability`

---

### Task 9: Middleware Cache Headers for Checkout

**Files:**
- Modify: `src/middleware.ts:106` (before the isCacheable block)

**Step 1:** Add checkout-specific cache headers before the existing `isCacheable` block (around line 106):

```typescript
// Add BEFORE the isCacheable check:
if (url.pathname.match(/^\/[a-z]{2}\/checkout/)) {
  response.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  return response;
}
```

**Step 2:** Run `pnpm test` — expect PASS.

**Step 3:** Commit: `feat(checkout): add no-store cache headers for checkout routes`

---

## Phase 3: CheckoutPage Island (Main Component)

### Task 10: CheckoutPage Skeleton + Form Reducer

**Files:**
- Create: `src/components/interactive/CheckoutPage.tsx`
- Create: `src/components/interactive/checkout/CheckoutHeader.tsx`
- Create: `src/components/interactive/checkout/OrderSummary.tsx`
- Create: `src/components/interactive/checkout/FormDivider.tsx`
- Create: `src/components/interactive/checkout/PlaceOrderButton.tsx`

This task creates the main island shell, the `useReducer` form state (needed by all form sections), and the structural components. **This is the load-bearing architecture task — all subsequent form components depend on the reducer interface defined here.**

**Step 1: Create CheckoutHeader**

```tsx
// src/components/interactive/checkout/CheckoutHeader.tsx
import { t } from '@/i18n';

interface Props {
  lang: 'nl' | 'en' | 'de';
  merchantName: string;
}

export function CheckoutHeader({ lang, merchantName }: Props) {
  return (
    <header class="flex items-center justify-between py-4 px-4 border-b border-border">
      <a
        href={`/${lang}/cart`}
        class="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width={2}>
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        {t('backToCart', lang)}
      </a>
      <span class="font-heading font-bold text-lg">{merchantName}</span>
    </header>
  );
}
```

**Step 2: Create FormDivider** — conditional "or fill in details below" separator.

```tsx
// src/components/interactive/checkout/FormDivider.tsx
import { t } from '@/i18n';

interface Props {
  lang: 'nl' | 'en' | 'de';
  visible: boolean;
}

export function FormDivider({ lang, visible }: Props) {
  if (!visible) return null;
  return (
    <div class="flex items-center gap-3 px-4 py-3">
      <div class="flex-1 h-px bg-border" />
      <span class="text-sm text-muted-foreground">{t('orFillInDetails', lang)}</span>
      <div class="flex-1 h-px bg-border" />
    </div>
  );
}
```

**Step 3: Create OrderSummary** — renders cart/checkout line items and always-visible price breakdown. Line items collapsible for 4+ items on mobile, price breakdown always visible. Includes discount code input (re-use existing `DiscountCodeInput` island pattern from CartFooter).

**Step 4: Create PlaceOrderButton** — sticky mobile CTA:
- Uses `md:hidden` class (matching CartBar pattern)
- Listens for `focusin`/`focusout` on the form container to hide when keyboard is open
- Shows formatted total via `$checkoutTotals`
- Disabled + spinner while `$checkoutLoading` is true

**Step 5: Define the form reducer in CheckoutPage**

This is the central form state used by all child components:

```tsx
// Inside src/components/interactive/CheckoutPage.tsx

import type { CheckoutFormState } from '@/types/checkout';
import { restoreFormState, persistFormState } from '@/stores/checkout';

// --- Form reducer ---
type FormAction =
  | { type: 'SET_FIELD'; field: keyof CheckoutFormState; value: string | number | null }
  | { type: 'SET_FULFILLMENT'; method: 'delivery' | 'pickup' }
  | { type: 'SET_SCHEDULING'; mode: 'asap' | 'scheduled' }
  | { type: 'RESTORE'; state: CheckoutFormState };

const INITIAL_FORM_STATE: CheckoutFormState = {
  email: '',
  phone: '',
  firstName: '',
  lastName: '',
  street: '',
  city: '',
  postalCode: '',
  countryCode: 'NL',
  fulfillmentMethod: 'delivery',
  pickupLocationId: null,
  schedulingMode: 'asap',
  scheduledDate: null,
  selectedSlotId: null,
  selectedShippingRateId: null,
};

function formReducer(state: CheckoutFormState, action: FormAction): CheckoutFormState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'SET_FULFILLMENT':
      return { ...state, fulfillmentMethod: action.method };
    case 'SET_SCHEDULING':
      return { ...state, schedulingMode: action.mode };
    case 'RESTORE':
      return action.state;
    default:
      return state;
  }
}

// --- Main component ---
export default function CheckoutPage({ lang }: { lang: 'nl' | 'en' | 'de' }) {
  const merchant = useStore($merchant);
  const cart = useStore($cart);
  const checkout = useStore($checkout);
  const totals = useStore($checkoutTotals);
  const loading = useStore($checkoutLoading);

  // Restore form state from sessionStorage on mount
  const [form, dispatch] = useReducer(formReducer, INITIAL_FORM_STATE, (initial) => {
    const restored = restoreFormState<CheckoutFormState>();
    return restored ?? initial;
  });

  // Pre-populate postal code from $addressCoords if available
  useEffect(() => {
    const coords = $addressCoords.get();
    if (coords?.postalCode && !form.postalCode) {
      dispatch({ type: 'SET_FIELD', field: 'postalCode', value: coords.postalCode });
    }
  }, []);

  // Persist form state on field blur (not on every keystroke)
  const handleFieldBlur = useCallback(() => {
    persistFormState(form);
  }, [form]);

  // Cross-tab cart change detection via storage event
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'sous_cart_id' || e.key === null) {
        // Cart may have changed in another tab — will be checked on next interaction
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // Guard: wait for $merchant before any API calls (hydration safety)
  if (!merchant) return <div class="min-h-screen" />;

  // Guard: redirect to menu if cart is empty
  // Render stable wrapper (not null) for DOM stability during redirect
  if (cart && cart.line_items.length === 0) {
    window.location.href = `/${lang}/`;
    return <div class="min-h-screen" />;
  }

  // Render layout...
  // Each form section receives: form, dispatch, handleFieldBlur, lang
}
```

**Step 6: Create a placeholder `CheckoutPage` that renders** the header, order summary, form divider, and place order button with placeholder content for form sections. This makes the page buildable and navigable.

**Step 7:** Run `pnpm dev` and navigate to `/en/checkout` — verify the skeleton renders with cart data. No site Header/Footer is rendered (intentional — checkout pages strip navigation for conversion).

**Step 8:** Commit: `feat(checkout): add CheckoutPage skeleton with reducer, header, summary, and CTA`

---

### Task 11: ContactForm

**Files:**
- Create: `src/components/interactive/checkout/ContactForm.tsx`
- Create: `src/components/interactive/checkout/ContactForm.test.tsx`

**Props interface:**
```tsx
interface Props {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  onBlur: () => void;
  errors: Record<string, string>;
}
```

**Step 1: Write failing test**
```tsx
// src/components/interactive/checkout/ContactForm.test.tsx
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/preact';
import { ContactForm } from './ContactForm';

const defaultProps = {
  lang: 'en' as const,
  form: { email: '', phone: '', firstName: '', lastName: '', /* ... rest of CheckoutFormState defaults */ },
  dispatch: vi.fn(),
  onBlur: vi.fn(),
  errors: {},
};

describe('ContactForm', () => {
  it('renders email, phone, first name, last name fields', () => {
    const { getByLabelText } = render(<ContactForm {...defaultProps} />);
    expect(getByLabelText(/email/i)).toBeDefined();
    expect(getByLabelText(/phone/i)).toBeDefined();
    expect(getByLabelText(/first name/i)).toBeDefined();
    expect(getByLabelText(/last name/i)).toBeDefined();
  });

  it('dispatches SET_FIELD on input change', () => {
    const dispatch = vi.fn();
    const { getByLabelText } = render(<ContactForm {...defaultProps} dispatch={dispatch} />);
    fireEvent.input(getByLabelText(/email/i), { target: { value: 'test@example.com' } });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FIELD', field: 'email', value: 'test@example.com' });
  });

  it('shows validation error for invalid email on blur', () => {
    const { getByLabelText, getByText } = render(
      <ContactForm {...defaultProps} errors={{ email: 'Invalid email' }} />
    );
    expect(getByText('Invalid email')).toBeDefined();
  });

  it('calls onBlur to persist form state', () => {
    const onBlur = vi.fn();
    const { getByLabelText } = render(<ContactForm {...defaultProps} onBlur={onBlur} />);
    fireEvent.blur(getByLabelText(/email/i));
    expect(onBlur).toHaveBeenCalled();
  });
});
```

**Step 2:** Run `pnpm test src/components/interactive/checkout/ContactForm.test.tsx` — expect FAIL.

**Step 3: Implement** — Four labeled input fields (email with `type="email"`, phone with `type="tel"`, first/last name with `type="text"`). Each dispatches `SET_FIELD` on `onInput`, calls `onBlur` on blur. Error messages rendered below each field with `role="alert"`. Phone validated against merchant country on blur (simple regex for now; `libphonenumber-js/mobile` added in Task 23 if bundle allows).

**Step 4:** Run test — expect PASS.

**Step 5: Integrate** into `CheckoutPage.tsx` below the FormDivider. Pass `form`, `dispatch`, `handleFieldBlur`, and `errors` state.

**Step 6:** Commit: `feat(checkout): add ContactForm with validation`

---

### Task 12: FulfillmentToggle

**Files:**
- Create: `src/components/interactive/checkout/FulfillmentToggle.tsx`
- Create: `src/components/interactive/checkout/FulfillmentToggle.test.tsx`

**Props interface:**
```tsx
interface Props {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  availableMethods: ('delivery' | 'pickup')[];
  deliveryEligible: boolean | null; // null = unknown (no address yet)
}
```

**Step 1: Write failing test**
```tsx
describe('FulfillmentToggle', () => {
  it('renders delivery and pickup radio buttons', () => { /* ... */ });
  it('dispatches SET_FULFILLMENT on selection change', () => { /* ... */ });
  it('hides toggle when only one method available', () => { /* ... */ });
  it('shows delivery unavailable message when deliveryEligible is false', () => { /* ... */ });
  it('shows "confirm availability" note when deliveryEligible is null', () => { /* ... */ });
});
```

**Step 2:** Run test — expect FAIL.

**Step 3: Implement** — Radio buttons with `role="radiogroup"`, large touch targets (`min-h-[48px]`). Conditional rendering: skip toggle for single-method merchants. Shows delivery eligibility messages per design doc Section 6. Triggers `patchDelivery` when method changes.

**Step 4:** Run test — expect PASS.

**Step 5: Integrate** into CheckoutPage above ContactForm.

**Step 6:** Commit: `feat(checkout): add FulfillmentToggle with eligibility logic`

---

### Task 13: DeliveryAddressForm

**Files:**
- Create: `src/components/interactive/checkout/DeliveryAddressForm.tsx`
- Create: `src/components/interactive/checkout/DeliveryAddressForm.test.tsx`

**Props interface:**
```tsx
interface Props {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  onBlur: () => void;
  errors: Record<string, string>;
  visible: boolean; // hidden when fulfillmentMethod === 'pickup'
}
```

**Step 1: Write failing test**
```tsx
describe('DeliveryAddressForm', () => {
  it('renders street, city, postal code fields when visible', () => { /* ... */ });
  it('renders nothing when visible is false', () => { /* ... */ });
  it('pre-fills postal code from props', () => { /* ... */ });
  it('dispatches SET_FIELD for each address field', () => { /* ... */ });
  it('uses inputmode="numeric" for postal code', () => { /* ... */ });
  it('triggers PATCH on last required field blur', () => { /* ... */ });
});
```

**Step 2:** Run test — expect FAIL.

**Step 3: Implement** — Three fields: street (`type="text"`, required), city (`type="text"`, required), postal code (`inputmode="numeric"`, required). Country defaults to `"NL"`. On blur of the last required field (when all three are filled), triggers `patchDelivery` with the full address. Inline error display per field.

**Step 4:** Run test — expect PASS.

**Step 5: Integrate** into CheckoutPage, conditionally rendered when `form.fulfillmentMethod === 'delivery'`.

**Step 6:** Commit: `feat(checkout): add DeliveryAddressForm with PATCH trigger`

---

### Task 14: PickupLocationPicker

**Files:**
- Create: `src/components/interactive/checkout/PickupLocationPicker.tsx`
- Create: `src/components/interactive/checkout/PickupLocationPicker.test.tsx`

**Props interface:**
```tsx
interface Props {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  locations: Array<{ id: number; name: string; distance_km?: number }>;
  visible: boolean; // hidden when fulfillmentMethod === 'delivery'
}
```

**Step 1: Write failing test**
```tsx
describe('PickupLocationPicker', () => {
  it('renders location options as a select', () => { /* ... */ });
  it('renders nothing when visible is false', () => { /* ... */ });
  it('dispatches SET_FIELD for pickupLocationId on selection', () => { /* ... */ });
  it('triggers PATCH when location is selected', () => { /* ... */ });
  it('shows distance when available', () => { /* ... */ });
});
```

**Step 2:** Run test — expect FAIL.

**Step 3: Implement** — Native `<select>` element for accessibility. Each option shows location name + distance if available. On change, dispatches `SET_FIELD` for `pickupLocationId` and triggers `patchDelivery`.

**Step 4:** Run test — expect PASS.

**Step 5: Integrate** into CheckoutPage, conditionally rendered when `form.fulfillmentMethod === 'pickup'`.

**Step 6:** Commit: `feat(checkout): add PickupLocationPicker`

---

### Task 15: SchedulingPicker

**Files:**
- Create: `src/components/interactive/checkout/SchedulingPicker.tsx`
- Create: `src/components/interactive/checkout/SchedulingPicker.test.tsx`

**Props interface:**
```tsx
interface Props {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  timeSlots: TimeSlot[];
  onDateChange: (date: string) => void;
  onSlotSelect: (slotId: string) => void;
  isPickup: boolean;
  loading: boolean;
}
```

**Step 1: Write failing test**
```tsx
describe('SchedulingPicker', () => {
  it('renders ASAP and Schedule radio buttons', () => { /* ... */ });
  it('dispatches SET_SCHEDULING on toggle', () => { /* ... */ });
  it('shows date strip when scheduled is selected', () => { /* ... */ });
  it('shows 7 days with arrow navigation', () => { /* ... */ });
  it('renders time slots as role="radiogroup" for pickup', () => { /* ... */ });
  it('hides time slots for delivery', () => { /* ... */ });
  it('marks full slots with aria-disabled="true"', () => { /* ... */ });
  it('only shows available slots by default', () => { /* ... */ });
  it('shows "Show all times" toggle', () => { /* ... */ });
  it('calls onSlotSelect when a slot is tapped', () => { /* ... */ });
  it('supports keyboard navigation on date strip via role="listbox"', () => { /* ... */ });
});
```

**Step 2:** Run test — expect FAIL.

**Step 3: Implement** —
- ASAP/Schedule radio buttons
- 7-day date strip with `<` `>` arrow buttons (not horizontal scroll). Uses `role="listbox"` with arrow key navigation. Today/Tomorrow labels, then date strings.
- Time slot list: `role="radiogroup"`. Only available slots shown by default; "Show all times" toggle reveals full list with `aria-disabled="true"` + `aria-label="Full"` on unavailable ones.
- Calls `onDateChange` when date changes (parent fetches new slots). Calls `onSlotSelect` when slot selected (parent triggers PATCH).
- Timezone: times displayed in merchant timezone (default `"Europe/Amsterdam"` until Backend Requirement #7 is available).

**Step 4:** Run test — expect PASS.

**Step 5: Integrate** into CheckoutPage below address/pickup section.

**Step 6:** Commit: `feat(checkout): add SchedulingPicker with ARIA and time slots`

---

### Task 16: PrivacyNotice

**Files:**
- Create: `src/components/interactive/checkout/PrivacyNotice.tsx`

**Step 1: Create component** — Simple presentational component, no test needed.

```tsx
// src/components/interactive/checkout/PrivacyNotice.tsx
import { t } from '@/i18n';

interface Props {
  lang: 'nl' | 'en' | 'de';
  privacyPolicyUrl?: string;
}

export function PrivacyNotice({ lang, privacyPolicyUrl }: Props) {
  return (
    <p class="text-xs text-muted-foreground px-4 py-3">
      <svg class="inline-block w-3 h-3 mr-1 -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width={2}>
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      {t('privacyNotice', lang)}{' '}
      {privacyPolicyUrl ? (
        <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer" class="underline hover:text-foreground">
          {t('privacyPolicy', lang)}
        </a>
      ) : (
        <span>{t('privacyPolicy', lang)}</span>
      )}
    </p>
  );
}
```

**Step 2: Integrate** into CheckoutPage below the payment section.

**Step 3:** Commit: `feat(checkout): add PrivacyNotice component`

---

## Phase 4: Stripe Integration

### Task 17: Stripe Payment Form (Lazy-Loaded)

**Files:**
- Create: `src/components/interactive/checkout/StripePaymentForm.tsx`

This component:
- Receives `clientSecret`, `publishableKey`, `stripeAccount` as props
- Calls `loadStripe()` and mounts the Payment Element
- Maps merchant theme to Stripe `appearance` API
- Wrapped in `memo()` to prevent re-mount on parent re-renders
- Loaded via `lazy(() => import('./checkout/StripePaymentForm'))` in CheckoutPage

---

### Task 18: Express Checkout (Payment Request Button)

**Files:**
- Create: `src/components/interactive/checkout/ExpressCheckout.tsx`

This component:
- Creates a Stripe `paymentRequest` with merchant country, currency, total
- Checks `canMakePayment()` — hides entirely if unavailable
- Mounts Payment Request Button (Apple Pay / Google Pay)
- Handles `paymentmethod` event: creates checkout → patches delivery → initiates payment → confirms
- Error handling: `ev.complete('fail')` on any step failure with inline error message

---

### Task 19: Wire Stripe into CheckoutPage

**Files:**
- Modify: `src/components/interactive/CheckoutPage.tsx`

Integrate the full payment flow into **both** CheckoutPage and CheckoutSuccess:

**In CheckoutPage:**
1. After delivery section complete → `Promise.all([shipping, payment-gateways, slots])`
2. Then `POST /payment/` → verify amount → mount Payment Element
3. "Place Order" calls `stripe.confirmPayment()` with `redirect: 'if_required'`
4. Success → `ensurePaymentAndComplete()` → redirect to success page

**In CheckoutSuccess (bank redirect completion):**
5. Wire the bank redirect flow: read `checkout_id` + `payment_intent_client_secret` from URL
6. Initialize Stripe with `loadStripe(publishableKey, { stripeAccount })`
7. Call `ensurePaymentAndComplete(checkoutId, clientSecret, stripe, lang)`
8. This handles iDEAL/Bancontact returns where Stripe redirected to the bank and back

---

## Phase 5: E2E Tests & Mock API

### Task 20: Mock API Checkout Endpoints

**Files:**
- Modify: `e2e/helpers/mock-api.ts`
- Create: `e2e/helpers/stripe-mock.ts`

Add checkout endpoints to the mock API server:
- `POST /api/v1/checkout/` — create from cart state
- `GET /api/v1/checkout/{id}/` — return stored checkout
- `PATCH /api/v1/checkout/{id}/delivery/` — update and return
- `GET /api/v1/checkout/{id}/shipping/` — return shipping groups
- `GET /api/v1/checkout/{id}/payment-gateways/` — return Stripe config
- `POST /api/v1/checkout/{id}/payment/` — return mock client_secret + amount
- `POST /api/v1/checkout/{id}/complete/` — return order_number (idempotent)
- `GET /api/v1/fulfillment/locations/{id}/slots/` — return mock slots

Create Stripe mock using `page.route('https://js.stripe.com/**', ...)`.

---

### Task 21: E2E Test Suites

**Files:**
- Create: `e2e/checkout.spec.ts`
- Create: `e2e/checkout-success.spec.ts`
- Create: `e2e/checkout-security.spec.ts`

Write E2E tests per the design doc Section 11 test scenarios. Key tests:
- Happy path delivery checkout
- Happy path pickup checkout with time slot
- Scroll-to-first-error on validation failure
- Express checkout buttons visibility
- Mobile sticky CTA behavior
- Deferred checkout creation
- PATCH queue race condition (with mock API delay)
- Cart change detection across tabs
- Success page bank redirect handling
- Cache-Control headers verification
- Checkout ID validation / rejection

---

## Phase 6: Security & Polish

### Task 22: CSP Headers

**Files:**
- Modify: `vercel.json`

Add Content-Security-Policy-Report-Only header for checkout routes:

```json
{
  "source": "/:lang/checkout/(.*)",
  "headers": [
    {
      "key": "Content-Security-Policy-Report-Only",
      "value": "default-src 'self'; script-src 'self' https://js.stripe.com; frame-src https://js.stripe.com https://hooks.stripe.com; connect-src 'self' https://api.stripe.com https://*.posthog.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:"
    }
  ]
},
{
  "source": "/:lang/checkout/success",
  "headers": [
    {
      "key": "Referrer-Policy",
      "value": "no-referrer"
    }
  ]
}
```

---

### Task 23: Bundle Size Validation

**Files:**
- Modify: `package.json` (size-limit config, if budget needs adjusting)

**Step 1:** Run `pnpm build && pnpm size:check` to measure actual bundle impact.

**Step 2:** If over 65 KB, implement mitigation from design doc Section 12:
1. First try: lighter phone validation (regex instead of libphonenumber-js)
2. If still over: add checkout-specific size-limit entry and raise global to 75 KB
3. If still over: extract OrderSummary to `client:visible` island
4. If still over: use `client:only="preact"` instead of `client:load` (no SSR value for a form-heavy page)

**Step 3:** Commit: `chore: validate and adjust bundle budget for checkout`

---

### Task 24: Final Integration Test

**Step 1:** Run full test suite: `pnpm test && pnpm test:e2e`

**Step 2:** Run type check: `pnpm check`

**Step 3:** Run bundle check: `pnpm size:check`

**Step 4:** Manual smoke test on `pnpm dev`:
- Navigate to menu → add items → open cart → click checkout
- Fill form → select delivery → verify totals update
- Switch to pickup → verify address form hides
- Select time slot → verify reservation feedback
- Complete payment (Stripe test mode)
- Verify success page

**Step 5:** Commit any final fixes.

---

## Task Dependency Graph

```
Phase 1 (Foundation):
  Task 1 (validate-id) ─┐── truly independent, can parallelize
  Task 2 (types) ────────┤
  Task 5 (i18n) ─────────┘
  Task 3 (store) ──────── depends on Task 1 (runtime import) + Task 2 (type import)
  Task 4 (actions) ────── depends on Task 3

Phase 2 (Page Shell):
  Task 5 (i18n) ─────────── MUST complete before Tasks 6, 7 (they use t() keys)
  Task 6 (checkout.astro) ─ depends on Task 5, 10 (needs placeholder CheckoutPage)
  Task 7 (success page) ─── depends on Task 5
  Task 8 (CartBar fix) ──── independent (different file)
  Task 9 (middleware) ────── independent (different file)

Phase 3 (Components):
  Task 10 (skeleton) ──── depends on Phase 1 + Tasks 6, 5
  Tasks 11-16 (forms) ── depend on Task 10 (need reducer interface), can parallelize

Phase 4 (Stripe):
  Tasks 17-19 ──── depend on Tasks 11-16

Phase 5 (E2E):
  Task 20 (mock API) ──── depends on Phase 1 (needs types)
  Task 21 (E2E tests) ── depends on Tasks 17-19, 20

Phase 6 (Polish):
  Tasks 22-24 ──── depend on everything above
```

## Parallelization Opportunities

- **Tasks 1, 2, 5** can run as parallel subagents (no shared files, no runtime deps).
- **Tasks 8, 9** can run in parallel with each other and with Phase 1 (different files).
- **Tasks 11-16** can run as parallel subagents once Task 10 is done (each receives props from the shared reducer, but components are in separate files).
- **Task 3** must wait for Tasks 1 and 2 (it imports from both).
- **Tasks 6, 7** must wait for Task 5 (i18n keys needed at runtime).

## Notes for Implementers

- **No site Header/Footer on checkout pages.** This is intentional — checkout pages strip navigation to reduce abandonment. The `CheckoutHeader` component provides a back-to-cart link and merchant name.
- **`as any` casts on SDK paths** are temporary until `@poweredbysous/storefront-sdk` adds checkout endpoint types. Consider defining a local `CheckoutClient` interface to limit `any` blast radius.
- **CSP nonce enforcement is deferred.** Task 22 uses `Content-Security-Policy-Report-Only`. Full nonce-based CSP requires Astro middleware generating per-request nonces and injecting them into `is:inline` script tags — this is a follow-up task after checkout launch.
