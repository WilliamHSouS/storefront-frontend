# Checkout Flow Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the checkout flow for production readiness — reduce API round-trips, improve reliability, decompose the 749-line CheckoutPage into focused components, and add structured error recovery.

**Architecture:** Extract CheckoutPage into an orchestrator + three focused sub-components (CheckoutPaymentSection, CheckoutFormOrchestrator, CheckoutPlaceOrder) communicating via nanostores. Preload Stripe.js using eager gateway config from checkout creation. Add `cancelPendingPatch()` for debounce cleanup and `$storageAvailable` for SessionStorage resilience. All `as any` SDK casts will be removed after SDK regeneration (blocked on backend OpenAPI regen — implement with casts for now, remove in a follow-up task).

**Tech Stack:** Preact + Nanostores + Astro 5 SSR, Stripe.js, Vitest (unit), Playwright (e2e)

**Spec:** `docs/superpowers/specs/2026-03-22-checkout-optimization-design.md`

---

## File Structure

### New files

| File                                                                    | Responsibility                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/components/interactive/checkout/CheckoutPaymentSection.tsx`        | Stripe preload, `initiatePayment` on `delivery_set`, Payment Element rendering |
| `src/components/interactive/checkout/CheckoutFormOrchestrator.tsx`      | Blur → validate → PATCH cycle, wraps form sub-components                       |
| `src/components/interactive/checkout/CheckoutPlaceOrder.tsx`            | Form validation, Stripe confirm, place order button (desktop + mobile)         |
| `src/stores/checkout-payment.ts`                                        | `$stripePayment` atom + `$storageAvailable` atom                               |
| `src/components/interactive/checkout/CheckoutPaymentSection.test.tsx`   | Unit tests for payment section                                                 |
| `src/components/interactive/checkout/CheckoutFormOrchestrator.test.tsx` | Unit tests for form orchestrator                                               |
| `src/components/interactive/checkout/CheckoutPlaceOrder.test.tsx`       | Unit tests for place order                                                     |
| `e2e/checkout-recovery.spec.ts`                                         | E2E tests for error recovery flows (storage toast, payment retry, stale cart)  |

### Modified files

| File                                                             | Changes                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/components/interactive/CheckoutPage.tsx` (749 → ~150 lines) | Extract logic into sub-components, keep as orchestrator               |
| `src/stores/checkout-actions.ts` (335 lines)                     | Add `cancelPendingPatch()`, add auto-retry for PATCH network errors   |
| `src/stores/checkout.ts` (134 lines)                             | Add `$storageAvailable` atom (or in new `checkout-payment.ts`)        |
| `src/i18n/messages/en.json`                                      | Add `storageUnavailable` key                                          |
| `src/i18n/messages/nl.json`                                      | Add `storageUnavailable` key                                          |
| `src/i18n/messages/de.json`                                      | Add `storageUnavailable` key                                          |
| `e2e/helpers/mock-api.ts`                                        | Update `POST /checkout/` to return eager `available_payment_gateways` |
| `src/stores/checkout-actions.test.ts` (387 lines)                | Add `cancelPendingPatch()` tests                                      |
| `src/stores/checkout.test.ts` (339 lines)                        | Add `$storageAvailable` tests                                         |
| `e2e/checkout-flow.spec.ts` (832 lines)                          | Update for eager gateways in mock                                     |

---

## Task 1: Add `$stripePayment` atom and `$storageAvailable` atom

**Files:**

- Create: `src/stores/checkout-payment.ts`
- Test: `src/stores/checkout.test.ts` (add to existing)

These atoms are the communication backbone for the new components. `$stripePayment` lets `CheckoutPaymentSection` share Stripe instances with `CheckoutPlaceOrder` without prop drilling. `$storageAvailable` provides a one-time check for SessionStorage availability.

- [ ] **Step 1: Write failing tests for both atoms**

Add to `src/stores/checkout.test.ts`:

```typescript
import {
  $stripePayment,
  $storageAvailable,
  checkStorageAvailable,
} from '@/stores/checkout-payment';

describe('$stripePayment', () => {
  it('starts as null', () => {
    expect($stripePayment.get()).toBeNull();
  });

  it('stores stripe, elements, and clientSecret', () => {
    const mockStripe = { confirmPayment: vi.fn() };
    const mockElements = { getElement: vi.fn() };
    $stripePayment.set({
      stripe: mockStripe as any,
      elements: mockElements as any,
      clientSecret: 'pi_test_secret',
    });
    const val = $stripePayment.get();
    expect(val?.clientSecret).toBe('pi_test_secret');
    expect(val?.stripe).toBe(mockStripe);
    $stripePayment.set(null);
  });
});

describe('$storageAvailable / checkStorageAvailable', () => {
  it('returns true when sessionStorage works', () => {
    expect(checkStorageAvailable()).toBe(true);
    expect($storageAvailable.get()).toBe(true);
  });

  it('returns false when sessionStorage throws', () => {
    const original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, 'sessionStorage', {
      get: () => {
        throw new Error('blocked');
      },
      configurable: true,
    });
    expect(checkStorageAvailable()).toBe(false);
    expect($storageAvailable.get()).toBe(false);
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: original,
      configurable: true,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/stores/checkout.test.ts --reporter=verbose`
Expected: FAIL — `$stripePayment` and `checkStorageAvailable` not found

- [ ] **Step 3: Implement the atoms**

Create `src/stores/checkout-payment.ts`:

```typescript
import { atom } from 'nanostores';
import type { Stripe, StripeElements } from '@stripe/stripe-js';
import * as log from '@/lib/logger';

// ── Stripe payment state (shared between CheckoutPaymentSection and CheckoutPlaceOrder) ──

export interface StripePaymentState {
  stripe: Stripe;
  elements: StripeElements;
  clientSecret: string;
}

export const $stripePayment = atom<StripePaymentState | null>(null);

// ── SessionStorage availability ──────────────────────────────────────────────

export const $storageAvailable = atom<boolean>(true);

export function checkStorageAvailable(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const key = '__sous_storage_test__';
    sessionStorage.setItem(key, '1');
    sessionStorage.removeItem(key);
    $storageAvailable.set(true);
    return true;
  } catch {
    log.warn('checkout', 'sessionStorage unavailable — form state will not persist');
    $storageAvailable.set(false);
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/stores/checkout.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/checkout-payment.ts src/stores/checkout.test.ts
git commit -m "feat(checkout): add \$stripePayment and \$storageAvailable atoms"
```

---

## Task 2: Add `cancelPendingPatch()` to checkout-actions

**Files:**

- Modify: `src/stores/checkout-actions.ts:50-124`
- Test: `src/stores/checkout-actions.test.ts` (add to existing)

Export a function to cancel any pending debounced PATCH and abort in-flight requests. This prevents the timer firing into a detached scope after component unmount.

- [ ] **Step 1: Write failing test**

Add to `src/stores/checkout-actions.test.ts`:

```typescript
import { cancelPendingPatch } from '@/stores/checkout-actions';

describe('cancelPendingPatch', () => {
  it('is exported as a function', () => {
    expect(typeof cancelPendingPatch).toBe('function');
  });

  it('cancels a pending debounced PATCH', async () => {
    // Start a PATCH that would fire after 500ms
    patchDelivery('test-checkout-id', { email: 'test@test.com' }, mockClient);
    // Cancel before it fires
    cancelPendingPatch();
    // Wait past the debounce window
    await new Promise((r) => setTimeout(r, 600));
    // The mock client should NOT have been called
    expect(mockClient.PATCH).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/stores/checkout-actions.test.ts --reporter=verbose`
Expected: FAIL — `cancelPendingPatch` not exported

- [ ] **Step 3: Implement `cancelPendingPatch()`**

Add to `src/stores/checkout-actions.ts` after line 56 (after `const PATCH_DEBOUNCE_MS = 500;`):

```typescript
/**
 * Cancel any pending debounced PATCH and abort any in-flight request.
 * Call this in component cleanup effects to prevent detached timers.
 */
export function cancelPendingPatch(): void {
  if (patchTimer != null) {
    clearTimeout(patchTimer);
    patchTimer = null;
  }
  if (patchAbort) {
    patchAbort.abort();
    patchAbort = null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/stores/checkout-actions.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/checkout-actions.ts src/stores/checkout-actions.test.ts
git commit -m "feat(checkout): add cancelPendingPatch for debounce cleanup on unmount"
```

---

## Task 3: Add auto-retry for PATCH network errors

**Files:**

- Modify: `src/stores/checkout-actions.ts:79-124` (the `patchDelivery` setTimeout callback)
- Test: `src/stores/checkout-actions.test.ts`

Add a single silent retry for network errors in `patchDelivery`. If the retry also fails, set the error as before.

- [ ] **Step 1: Write failing test**

Add to `src/stores/checkout-actions.test.ts`:

```typescript
describe('patchDelivery network retry', () => {
  it('retries once on network error then succeeds', async () => {
    const failThenSucceed = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ data: { id: 'co_1', status: 'delivery_set' }, error: null });
    const retryClient = { PATCH: failThenSucceed } as any;

    patchDelivery('co_1', { email: 'test@test.com' }, retryClient);
    await new Promise((r) => setTimeout(r, 700));

    expect(failThenSucceed).toHaveBeenCalledTimes(2);
    expect($checkoutError.get()).toBeNull();
  });

  it('sets error after retry also fails', async () => {
    const alwaysFail = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const failClient = { PATCH: alwaysFail } as any;

    patchDelivery('co_1', { email: 'test@test.com' }, failClient);
    await new Promise((r) => setTimeout(r, 700));

    expect(alwaysFail).toHaveBeenCalledTimes(2);
    expect($checkoutError.get()).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/stores/checkout-actions.test.ts --reporter=verbose`
Expected: FAIL — only 1 call, no retry

- [ ] **Step 3: Implement retry logic in patchDelivery**

In `src/stores/checkout-actions.ts`, modify the `catch` block inside `patchDelivery`'s setTimeout (around line 113-123). Replace the existing catch with:

Add a `let retried = false` at the top of the setTimeout callback (after `patchTimer = null;`). Then replace the existing catch block with:

```typescript
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      if (generation !== patchGeneration) return;

      // Auto-retry once for network errors (TypeError = fetch failed)
      if (!retried && err instanceof TypeError) {
        retried = true;
        log.warn('checkout', 'patchDelivery network error, retrying once');
        try {
          const retryResult = await sdk.PATCH(
            '/api/v1/checkout/{checkout_id}/delivery/',
            {
              params: { path: { checkout_id: checkoutId } },
              body: data,
              signal: controller.signal,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opts shape bridges local RequestOptions to SDK per-path type
            } as any,
          );
          if (generation !== patchGeneration) return;
          if (retryResult.error || !retryResult.data) {
            const detail = errorDetail(retryResult.error);
            $checkoutError.set(detail);
            log.error('checkout', 'patchDelivery retry failed:', detail);
            return;
          }
          $checkout.set(retryResult.data as unknown as Checkout);
          $checkoutError.set(null);
          return;
        } catch (retryErr) {
          if ((retryErr as Error).name === 'AbortError') return;
          if (generation !== patchGeneration) return;
          // Fall through to set error
        }
      }

      const detail = errorDetail(err);
      $checkoutError.set(detail);
      log.error('checkout', 'patchDelivery failed:', detail);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/stores/checkout-actions.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/checkout-actions.ts src/stores/checkout-actions.test.ts
git commit -m "feat(checkout): auto-retry patchDelivery once on network error"
```

---

## Task 4: Add i18n keys for new UI strings

**Files:**

- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/nl.json`
- Modify: `src/i18n/messages/de.json`

Add keys needed by the new components: `storageUnavailable`, `paymentRetry`, `cartUpdated`.

- [ ] **Step 1: Add keys to all three locale files**

Add to `en.json`:

```json
"storageUnavailable": "Your browser doesn't support saving form progress. Please complete checkout in one session.",
"paymentRetry": "Payment failed. Please try again.",
"cartUpdated": "Your cart was updated."
```

Add to `nl.json`:

```json
"storageUnavailable": "Je browser ondersteunt het opslaan van formuliervoortgang niet. Rond de bestelling af in één sessie.",
"paymentRetry": "Betaling mislukt. Probeer het opnieuw.",
"cartUpdated": "Je winkelwagen is bijgewerkt."
```

Add to `de.json`:

```json
"storageUnavailable": "Ihr Browser unterstützt das Speichern des Formularverlaufs nicht. Bitte schließen Sie den Checkout in einer Sitzung ab.",
"paymentRetry": "Zahlung fehlgeschlagen. Bitte versuchen Sie es erneut.",
"cartUpdated": "Ihr Warenkorb wurde aktualisiert."
```

- [ ] **Step 2: Run type check to verify keys compile**

Run: `pnpm check`
Expected: No errors related to i18n

- [ ] **Step 3: Commit**

```bash
git add src/i18n/messages/en.json src/i18n/messages/nl.json src/i18n/messages/de.json
git commit -m "feat(i18n): add checkout error recovery translation keys"
```

---

## Task 5: Extract `CheckoutFormOrchestrator`

**Files:**

- Create: `src/components/interactive/checkout/CheckoutFormOrchestrator.tsx`
- Modify: `src/components/interactive/CheckoutPage.tsx`
- Create: `src/components/interactive/checkout/CheckoutFormOrchestrator.test.tsx`

Extract the blur → validate → PATCH cycle from CheckoutPage (lines 310-398), the fulfillment method/pickup location auto-PATCH effect (lines 380-398), the pickup locations fetch (lines 169-203), the available fulfillment derivation (lines 240-249), and the time slots fetch (lines 252-301). This component wraps ContactForm, FulfillmentToggle, DeliveryAddressForm, PickupLocationPicker, and SchedulingPicker.

- [ ] **Step 1: Write failing test for the orchestrator**

Create `src/components/interactive/checkout/CheckoutFormOrchestrator.test.tsx`:

```typescript
import { render } from '@testing-library/preact';
import { describe, it, expect, vi } from 'vitest';

describe('CheckoutFormOrchestrator', () => {
  it('can be imported', async () => {
    const mod = await import('./CheckoutFormOrchestrator');
    expect(mod.default).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/interactive/checkout/CheckoutFormOrchestrator.test.tsx --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Create `CheckoutFormOrchestrator.tsx`**

Extract from `CheckoutPage.tsx`:

- The `EMAIL_RE` constant and `validateFieldsForPatch` callback
- The `handleBlur` callback (builds `deliveryData`, calls `patchDelivery`)
- The auto-PATCH effect for fulfillment/pickup changes
- The pickup locations fetch effect
- The available fulfillment derivation effect
- The time slots fetch callback
- Calls `cancelPendingPatch()` in cleanup effect

The component receives these props:

```typescript
interface CheckoutFormOrchestratorProps {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  formErrors: Record<string, string>;
  setFormErrors: (errors: Record<string, string>) => void;
  checkoutId: string | undefined;
  merchantSlug: string | undefined;
}
```

It renders: ContactForm, FulfillmentToggle (conditionally), DeliveryAddressForm (for delivery), PickupLocationPicker (for pickup), SchedulingPicker.

**Key:** The `fulfillmentMethod → fulfillment_type` mapping lives here:

```typescript
const fulfillmentType = form.fulfillmentMethod === 'pickup' ? 'pickup' : 'local_delivery';
```

**Key:** Call `cancelPendingPatch()` in the cleanup effect:

```typescript
useEffect(() => {
  return () => cancelPendingPatch();
}, []);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/interactive/checkout/CheckoutFormOrchestrator.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Update `CheckoutPage.tsx` to use `CheckoutFormOrchestrator`**

Replace the extracted logic in CheckoutPage with:

```tsx
<CheckoutFormOrchestrator
  lang={typedLang}
  form={form}
  dispatch={dispatch}
  formErrors={formErrors}
  setFormErrors={setFormErrors}
  checkoutId={checkout?.id}
  merchantSlug={merchant?.slug}
/>
```

Remove the now-unused imports and state: `pickupLocations`, `availableFulfillment`, `timeSlots`, `timeSlotsLoading`, `fetchTimeSlots`, `handleBlur`, `validateFieldsForPatch`, the auto-PATCH effect, the pickup fetch effect, the fulfillment derivation effect, `EMAIL_RE`.

- [ ] **Step 6: Run existing tests to verify no regression**

Run: `pnpm test -- --reporter=verbose`
Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/interactive/checkout/CheckoutFormOrchestrator.tsx \
  src/components/interactive/checkout/CheckoutFormOrchestrator.test.tsx \
  src/components/interactive/CheckoutPage.tsx
git commit -m "refactor(checkout): extract CheckoutFormOrchestrator from CheckoutPage"
```

---

## Task 6: Extract `CheckoutPaymentSection`

**Files:**

- Create: `src/components/interactive/checkout/CheckoutPaymentSection.tsx`
- Modify: `src/components/interactive/CheckoutPage.tsx`
- Create: `src/components/interactive/checkout/CheckoutPaymentSection.test.tsx`

Extract the Stripe payment logic: the `delivery_set` watcher effect (lines 415-444), the StripePaymentForm render (lines 662-687), and the ExpressCheckout render. Add Stripe.js preloading using eager gateway config from checkout creation.

- [ ] **Step 1: Write failing test**

Create `src/components/interactive/checkout/CheckoutPaymentSection.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';

describe('CheckoutPaymentSection', () => {
  it('can be imported', async () => {
    const mod = await import('./CheckoutPaymentSection');
    expect(mod.default).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/interactive/checkout/CheckoutPaymentSection.test.tsx --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Create `CheckoutPaymentSection.tsx`**

The component:

- Reads `$checkout` and `$merchant` from nanostores
- On mount: if `checkout.available_payment_gateways` has a Stripe gateway, preload `loadStripe(publishableKey, { stripeAccount })`
- Watches for `delivery_set` status: calls `initiatePayment()` to get `client_secret`
- Sets `$stripePayment` atom with `{ stripe, elements, clientSecret }` when StripePaymentForm signals `onStripeReady`
- Renders: ExpressCheckout (when Stripe configured), FormDivider, StripePaymentForm
- Uses `mountedRef` guard to prevent double-init in strict mode
- Manages `stripeConfig` and `expressAvailable` state locally

Props:

```typescript
interface CheckoutPaymentSectionProps {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  currency: string;
  cartId: string;
  cartTotal: string;
  merchantName: string;
  merchantTheme?: { primary?: string; background?: string; foreground?: string; radius?: string };
  onError?: (msg: string) => void;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/interactive/checkout/CheckoutPaymentSection.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Update `CheckoutPage.tsx` to use `CheckoutPaymentSection`**

Replace the Stripe-related state (`stripeConfig`, `expressAvailable`, `stripeRef`, `elementsRef`), the `initiatePayment` effect, and the StripePaymentForm/ExpressCheckout render block with:

```tsx
<CheckoutPaymentSection
  lang={typedLang}
  form={form}
  currency={currency}
  cartId={cart?.id ?? ''}
  cartTotal={cartTotal}
  merchantName={merchant.name}
  merchantTheme={merchant.theme}
  onError={(msg) => $checkoutError.set(msg)}
/>
```

- [ ] **Step 6: Run all tests**

Run: `pnpm test -- --reporter=verbose`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/interactive/checkout/CheckoutPaymentSection.tsx \
  src/components/interactive/checkout/CheckoutPaymentSection.test.tsx \
  src/components/interactive/CheckoutPage.tsx
git commit -m "refactor(checkout): extract CheckoutPaymentSection with Stripe preload"
```

---

## Task 7: Extract `CheckoutPlaceOrder`

**Files:**

- Create: `src/components/interactive/checkout/CheckoutPlaceOrder.tsx`
- Modify: `src/components/interactive/CheckoutPage.tsx`
- Create: `src/components/interactive/checkout/CheckoutPlaceOrder.test.tsx`

Extract form validation, Stripe confirm, and place order logic (lines 447-533 + 693-725 + 740-745 from CheckoutPage).

- [ ] **Step 1: Write failing test**

Create `src/components/interactive/checkout/CheckoutPlaceOrder.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';

describe('CheckoutPlaceOrder', () => {
  it('can be imported', async () => {
    const mod = await import('./CheckoutPlaceOrder');
    expect(mod.default).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/interactive/checkout/CheckoutPlaceOrder.test.tsx --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Create `CheckoutPlaceOrder.tsx`**

The component:

- Reads `$stripePayment` atom for Stripe instances
- Reads `$checkout`, `$checkoutLoading` from nanostores
- Owns `validateForm()` — full form validation with `setFormErrors` callback
- Owns `handlePlaceOrder()` — Stripe confirm + ensurePaymentAndComplete / completeCheckout
- On error: scrolls to `[role="alert"]` and adds brief shake animation to button
- Renders: desktop button (hidden md:block) + PlaceOrderButton (mobile sticky CTA)

Props:

```typescript
interface CheckoutPlaceOrderProps {
  lang: 'nl' | 'en' | 'de';
  currency: string;
  form: CheckoutFormState;
  setFormErrors: (errors: Record<string, string>) => void;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/interactive/checkout/CheckoutPlaceOrder.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Update `CheckoutPage.tsx` to use `CheckoutPlaceOrder`**

Replace `validateForm`, `handlePlaceOrder`, the desktop button, and `PlaceOrderButton` with:

```tsx
<CheckoutPlaceOrder
  lang={typedLang}
  currency={currency}
  form={form}
  setFormErrors={setFormErrors}
/>
```

Remove: `isSubmitting` state, `handlePlaceOrder` callback, `validateForm` function.

- [ ] **Step 6: Verify CheckoutPage is now ~150 lines**

Run: `wc -l src/components/interactive/CheckoutPage.tsx`
Expected: ~120-170 lines

- [ ] **Step 7: Run all tests**

Run: `pnpm test -- --reporter=verbose`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add src/components/interactive/checkout/CheckoutPlaceOrder.tsx \
  src/components/interactive/checkout/CheckoutPlaceOrder.test.tsx \
  src/components/interactive/CheckoutPage.tsx
git commit -m "refactor(checkout): extract CheckoutPlaceOrder, complete component decomposition"
```

---

## Task 8: Structured error recovery in `CheckoutPaymentSection`

**Files:**

- Modify: `src/components/interactive/checkout/CheckoutPaymentSection.tsx`
- Modify: `src/components/interactive/checkout/CheckoutPaymentSection.test.tsx`

Add retry buttons for payment init failure and Stripe load error. Show inline error messages in the payment section instead of relying solely on the top-level error banner.

- [ ] **Step 1: Write failing test for retry behavior**

Add to `CheckoutPaymentSection.test.tsx`:

```typescript
describe('error recovery', () => {
  it('shows retry button when initiatePayment fails', () => {
    // Mock initiatePayment to reject
    // Render component with delivery_set checkout
    // Expect retry button to be present
    // Click retry → expect initiatePayment called again
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/interactive/checkout/CheckoutPaymentSection.test.tsx --reporter=verbose`
Expected: FAIL

- [ ] **Step 3: Implement retry logic**

In `CheckoutPaymentSection.tsx`:

- Add `paymentError` local state
- On `initiatePayment` failure: set `paymentError`, render inline error with retry button
- On Stripe `loaderror`: set `paymentError`, render inline error with retry button
- Retry button calls the same initiation logic

```tsx
{
  paymentError && (
    <div class="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive flex items-center justify-between">
      <span>{paymentError}</span>
      <button
        type="button"
        onClick={retryPayment}
        class="ml-3 text-xs font-medium underline hover:no-underline"
      >
        {t('retry', lang)}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/components/interactive/checkout/CheckoutPaymentSection.test.tsx --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/interactive/checkout/CheckoutPaymentSection.tsx \
  src/components/interactive/checkout/CheckoutPaymentSection.test.tsx
git commit -m "feat(checkout): add payment retry with inline error recovery"
```

---

## Task 9: Place order error scroll and shake feedback

**Files:**

- Modify: `src/components/interactive/checkout/CheckoutPlaceOrder.tsx`
- Modify: `src/components/interactive/checkout/CheckoutPlaceOrder.test.tsx`

When `handlePlaceOrder` encounters an error, scroll to the error banner and briefly shake the button.

- [ ] **Step 1: Write failing test**

Add to `CheckoutPlaceOrder.test.tsx`:

```typescript
describe('error feedback', () => {
  it('scrolls to error banner on validation failure', () => {
    // Render with empty required fields
    // Click place order
    // Expect scrollIntoView called on [role="alert"]
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement error scroll + shake**

In the `handlePlaceOrder` catch block and after `validateForm` returns false:

```typescript
// Scroll to error
const errorEl = document.querySelector('[role="alert"]');
errorEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });

// Shake button
const btn = document.querySelector('[data-place-order]');
if (btn) {
  btn.classList.add('animate-shake');
  setTimeout(() => btn.classList.remove('animate-shake'), 500);
}
```

Add `data-place-order` attribute to both desktop and mobile buttons. Add `animate-shake` keyframe to Tailwind config or inline style.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/components/interactive/checkout/CheckoutPlaceOrder.tsx \
  src/components/interactive/checkout/CheckoutPlaceOrder.test.tsx
git commit -m "feat(checkout): add error scroll and button shake on place order failure"
```

---

## Task 10: (merged into Task 12 — mock API updates)

---

## Task 11: Add SessionStorage unavailable toast

**Files:**

- Modify: `src/components/interactive/CheckoutPage.tsx`
- Modify: `src/stores/checkout-payment.ts`

On mount, check `$storageAvailable`. If false, add a toast to `$toasts`.

- [ ] **Step 1: Add toast trigger to CheckoutPage**

In `CheckoutPage.tsx`, after the existing mount effects:

```typescript
import { checkStorageAvailable, $storageAvailable } from '@/stores/checkout-payment';
import { showToast } from '@/stores/toast';

useEffect(() => {
  checkStorageAvailable();
  if (!$storageAvailable.get()) {
    showToast(t('storageUnavailable', typedLang), 'error');
  }
}, []);
```

- [ ] **Step 2: Run tests**

Run: `pnpm test -- --reporter=verbose`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/interactive/CheckoutPage.tsx
git commit -m "feat(checkout): show toast when sessionStorage is unavailable"
```

---

## Task 12: Update mock API — eager gateways + confirm-payment handler

**Files:**

- Modify: `e2e/helpers/mock-api.ts`

The spec requires two mock API updates: (1) `POST /checkout/` returns eager `available_payment_gateways`, and (2) a typed `POST /checkout/{id}/confirm-payment/` handler.

- [ ] **Step 1: Add eager gateways to POST /checkout/ mock**

In the `POST /checkout/` handler (around line 656), add to the response:

```typescript
available_payment_gateways: [
  {
    id: 'stripe',
    name: 'Stripe',
    type: 'stripe',
    config: {
      publishable_key: 'pk_test_mock',
      stripe_account: 'acct_mock',
    },
  },
],
```

- [ ] **Step 2: Verify confirm-payment handler exists and is typed**

Check the existing handler around line 815. Ensure the response matches the spec:

- Success: returns checkout object with `order_number` and `status: 'completed'`
- Error codes: `PAYMENT_NOT_CONFIRMED` (with `details.psp_status`), `GATEWAY_UNAVAILABLE`

Update if needed to match the expected request shape:

```json
{
  "gateway_id": "stripe",
  "payment_intent": "pi_xxx",
  "payment_intent_client_secret": "pi_xxx_secret_xxx"
}
```

- [ ] **Step 3: Run e2e checkout tests to verify no regression**

Run: `npx playwright test e2e/checkout.spec.ts e2e/checkout-flow.spec.ts --reporter=list`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add e2e/helpers/mock-api.ts
git commit -m "test(e2e): update mock API for eager gateways and typed confirm-payment"
```

---

## Task 13: Add e2e recovery tests

**Files:**

- Create: `e2e/checkout-recovery.spec.ts`

Cover the error recovery flows from spec section 4a and 5b.

- [ ] **Step 1: Create `e2e/checkout-recovery.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import { resetMockApi, goToCheckoutWithItem } from './helpers/test-utils';

test.describe('Checkout error recovery', () => {
  test.beforeEach(async ({ page }) => {
    await resetMockApi(page);
  });

  test('shows storage unavailable toast when sessionStorage blocked', async ({ page }) => {
    // Block sessionStorage before navigating
    await page.addInitScript(() => {
      Object.defineProperty(window, 'sessionStorage', {
        get: () => {
          throw new Error('blocked');
        },
      });
    });
    await goToCheckoutWithItem(page);
    // Toast should appear
    await expect(page.locator('[data-toast]')).toContainText(/session/i);
  });
});
```

- [ ] **Step 2: Run the new test**

Run: `npx playwright test e2e/checkout-recovery.spec.ts --reporter=list`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add e2e/checkout-recovery.spec.ts
git commit -m "test(e2e): add checkout error recovery tests"
```

---

## Task 14: Run full test suite and bundle size check

**Files:** None (verification only)

- [ ] **Step 1: Run unit tests**

Run: `pnpm test -- --reporter=verbose`
Expected: All PASS

- [ ] **Step 2: Run e2e tests**

Run: `npx playwright test e2e/checkout.spec.ts e2e/checkout-flow.spec.ts e2e/checkout-security.spec.ts --reporter=list`
Expected: All PASS

- [ ] **Step 3: Run type check**

Run: `pnpm check`
Expected: No errors

- [ ] **Step 4: Run bundle size check**

Run: `pnpm size:check`
Expected: Under 65KB gzipped

- [ ] **Step 5: Run Astro build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 6: Final commit if any formatting/lint changes**

```bash
git add -u && git commit -m "chore: format and lint cleanup after checkout optimization"
```

---

## Task 15 (deferred): Remove `as any` casts after SDK regeneration

**Blocked on:** Backend merging their branch + OpenAPI regen + SDK publish

**Files:**

- Modify: `src/components/interactive/CheckoutSuccess.tsx:63-76`
- Modify: `src/stores/checkout-actions.ts:93-94, 206-207, 238-239`
- Modify: `src/components/interactive/checkout/CheckoutFormOrchestrator.tsx` (pickup-locations, time-slots)
- Modify: `src/types/checkout.ts` (derive types from SDK)

- [ ] **Step 1: Update SDK dep**

Run: `pnpm update @poweredbysous/storefront-sdk`

- [ ] **Step 2: Replace `as any` casts with typed SDK calls**

For each cast in the table (spec section 3a), replace with the SDK path literal and typed params.

- [ ] **Step 3: Derive `Checkout` type from SDK**

In `src/types/checkout.ts`:

```typescript
import type { paths } from '@poweredbysous/storefront-sdk';
export type Checkout =
  paths['/api/v1/checkout/{checkout_id}/']['get']['responses']['200']['content']['application/json'];
```

Remove the manual `Checkout` interface. Keep `CheckoutFormState`, `TimeSlot`, `ShippingRate`, `ShippingGroup` as they are frontend-only types.

- [ ] **Step 4: Remove `as unknown as Checkout` casts**

In `checkout-actions.ts`, the five `data as unknown as Checkout` casts should now be unnecessary since the SDK response type matches.

- [ ] **Step 5: Run `pnpm check` to verify type safety**

- [ ] **Step 6: Run full test suite**

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -m "refactor(checkout): remove as-any casts after SDK regeneration"
```
