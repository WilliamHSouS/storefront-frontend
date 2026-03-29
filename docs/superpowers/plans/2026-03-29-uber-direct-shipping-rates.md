# Uber Direct Shipping Rates — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display Uber Direct shipping rates in the checkout flow, let users select a rate, handle expired quotes with automatic re-fetch, and show rate expiry indicators.

**Architecture:** The backend exposes Uber Direct rates through the existing `GET /shipping-groups/` endpoint. A new `POST /select-rate/` endpoint (already built) accepts the user's rate choice. Expired quotes return HTTP 410, prompting a re-fetch. The frontend adds a `ShippingRateSelector` component between the address form and scheduling picker, backed by two new actions in `checkout-actions.ts`. The mock API URL changes from `/shipping/` to `/shipping-groups/` and adds an Uber Direct rate + `select-rate` handler.

**Tech Stack:** Preact, Nanostores, Vitest, Playwright, Tailwind CSS

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/stores/checkout-actions.ts` | Modify | Add `fetchShippingGroups()` and `selectShippingRate()` actions |
| `src/stores/checkout.ts` | Modify | Add `$shippingGroups` atom + `$shippingGroupsLoading` |
| `src/types/checkout.ts` | Modify (verify only) | `ShippingRate` already has `expires_at` — no changes needed |
| `src/components/interactive/checkout/ShippingRateSelector.tsx` | Create | Rate picker UI with expiry indicator |
| `src/components/interactive/checkout/ShippingRateSelector.test.tsx` | Create | Unit tests for rate selector |
| `src/components/interactive/checkout/CheckoutFormOrchestrator.tsx` | Modify | Wire shipping groups fetch + rate selector into form flow |
| `src/components/interactive/checkout/CheckoutFormOrchestrator.test.tsx` | Modify | Add shipping groups integration tests |
| `src/i18n/messages/en.json` | Modify | Add shipping rate i18n keys |
| `src/i18n/messages/nl.json` | Modify | Add shipping rate i18n keys |
| `src/i18n/messages/de.json` | Modify | Add shipping rate i18n keys |
| `e2e/helpers/mock-api.ts` | Modify | Update shipping endpoint path, add Uber rate, add select-rate + 410 |
| `e2e/checkout.spec.ts` | Modify | Add shipping rate selection E2E test |

---

### Task 1: Add shipping groups state atoms

**Files:**
- Modify: `src/stores/checkout.ts`

- [ ] **Step 1: Add `$shippingGroups` and `$shippingGroupsLoading` atoms**

Add these atoms after the existing `$checkoutError` atom (line 11):

```typescript
import type { Checkout, CheckoutFormState, ShippingGroup } from '@/types/checkout';

// After line 11: export const $checkoutError = atom<string | null>(null);
export const $shippingGroups = atom<ShippingGroup[]>([]);
export const $shippingGroupsLoading = atom(false);
```

Update the existing import on line 2 to include `ShippingGroup`:

```typescript
import type { Checkout, CheckoutFormState, ShippingGroup } from '@/types/checkout';
```

- [ ] **Step 2: Verify types are already correct**

Run: `grep -n 'expires_at' src/types/checkout.ts`
Expected: `ShippingRate` already has `expires_at: string | null` at line 97.

No type changes needed — `ShippingRate` and `ShippingGroup` are already defined correctly.

- [ ] **Step 3: Commit**

```bash
git add src/stores/checkout.ts
git commit -m "feat(checkout): add shipping groups state atoms"
```

---

### Task 2: Add `fetchShippingGroups` and `selectShippingRate` actions

**Files:**
- Modify: `src/stores/checkout-actions.ts`

- [ ] **Step 1: Write the failing test**

Create `src/stores/checkout-actions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { $shippingGroups, $shippingGroupsLoading } from '@/stores/checkout';
import type { ShippingGroup } from '@/types/checkout';

vi.mock('@/lib/logger', () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

describe('fetchShippingGroups', () => {
  beforeEach(() => {
    $shippingGroups.set([]);
    $shippingGroupsLoading.set(false);
  });

  it('fetches shipping groups and stores them', async () => {
    const mockGroups: ShippingGroup[] = [
      {
        id: 'grp-1',
        merchant_shipping_provider_id: 1,
        shipping_cost: '5.00',
        selected_rate_id: null,
        is_digital: false,
        available_rates: [
          {
            id: 'rate-1',
            name: 'Local Delivery',
            cost: '5.00',
            original_cost: '5.00',
            rate_id: 'local_delivery',
            expires_at: null,
          },
          {
            id: 'rate-2',
            name: 'Uber Direct',
            cost: '6.00',
            original_cost: '6.00',
            rate_id: 'dqt_abc123',
            expires_at: '2026-03-29T15:15:00Z',
          },
        ],
        line_items: [],
      },
    ];

    const mockClient = {
      GET: vi.fn().mockResolvedValue({ data: mockGroups, error: null }),
    };

    const { fetchShippingGroups } = await import('./checkout-actions');
    const groups = await fetchShippingGroups('chk-1', mockClient as any);

    expect(mockClient.GET).toHaveBeenCalledWith(
      '/api/v1/checkout/{checkout_id}/shipping-groups/',
      { params: { path: { checkout_id: 'chk-1' } } },
    );
    expect(groups).toEqual(mockGroups);
    expect($shippingGroups.get()).toEqual(mockGroups);
    expect($shippingGroupsLoading.get()).toBe(false);
  });

  it('returns empty array on error', async () => {
    const mockClient = {
      GET: vi.fn().mockResolvedValue({ data: null, error: { status: 500, statusText: 'Error' } }),
    };

    const { fetchShippingGroups } = await import('./checkout-actions');
    const groups = await fetchShippingGroups('chk-1', mockClient as any);

    expect(groups).toEqual([]);
    expect($shippingGroups.get()).toEqual([]);
  });
});

describe('selectShippingRate', () => {
  beforeEach(() => {
    $shippingGroups.set([]);
  });

  it('calls select-rate endpoint and returns success', async () => {
    const mockClient = {
      POST: vi.fn().mockResolvedValue({ data: { status: 'ok' }, error: null }),
    };

    const { selectShippingRate } = await import('./checkout-actions');
    const result = await selectShippingRate('chk-1', 'grp-1', 'rate-1', mockClient as any);

    expect(mockClient.POST).toHaveBeenCalledWith(
      '/api/v1/checkout/{checkout_id}/shipping-groups/select-rate/',
      {
        params: { path: { checkout_id: 'chk-1' } },
        body: { group_id: 'grp-1', rate_id: 'rate-1' },
      },
    );
    expect(result).toEqual({ ok: true, expired: false });
  });

  it('returns expired=true on 410 response', async () => {
    const mockClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 410, statusText: 'Gone', body: { code: 'shipping_rate_expired' } },
      }),
    };

    const { selectShippingRate } = await import('./checkout-actions');
    const result = await selectShippingRate('chk-1', 'grp-1', 'rate-1', mockClient as any);

    expect(result).toEqual({ ok: false, expired: true });
  });

  it('returns ok=false on other errors', async () => {
    const mockClient = {
      POST: vi.fn().mockResolvedValue({
        data: null,
        error: { status: 500, statusText: 'Server Error' },
      }),
    };

    const { selectShippingRate } = await import('./checkout-actions');
    const result = await selectShippingRate('chk-1', 'grp-1', 'rate-1', mockClient as any);

    expect(result).toEqual({ ok: false, expired: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/stores/checkout-actions.test.ts`
Expected: FAIL — `fetchShippingGroups` and `selectShippingRate` not exported.

- [ ] **Step 3: Implement `fetchShippingGroups` and `selectShippingRate`**

Add to the end of `src/stores/checkout-actions.ts` (before the closing, after `ensurePaymentAndComplete`):

```typescript
import {
  $checkout,
  $checkoutLoading,
  $checkoutError,
  $shippingGroups,
  $shippingGroupsLoading,
  setStoredCheckoutId,
  clearStoredCheckoutId,
} from '@/stores/checkout';
import type { Checkout, PaymentResult, ShippingGroup } from '@/types/checkout';
```

Update the import block at the top to include `$shippingGroups`, `$shippingGroupsLoading`, and `ShippingGroup`.

Then add the two new functions:

```typescript
// ── fetchShippingGroups ────────────────────────────────────────────────

/**
 * Fetch shipping groups (with rates) for a checkout.
 * Uber Direct rates will have populated `rate_id` and `expires_at`.
 */
export async function fetchShippingGroups(
  checkoutId: string,
  client?: StorefrontClient,
): Promise<ShippingGroup[]> {
  $shippingGroupsLoading.set(true);
  try {
    const sdk = client ?? getClient();
    const { data, error } = await sdk.GET(
      '/api/v1/checkout/{checkout_id}/shipping-groups/',
      { params: { path: { checkout_id: checkoutId } } },
    );

    if (error || !data) {
      log.error('checkout', 'fetchShippingGroups failed:', error);
      $shippingGroups.set([]);
      return [];
    }

    const groups = data as unknown as ShippingGroup[];
    $shippingGroups.set(groups);
    return groups;
  } finally {
    $shippingGroupsLoading.set(false);
  }
}

// ── selectShippingRate ─────────────────────────────────────────────────

export interface SelectRateResult {
  ok: boolean;
  expired: boolean;
}

/**
 * Select a shipping rate for a checkout.
 * Returns `{ ok: true }` on success, `{ expired: true }` on HTTP 410
 * (caller should re-fetch shipping groups for fresh quotes).
 */
export async function selectShippingRate(
  checkoutId: string,
  groupId: string,
  rateId: string,
  client?: StorefrontClient,
): Promise<SelectRateResult> {
  const sdk = client ?? getClient();
  const { data, error } = await sdk.POST(
    '/api/v1/checkout/{checkout_id}/shipping-groups/select-rate/',
    {
      params: { path: { checkout_id: checkoutId } },
      body: { group_id: groupId, rate_id: rateId },
    },
  );

  if (error) {
    const apiError = error as { status?: number };
    if (apiError.status === 410) {
      log.warn('checkout', 'Shipping rate expired, need to re-fetch groups');
      return { ok: false, expired: true };
    }
    log.error('checkout', 'selectShippingRate failed:', error);
    return { ok: false, expired: false };
  }

  return { ok: true, expired: false };
}
```

Note: The SDK may not yet have the `/shipping-groups/` and `/select-rate/` paths in its types. Until the SDK is updated, these calls will need `as any` on the path — but per CLAUDE.md rules, we should add a tracking comment and not leave bare `as any` on paths. Instead, use a typed path string if available, or add an `eslint-disable` with justification if the SDK hasn't been regenerated yet. **Check the SDK types first** — if the paths exist, use them directly. If not, use:

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shipping-groups endpoint not yet in SDK types; remove after SDK regeneration
'/api/v1/checkout/{checkout_id}/shipping-groups/' as any
```

And similarly for the select-rate POST.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/stores/checkout-actions.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/stores/checkout-actions.ts src/stores/checkout-actions.test.ts
git commit -m "feat(checkout): add fetchShippingGroups and selectShippingRate actions"
```

---

### Task 3: Add i18n keys for shipping rate selection

**Files:**
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/nl.json`
- Modify: `src/i18n/messages/de.json`

- [ ] **Step 1: Add keys to en.json**

Add after the `"shippingUnavailable"` key (line 94):

```json
  "shippingMethod": "Shipping method",
  "selectShippingRate": "Select a shipping method",
  "shippingRateExpired": "Price updated — please re-select",
  "shippingRateExpiresSoon": "Price valid for {minutes} min",
  "shippingRateRefreshing": "Refreshing shipping rates..."
```

- [ ] **Step 2: Add keys to nl.json**

Add after `"shippingUnavailable"`:

```json
  "shippingMethod": "Verzendmethode",
  "selectShippingRate": "Kies een verzendmethode",
  "shippingRateExpired": "Prijs bijgewerkt — selecteer opnieuw",
  "shippingRateExpiresSoon": "Prijs geldig voor {minutes} min",
  "shippingRateRefreshing": "Verzendtarieven vernieuwen..."
```

- [ ] **Step 3: Add keys to de.json**

Add after `"shippingUnavailable"`:

```json
  "shippingMethod": "Versandart",
  "selectShippingRate": "Versandart auswählen",
  "shippingRateExpired": "Preis aktualisiert — bitte erneut auswählen",
  "shippingRateExpiresSoon": "Preis gültig für {minutes} Min",
  "shippingRateRefreshing": "Versandtarife werden aktualisiert..."
```

- [ ] **Step 4: Commit**

```bash
git add src/i18n/messages/en.json src/i18n/messages/nl.json src/i18n/messages/de.json
git commit -m "feat(i18n): add shipping rate selection translation keys"
```

---

### Task 4: Create ShippingRateSelector component

**Files:**
- Create: `src/components/interactive/checkout/ShippingRateSelector.tsx`
- Create: `src/components/interactive/checkout/ShippingRateSelector.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/interactive/checkout/ShippingRateSelector.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import type { ShippingGroup } from '@/types/checkout';

vi.mock('@/i18n/client', () => ({
  t: (key: string, _lang: string, params?: Record<string, string>) => {
    if (key === 'shippingRateExpiresSoon' && params?.minutes) {
      return `Price valid for ${params.minutes} min`;
    }
    return key;
  },
}));

vi.mock('@/lib/currency', () => ({
  formatPrice: (price: string, currency: string) => `${currency} ${price}`,
  langToLocale: () => 'en-US',
}));

const staticGroup: ShippingGroup = {
  id: 'grp-1',
  merchant_shipping_provider_id: 1,
  shipping_cost: '5.00',
  selected_rate_id: null,
  is_digital: false,
  available_rates: [
    {
      id: 'rate-static',
      name: 'Standard Delivery',
      cost: '5.00',
      original_cost: '5.00',
      rate_id: 'local_delivery',
      expires_at: null,
    },
  ],
  line_items: [],
};

const mixedGroup: ShippingGroup = {
  id: 'grp-1',
  merchant_shipping_provider_id: 1,
  shipping_cost: '5.00',
  selected_rate_id: null,
  is_digital: false,
  available_rates: [
    {
      id: 'rate-static',
      name: 'Standard Delivery',
      cost: '5.00',
      original_cost: '5.00',
      rate_id: 'local_delivery',
      expires_at: null,
    },
    {
      id: 'rate-uber',
      name: 'Uber Direct',
      cost: '6.00',
      original_cost: '6.00',
      rate_id: 'dqt_abc123',
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  ],
  line_items: [],
};

describe('ShippingRateSelector', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders nothing when groups have only one rate', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const onSelect = vi.fn();
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[staticGroup]}
        selectedRateId={null}
        onRateSelect={onSelect}
        loading={false}
      />,
    );
    // Single rate = auto-selected, no picker needed
    expect(container.querySelectorAll('[data-rate-id]')).toHaveLength(0);
  });

  it('renders rate options when multiple rates exist', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const onSelect = vi.fn();
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[mixedGroup]}
        selectedRateId={null}
        onRateSelect={onSelect}
        loading={false}
      />,
    );
    expect(container.querySelectorAll('[data-rate-id]')).toHaveLength(2);
    expect(container.textContent).toContain('Standard Delivery');
    expect(container.textContent).toContain('Uber Direct');
  });

  it('calls onRateSelect when a rate is clicked', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const onSelect = vi.fn();
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[mixedGroup]}
        selectedRateId={null}
        onRateSelect={onSelect}
        loading={false}
      />,
    );
    const uberRate = container.querySelector('[data-rate-id="rate-uber"]')!;
    fireEvent.click(uberRate);
    expect(onSelect).toHaveBeenCalledWith('grp-1', 'rate-uber');
  });

  it('highlights the selected rate', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[mixedGroup]}
        selectedRateId="rate-uber"
        onRateSelect={vi.fn()}
        loading={false}
      />,
    );
    const uberRate = container.querySelector('[data-rate-id="rate-uber"]')!;
    expect(uberRate.className).toContain('border-primary');
  });

  it('shows expiry indicator for dynamic rates', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[mixedGroup]}
        selectedRateId={null}
        onRateSelect={vi.fn()}
        loading={false}
      />,
    );
    expect(container.textContent).toContain('Price valid for');
  });

  it('shows loading state', async () => {
    const { ShippingRateSelector } = await import('./ShippingRateSelector');
    const { container } = render(
      <ShippingRateSelector
        lang="en"
        currency="EUR"
        groups={[]}
        selectedRateId={null}
        onRateSelect={vi.fn()}
        loading={true}
      />,
    );
    expect(container.textContent).toContain('shippingRateRefreshing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/interactive/checkout/ShippingRateSelector.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement ShippingRateSelector component**

Create `src/components/interactive/checkout/ShippingRateSelector.tsx`:

```tsx
import { t } from '@/i18n/client';
import { formatPrice, langToLocale } from '@/lib/currency';
import type { ShippingGroup, ShippingRate } from '@/types/checkout';

interface Props {
  lang: 'nl' | 'en' | 'de';
  currency: string;
  groups: ShippingGroup[];
  selectedRateId: string | null;
  onRateSelect: (groupId: string, rateId: string) => void;
  loading: boolean;
}

function expiryMinutes(expiresAt: string): number {
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.floor(diff / 60_000));
}

function RateOption({
  rate,
  groupId,
  selected,
  currency,
  locale,
  lang,
  onSelect,
}: {
  rate: ShippingRate;
  groupId: string;
  selected: boolean;
  currency: string;
  locale: string;
  lang: 'nl' | 'en' | 'de';
  onSelect: (groupId: string, rateId: string) => void;
}) {
  const isDynamic = rate.expires_at != null;
  const minutes = isDynamic ? expiryMinutes(rate.expires_at!) : null;

  return (
    <button
      type="button"
      data-rate-id={rate.id}
      onClick={() => onSelect(groupId, rate.id)}
      class={`w-full flex items-center justify-between rounded-lg border p-3 text-left transition-colors ${
        selected
          ? 'border-primary bg-primary/5'
          : 'border-border hover:border-primary/50'
      }`}
    >
      <div>
        <span class="text-sm font-medium text-card-foreground">{rate.name}</span>
        {isDynamic && minutes != null && minutes > 0 && (
          <span class="block text-xs text-muted-foreground mt-0.5">
            {t('shippingRateExpiresSoon', lang, { minutes: String(minutes) })}
          </span>
        )}
      </div>
      <span class="text-sm font-medium text-card-foreground">
        {parseFloat(rate.cost) === 0
          ? t('shippingFree', lang)
          : formatPrice(rate.cost, currency, locale)}
      </span>
    </button>
  );
}

export function ShippingRateSelector({
  lang,
  currency,
  groups,
  selectedRateId,
  onRateSelect,
  loading,
}: Props) {
  if (loading) {
    return (
      <div class="text-sm text-muted-foreground py-2">
        {t('shippingRateRefreshing', lang)}
      </div>
    );
  }

  // Collect all rates across groups (most checkouts have one group)
  const allRates: Array<{ rate: ShippingRate; groupId: string }> = [];
  for (const group of groups) {
    for (const rate of group.available_rates) {
      allRates.push({ rate, groupId: group.id });
    }
  }

  // Don't show picker if there's 0 or 1 rate — nothing to choose
  if (allRates.length <= 1) return null;

  const locale = langToLocale(lang);

  return (
    <div>
      <h3 class="text-sm font-medium text-card-foreground mb-2">
        {t('shippingMethod', lang)}
      </h3>
      <div class="space-y-2">
        {allRates.map(({ rate, groupId }) => (
          <RateOption
            key={rate.id}
            rate={rate}
            groupId={groupId}
            selected={selectedRateId === rate.id}
            currency={currency}
            locale={locale}
            lang={lang}
            onSelect={onRateSelect}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/components/interactive/checkout/ShippingRateSelector.test.tsx`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/interactive/checkout/ShippingRateSelector.tsx src/components/interactive/checkout/ShippingRateSelector.test.tsx
git commit -m "feat(checkout): add ShippingRateSelector component with expiry indicator"
```

---

### Task 5: Wire ShippingRateSelector into CheckoutFormOrchestrator

**Files:**
- Modify: `src/components/interactive/checkout/CheckoutFormOrchestrator.tsx`
- Modify: `src/components/interactive/checkout/CheckoutFormOrchestrator.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `CheckoutFormOrchestrator.test.tsx` — new test section at the end:

```tsx
// Add to mock setup at the top (after existing mocks):
const mockFetchShippingGroups = vi.fn().mockResolvedValue([]);
const mockSelectShippingRate = vi.fn().mockResolvedValue({ ok: true, expired: false });

// Update the checkout-actions mock:
vi.mock('@/stores/checkout-actions', () => ({
  patchDelivery: (...args: unknown[]) => mockPatchDelivery(...args),
  cancelPendingPatch: () => mockCancelPendingPatch(),
  fetchShippingGroups: (...args: unknown[]) => mockFetchShippingGroups(...args),
  selectShippingRate: (...args: unknown[]) => mockSelectShippingRate(...args),
}));

// Add to the beforeEach:
// mockFetchShippingGroups.mockResolvedValue([]);
// mockSelectShippingRate.mockResolvedValue({ ok: true, expired: false });

// New test section:
describe('shipping rate selection', () => {
  it('fetches shipping groups when checkout status becomes delivery_set', async () => {
    $checkout.set({
      id: 'co_test',
      status: 'delivery_set',
      cart_id: 'cart-1',
      merchant_id: 1,
      channel_id: null,
      currency: 'EUR',
      display_currency: 'EUR',
      fx_rate_to_display: '1.00',
      email: 'test@example.com',
      shipping_address: { first_name: 'J', last_name: 'D', street_address_1: 'St 1', city: 'A', postal_code: '1012AB', country_code: 'NL' },
      billing_address: null,
      shipping_method: null,
      payment_method: null,
      payment_status: null,
      line_items: [],
      subtotal: '10.00',
      tax_total: '0.83',
      shipping_cost: '0.00',
      surcharge_total: '0.00',
      display_surcharge_total: '0.00',
      discount_amount: '0.00',
      discount_code: null,
      applied_promotion_id: null,
      promotion_discount_amount: '0.00',
      total: '10.00',
      display_subtotal: '€ 10,00',
      display_tax_total: '€ 0,83',
      display_shipping_cost: '€ 0,00',
      display_discount_amount: '€ 0,00',
      display_promotion_discount_amount: '€ 0,00',
      display_total: '€ 10,00',
      fulfillment_slot_id: null,
      gift_card_details: null,
      order_number: null,
      purpose: 'standard',
      created_at: null,
      updated_at: null,
      available_payment_gateways: null,
    } as any);

    await renderOrchestrator();

    await waitFor(() => {
      expect(mockFetchShippingGroups).toHaveBeenCalledWith('co_test');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/components/interactive/checkout/CheckoutFormOrchestrator.test.tsx`
Expected: FAIL — `fetchShippingGroups` never called (not yet wired).

- [ ] **Step 3: Implement the wiring in CheckoutFormOrchestrator**

Modify `CheckoutFormOrchestrator.tsx`:

**Add imports** (at top):

```typescript
import { fetchShippingGroups, selectShippingRate } from '@/stores/checkout-actions';
import { $shippingGroups, $shippingGroupsLoading } from '@/stores/checkout';
import { ShippingRateSelector } from './ShippingRateSelector';
import type { ShippingGroup } from '@/types/checkout';
```

**Add state hooks** (inside the component, after existing `useState` calls):

```typescript
const shippingGroups = useStore($shippingGroups);
const shippingGroupsLoading = useStore($shippingGroupsLoading);
```

**Add effect to fetch shipping groups when checkout reaches `delivery_set`** (after the auto-PATCH effect):

```typescript
// ── Fetch shipping groups when delivery is set ──────────────
// Triggers when checkout transitions to delivery_set (address saved).
// Re-fetches when address changes (checkout updates from PATCH response).
useEffect(() => {
  if (!checkout?.id) return;
  if (checkout.status === 'created') return; // address not set yet

  fetchShippingGroups(checkout.id);
}, [checkout?.id, checkout?.status, checkout?.shipping_address?.postal_code]);
```

**Add rate selection handler** (after the fetchTimeSlots callback):

```typescript
const handleRateSelect = useCallback(
  async (groupId: string, rateId: string) => {
    if (!checkoutId) return;

    dispatch({ type: 'SET_FIELD', field: 'selectedShippingRateId', value: rateId });

    const result = await selectShippingRate(checkoutId, groupId, rateId);

    if (result.expired) {
      // Rate expired — re-fetch shipping groups for fresh quotes
      dispatch({ type: 'SET_FIELD', field: 'selectedShippingRateId', value: null });
      await fetchShippingGroups(checkoutId);
      showToast(t('shippingRateExpired', lang), 'warning');
      return;
    }

    if (!result.ok) {
      dispatch({ type: 'SET_FIELD', field: 'selectedShippingRateId', value: null });
      return;
    }

    // Re-fetch checkout to get updated shipping_cost
    const { fetchCheckout } = await import('@/stores/checkout-actions');
    await fetchCheckout(checkoutId);
  },
  [checkoutId, lang, dispatch],
);
```

Add the `showToast` import at the top:

```typescript
import { showToast } from '@/stores/toast';
```

**Add ShippingRateSelector to JSX** — insert between the delivery address/pickup section and the SchedulingPicker:

```tsx
{/* Shipping rate selection (visible only for delivery with multiple rates) */}
{form.fulfillmentMethod === 'delivery' && (
  <div class="px-4 py-3">
    <ShippingRateSelector
      lang={lang}
      currency={checkout?.currency ?? 'EUR'}
      groups={shippingGroups}
      selectedRateId={form.selectedShippingRateId}
      onRateSelect={handleRateSelect}
      loading={shippingGroupsLoading}
    />
  </div>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/components/interactive/checkout/CheckoutFormOrchestrator.test.tsx`
Expected: PASS (existing tests + new shipping rate test)

- [ ] **Step 5: Commit**

```bash
git add src/components/interactive/checkout/CheckoutFormOrchestrator.tsx src/components/interactive/checkout/CheckoutFormOrchestrator.test.tsx
git commit -m "feat(checkout): wire ShippingRateSelector into checkout form orchestrator"
```

---

### Task 6: Update mock API for E2E tests

**Files:**
- Modify: `e2e/helpers/mock-api.ts`

- [ ] **Step 1: Update the shipping groups endpoint path**

In `e2e/helpers/mock-api.ts`, find the shipping groups handler (line ~727):

```typescript
// BEFORE:
const checkoutShippingMatch = path.match(/^\/api\/v1\/checkout\/([^/]+)\/shipping\/$/);

// AFTER:
const checkoutShippingMatch = path.match(/^\/api\/v1\/checkout\/([^/]+)\/shipping-groups\/$/);
```

- [ ] **Step 2: Add Uber Direct rate to the shipping groups response**

Update the response body in the same handler to include an Uber Direct rate:

```typescript
if (method === 'GET' && checkoutShippingMatch) {
  const id = checkoutShippingMatch[1];
  const checkout = checkoutStates.get(id);
  if (!checkout) {
    notFound(res);
    return;
  }
  // Generate a 15-minute expiry for Uber Direct rate
  const uberExpiry = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  json(res, [
    {
      id: 'grp-1',
      merchant_shipping_provider_id: 1,
      shipping_cost: '5.00',
      selected_rate_id: null,
      is_digital: false,
      available_rates: [
        {
          id: 'rate-local',
          name: 'Local Delivery',
          cost: '5.00',
          original_cost: '5.00',
          rate_id: 'local_delivery',
          expires_at: null,
        },
        {
          id: 'rate-uber',
          name: 'Uber Direct',
          cost: '6.50',
          original_cost: '6.50',
          rate_id: 'dqt_mock_quote_id',
          expires_at: uberExpiry,
        },
      ],
      line_items: [],
    },
  ]);
  return;
}
```

- [ ] **Step 3: Add select-rate endpoint handler**

Add after the shipping groups handler (before the payment gateways handler):

```typescript
// ── Checkout: select shipping rate ──
const selectRateMatch = path.match(
  /^\/api\/v1\/checkout\/([^/]+)\/shipping-groups\/select-rate\/$/,
);
if (method === 'POST' && selectRateMatch) {
  const id = selectRateMatch[1];
  const checkout = checkoutStates.get(id);
  if (!checkout) {
    notFound(res);
    return;
  }
  const body = JSON.parse(await readBody(req));
  const { rate_id } = body;

  // Simulate expired rate if rate_id starts with 'expired_'
  if (rate_id === 'expired_rate') {
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'shipping_rate_expired', message: 'Rate has expired' } }));
    return;
  }

  // Apply selected rate cost to checkout
  const rateCost = rate_id === 'dqt_mock_quote_id' ? '6.50' : '5.00';
  checkout.shipping_cost = rateCost;
  const subtotal = parseFloat(checkout.subtotal);
  const discount = parseFloat(checkout.discount_amount);
  checkout.total = (subtotal + parseFloat(rateCost) - discount).toFixed(2);

  json(res, { status: 'ok', selected_rate_id: rate_id });
  return;
}
```

- [ ] **Step 4: Update the time-slots fetch in CheckoutFormOrchestrator**

The `fetchTimeSlots` callback in `CheckoutFormOrchestrator.tsx` currently calls `GET /api/v1/checkout/{checkout_id}/shipping/` to get the `merchant_shipping_provider_id`. Update this to use the `$shippingGroups` atom instead:

```typescript
// BEFORE (inside fetchTimeSlots):
const { data: shippingData } = await client.GET(
  '/api/v1/checkout/{checkout_id}/shipping/',
  { params: { path: { checkout_id: checkoutId } } },
);
const groups = shippingData as unknown as Array<{
  merchant_shipping_provider_id?: number;
}> | null;
const mspId = groups?.[0]?.merchant_shipping_provider_id;

// AFTER:
const groups = $shippingGroups.get();
const mspId = groups[0]?.merchant_shipping_provider_id;
```

This avoids a redundant API call since shipping groups are already fetched.

- [ ] **Step 5: Commit**

```bash
git add e2e/helpers/mock-api.ts src/components/interactive/checkout/CheckoutFormOrchestrator.tsx
git commit -m "feat(e2e): update mock API for shipping-groups + select-rate + Uber Direct"
```

---

### Task 7: Add E2E test for shipping rate selection

**Files:**
- Modify: `e2e/checkout.spec.ts` (or create `e2e/shipping-rates.spec.ts` if checkout.spec.ts is already large)

- [ ] **Step 1: Write the E2E test**

Add a new test to validate the shipping rate selection flow:

```typescript
test('user can select Uber Direct shipping rate', async ({ page }) => {
  await resetMockApi(page);
  await addProductToCart(page);
  await page.goto(`/${LANG}/checkout`);
  await waitForHydration(page);

  // Fill in contact info
  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('input[name="firstName"]', 'Test');
  await page.fill('input[name="lastName"]', 'User');
  await page.fill('input[name="phone"]', '+31612345678');

  // Fill in delivery address
  await page.fill('#checkout-street', 'Keizersgracht 1');
  await page.fill('#checkout-city', 'Amsterdam');
  await page.fill('#checkout-postalCode', '1012AB');

  // Blur to trigger delivery PATCH
  await page.locator('#checkout-postalCode').blur();

  // Wait for shipping rates to appear
  await expect(page.locator('[data-rate-id="rate-local"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-rate-id="rate-uber"]')).toBeVisible();

  // Verify both rates are shown with prices
  await expect(page.locator('[data-rate-id="rate-local"]')).toContainText('Local Delivery');
  await expect(page.locator('[data-rate-id="rate-uber"]')).toContainText('Uber Direct');

  // Select Uber Direct
  await page.locator('[data-rate-id="rate-uber"]').click();

  // Verify it's highlighted (selected state)
  await expect(page.locator('[data-rate-id="rate-uber"]')).toHaveClass(/border-primary/);

  // Verify Uber Direct rate shows expiry indicator
  await expect(page.locator('[data-rate-id="rate-uber"]')).toContainText('Price valid for');
});
```

- [ ] **Step 2: Run the E2E test**

Run: `npx playwright test e2e/shipping-rates.spec.ts --headed` (or the file where you added the test)
Expected: PASS — rates appear after address entry, Uber Direct is selectable with expiry indicator.

- [ ] **Step 3: Commit**

```bash
git add e2e/shipping-rates.spec.ts  # or e2e/checkout.spec.ts
git commit -m "test(e2e): add shipping rate selection E2E test with Uber Direct"
```

---

### Task 8: Run full test suite and verify bundle size

**Files:** None (verification only)

- [ ] **Step 1: Run unit tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 2: Run E2E tests**

Run: `pnpm test:e2e`
Expected: All tests pass (including new shipping rate test).

- [ ] **Step 3: Run type checking**

Run: `pnpm check`
Expected: No type errors.

- [ ] **Step 4: Check bundle size**

Run: `pnpm size:check`
Expected: Under 65 KB gzipped budget. `ShippingRateSelector` is lightweight (no new dependencies).

- [ ] **Step 5: Final commit if any fixes needed**

If any test or lint fixes were needed, commit them here.

---

## Notes for Implementation

1. **SDK path types:** The `/shipping-groups/` and `/select-rate/` paths may not be in the current SDK types. The backend will regenerate the SDK after PR #70 merges. Until then, use `as any` with `eslint-disable` justification on the path literal. Track this in a comment so it's easy to clean up.

2. **Single-rate auto-select:** When only one rate exists (no Uber Direct), `ShippingRateSelector` renders nothing. The existing flow (backend auto-assigns shipping method) continues to work unchanged.

3. **Postcode-only stage:** If Uber Direct fails at the postcode stage, it simply won't appear in the rates. The component handles this gracefully — fewer rates = no error.

4. **Re-fetch on address change:** The effect in Task 5 watches `checkout.shipping_address.postal_code`, so changing the address triggers a fresh shipping groups fetch (with new Uber quotes).
