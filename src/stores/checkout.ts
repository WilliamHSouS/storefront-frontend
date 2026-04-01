import { atom, computed } from 'nanostores';
import type { Checkout, CheckoutFormState } from '@/types/checkout';
import type { CartLineItem } from '@/stores/cart';
import { validateStorageId } from '@/lib/validate-id';
import * as log from '@/lib/logger';

// ── Atoms ──────────────────────────────────────────────────────────────────

export const $checkout = atom<Checkout | null>(null);
export const $checkoutLoading = atom(false);
export const $checkoutError = atom<string | null>(null);

// ── Computed ───────────────────────────────────────────────────────────────

export const $checkoutTotals = computed($checkout, (checkout) => {
  if (!checkout) {
    return {
      subtotal: '0.00',
      tax: '0.00',
      shipping: '0.00',
      discount: '0.00',
      serviceFees: '0.00',
      total: '0.00',
    };
  }
  return {
    subtotal: checkout.display_subtotal,
    tax: checkout.display_tax_total,
    shipping: checkout.display_shipping_cost,
    discount: checkout.display_discount_amount,
    serviceFees: checkout.display_service_fees_total ?? '0.00',
    total: checkout.display_total,
  };
});

export const $checkoutStatus = computed($checkout, (checkout) => checkout?.status ?? null);

// ── Checkout ID persistence (sessionStorage) ──────────────────────────────

const CHECKOUT_ID_KEY = 'sous_checkout_id';

export function getStoredCheckoutId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const id = sessionStorage.getItem(CHECKOUT_ID_KEY);
    if (id && !validateStorageId(id)) {
      log.warn('checkout', 'Invalid checkout ID format in sessionStorage, clearing');
      clearStoredCheckoutId();
      return null;
    }
    return id;
  } catch (e) {
    log.warn('checkout', 'Failed to read checkout ID from sessionStorage:', e);
    return null;
  }
}

export function setStoredCheckoutId(checkoutId: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CHECKOUT_ID_KEY, checkoutId);
  } catch (e) {
    log.warn('checkout', 'Failed to save checkout ID to sessionStorage:', e);
  }
}

export function clearStoredCheckoutId(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CHECKOUT_ID_KEY);
  } catch (e) {
    log.warn('checkout', 'Failed to clear checkout ID from sessionStorage:', e);
  }
}

// ── Fingerprints ──────────────────────────────────────────────────────────

export function checkoutFingerprint(checkout: Checkout): string {
  return checkout.line_items
    .map((li) => `${String(li.product_id)}:${li.quantity}`)
    .sort()
    .join(',');
}

export function cartFingerprint(lineItems: CartLineItem[]): string {
  return lineItems
    .map((li) => `${String(li.product_id)}:${li.quantity}`)
    .sort()
    .join(',');
}

// ── Form state persistence (sessionStorage) ───────────────────────────────

const FORM_STATE_KEY = 'sous_checkout_form';

export function persistFormState(state: CheckoutFormState): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(FORM_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    log.warn('checkout', 'Failed to persist form state:', e);
  }
}

const FORM_STATE_DEFAULTS: CheckoutFormState = {
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

export function restoreFormState(): CheckoutFormState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(FORM_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return { ...FORM_STATE_DEFAULTS, ...parsed };
  } catch {
    return null;
  }
}

export function clearFormState(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(FORM_STATE_KEY);
  } catch (e) {
    log.warn('checkout', 'Failed to clear form state:', e);
  }
}
