import { useReducer, useEffect, useRef, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $cart, $cartTotal, ensureCart } from '@/stores/cart';
import { $merchant } from '@/stores/merchant';
import {
  $checkout,
  $checkoutError,
  $checkoutLoading,
  clearStoredCheckoutId,
  getStoredCheckoutId,
  restoreFormState,
} from '@/stores/checkout';
import { checkStorageAvailable, $storageAvailable } from '@/stores/checkout-payment';
import { createCheckout, fetchCheckout, patchDelivery } from '@/stores/checkout-actions';
import { showToast } from '@/stores/toast';
import { $addressCoords } from '@/stores/address';
import { onAddressChange, hydrateAddressFromStorage } from '@/stores/address-actions';
import { getClient } from '@/lib/api';
import { t } from '@/i18n/client';
import * as log from '@/lib/logger';
import type { CheckoutFormState } from '@/types/checkout';
import { CheckoutHeader } from './checkout/CheckoutHeader';
import { OrderSummary } from './checkout/OrderSummary';
import { PrivacyNotice } from './checkout/PrivacyNotice';
import CheckoutFormOrchestrator from './checkout/CheckoutFormOrchestrator';
import CheckoutPaymentSection from './checkout/CheckoutPaymentSection';
import CheckoutPlaceOrder from './checkout/CheckoutPlaceOrder';

/* ------------------------------------------------------------------ */
/*  Form reducer — exported for use by Tasks 11-16                     */
/* ------------------------------------------------------------------ */

export type FormAction =
  | { type: 'SET_FIELD'; field: keyof CheckoutFormState; value: string | number | null }
  | { type: 'SET_FULFILLMENT'; method: 'delivery' | 'pickup' }
  | { type: 'SET_SCHEDULING'; mode: 'asap' | 'scheduled' }
  | { type: 'RESTORE'; state: CheckoutFormState };

export const INITIAL_FORM_STATE: CheckoutFormState = {
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

/* ------------------------------------------------------------------ */
/*  CheckoutPage                                                       */
/* ------------------------------------------------------------------ */

interface Props {
  lang: string;
}

export default function CheckoutPage({ lang }: Props) {
  const merchant = useStore($merchant);
  const cart = useStore($cart);
  const cartTotal = useStore($cartTotal);
  const checkout = useStore($checkout);
  const checkoutLoading = useStore($checkoutLoading);
  const checkoutError = useStore($checkoutError);

  const [form, dispatch] = useReducer(formReducer, INITIAL_FORM_STATE);
  const initializedRef = useRef(false);

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const typedLang = lang as 'nl' | 'en' | 'de';
  const currency = merchant?.currency ?? 'EUR';

  // ── Restore form state + hydrate address on mount ───────────────
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const saved = restoreFormState();
    if (saved) {
      dispatch({ type: 'RESTORE', state: saved });
    }

    // Hydrate $addressCoords from localStorage — AddressBar does this on the
    // home page, but the checkout page hides shared islands (hideSharedIslands=true)
    // so we need to do it here. This also refreshes the cart's shipping estimate.
    hydrateAddressFromStorage().then(() => {
      const coords = $addressCoords.get();
      if (coords?.postalCode && !saved?.postalCode) {
        dispatch({ type: 'SET_FIELD', field: 'postalCode', value: coords.postalCode });
        dispatch({ type: 'SET_FIELD', field: 'countryCode', value: coords.country || 'NL' });
      }
    });
  }, []);

  // ── Pre-populate form from checkout's saved address ─────────────
  // If the checkout has address/contact data but the form is empty (no
  // sessionStorage restore), populate the form so the user doesn't re-type.
  useEffect(() => {
    if (!checkout) return;
    // Only populate if the form is still empty (no user input yet)
    if (form.email || form.firstName) return;

    if (checkout.email) {
      dispatch({ type: 'SET_FIELD', field: 'email', value: checkout.email });
    }
    if (checkout.shipping_address) {
      const addr = checkout.shipping_address;
      if (addr.first_name)
        dispatch({ type: 'SET_FIELD', field: 'firstName', value: addr.first_name });
      if (addr.last_name) dispatch({ type: 'SET_FIELD', field: 'lastName', value: addr.last_name });
      if (addr.phone_number)
        dispatch({ type: 'SET_FIELD', field: 'phone', value: addr.phone_number });
      if (addr.street_address_1)
        dispatch({ type: 'SET_FIELD', field: 'street', value: addr.street_address_1 });
      if (addr.city) dispatch({ type: 'SET_FIELD', field: 'city', value: addr.city });
      if (addr.postal_code)
        dispatch({ type: 'SET_FIELD', field: 'postalCode', value: addr.postal_code });
      if (addr.country_code)
        dispatch({ type: 'SET_FIELD', field: 'countryCode', value: addr.country_code });
    }
  }, [checkout?.id]);

  // ── Ensure cart exists on mount ──────────────────────────────────
  useEffect(() => {
    const client = getClient();
    ensureCart(client).catch((err) => {
      log.error('checkout', 'Failed to ensure cart:', err);
    });
  }, []);

  // ── Check sessionStorage availability ──────────────────────────────
  useEffect(() => {
    checkStorageAvailable();
    if (!$storageAvailable.get()) {
      showToast(t('storageUnavailable', typedLang), 'error');
    }
  }, []);

  // ── Restore existing checkout from sessionStorage on mount ──────
  // If a checkout ID is stored, fetch it before creating a new one.
  // This preserves saved address/contact data from a previous session.
  useEffect(() => {
    const storedId = getStoredCheckoutId();
    if (!storedId || $checkout.get()) return; // no stored ID, or already loaded

    fetchCheckout(storedId).catch((err) => {
      // Checkout expired or invalid — clear and let create-checkout handle it
      log.warn('checkout', 'Failed to restore checkout, will create new:', err);
      clearStoredCheckoutId();
    });
  }, []);

  // ── Create checkout from cart when cart is ready ──────────────────
  useEffect(() => {
    if (!cart?.id || cart.line_items.length === 0) return;
    // Wait for any in-flight fetchCheckout to complete before creating new
    if (checkoutLoading) return;

    // If existing checkout is for this cart and in a usable status, keep it
    if (checkout?.cart_id === cart.id) {
      const usableStatuses = ['created', 'delivery_set', 'shipping_pending'];
      if (usableStatuses.includes(checkout.status)) return;

      // Checkout is in a terminal/unusable state (paid, completed) — clear and create fresh
      log.warn('checkout', `Stale checkout in status '${checkout.status}', creating fresh`);
      clearStoredCheckoutId();
      $checkout.set(null);
    }

    createCheckout(cart.id)
      .then((newCheckout) => {
        if (!newCheckout) return;

        // Immediately PATCH with address context if available, so shipping is calculated from the start
        const coords = $addressCoords.get();
        if (coords?.postalCode) {
          patchDelivery(newCheckout.id, {
            shipping_address: {
              postal_code: coords.postalCode,
              country_code: coords.country ?? 'NL',
            },
          });
        }
      })
      .catch((err) => {
        log.error('checkout', 'Failed to create checkout:', err);
      });
  }, [cart?.id, cart?.line_items.length, checkout?.cart_id, checkout?.status, checkoutLoading]);

  // ── Hydrate address store from checkout's shipping_address ──────
  // If the checkout already has address data (e.g. from a previous session)
  // but $addressCoords is empty, run address-check to get lat/lng and
  // refresh the cart's shipping estimate.
  useEffect(() => {
    if (!checkout?.shipping_address) return;
    if ($addressCoords.get()) return; // already have address data

    const { postal_code, country_code } = checkout.shipping_address;
    if (!postal_code) return;

    onAddressChange({ postalCode: postal_code, country: country_code || 'NL' }).catch((err) => {
      log.warn('checkout', 'Failed to hydrate address from checkout:', err);
    });
  }, [checkout?.shipping_address]);

  // ── Redirect to menu if cart is empty ────────────────────────────
  useEffect(() => {
    if (cart && cart.line_items.length === 0) {
      window.location.href = `/${lang}/`;
    }
  }, [cart?.line_items.length, lang]);

  // ── Cross-tab cart change detection ──────────────────────────────
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'sous_cart_id' && e.newValue !== e.oldValue) {
        // Cart changed in another tab — reload to pick up changes
        window.location.reload();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // ── Hydration guard (after all hooks to satisfy Rules of Hooks) ──
  if (!merchant) {
    return <div class="min-h-screen" />;
  }

  // ── Empty cart guard (redirect pending) ──
  if (cart && cart.line_items.length === 0) {
    return <div class="min-h-screen" />;
  }

  return (
    <div class="min-h-screen bg-background">
      <CheckoutHeader lang={typedLang} merchantName={merchant.name} />

      <div class="md:mx-auto md:max-w-5xl md:flex md:gap-8 md:px-4 md:py-6">
        {/* ── Left column: form ──────────────────────────────── */}
        <div class="flex-1 md:max-w-xl w-full">
          {/* Mobile order summary (above form) */}
          <div class="px-4 py-4 md:hidden">
            <OrderSummary lang={typedLang} currency={currency} />
          </div>

          {/* Error banner */}
          {checkoutError && (
            <div
              class="mx-4 my-2 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              {checkoutError}
            </div>
          )}

          <CheckoutFormOrchestrator
            lang={typedLang}
            form={form}
            dispatch={dispatch}
            formErrors={formErrors}
            setFormErrors={setFormErrors}
            checkoutId={checkout?.id}
            merchantSlug={merchant?.slug}
          />

          <CheckoutPaymentSection
            lang={typedLang}
            form={form}
            currency={currency}
            cartId={cart?.id ?? ''}
            cartTotal={cartTotal}
            merchantName={merchant.name}
            merchantTheme={{
              primary: merchant.theme?.primary,
              background: merchant.theme?.background,
              foreground: merchant.theme?.foreground,
              radius: merchant.theme?.radius,
            }}
            onError={(msg) => {
              log.error('checkout', 'Payment section error:', msg);
            }}
          />

          {/* Privacy notice */}
          <PrivacyNotice lang={typedLang} />

          <CheckoutPlaceOrder
            lang={typedLang}
            currency={currency}
            form={form}
            setFormErrors={setFormErrors}
          />
        </div>

        {/* ── Right column: sticky order summary (desktop) ───── */}
        <div class="hidden md:block md:w-80 lg:w-96">
          <div class="sticky top-6">
            <OrderSummary lang={typedLang} currency={currency} />
          </div>
        </div>
      </div>
    </div>
  );
}
