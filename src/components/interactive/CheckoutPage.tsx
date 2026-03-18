import { useReducer, useEffect, useCallback, useRef } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $cart, $cartTotal, ensureCart } from '@/stores/cart';
import { $merchant } from '@/stores/merchant';
import { $checkout, $checkoutLoading, persistFormState, restoreFormState } from '@/stores/checkout';
import { createCheckout } from '@/stores/checkout-actions';
import { $addressCoords } from '@/stores/address';
import { formatPrice, langToLocale } from '@/lib/currency';
import { getClient } from '@/lib/api';
import { t } from '@/i18n';
import * as log from '@/lib/logger';
import type { CheckoutFormState } from '@/types/checkout';
import { CheckoutHeader } from './checkout/CheckoutHeader';
import { FormDivider } from './checkout/FormDivider';
import { OrderSummary } from './checkout/OrderSummary';
import { PlaceOrderButton } from './checkout/PlaceOrderButton';

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
  const loading = useStore($checkoutLoading);

  const [form, dispatch] = useReducer(formReducer, INITIAL_FORM_STATE);
  const initializedRef = useRef(false);

  const typedLang = lang as 'nl' | 'en' | 'de';
  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

  // ── Hydration guard ──────────────────────────────────────────────
  // Wait for merchant bridge before rendering anything
  if (!merchant) {
    return <div class="min-h-screen" />;
  }

  // ── Restore form state from sessionStorage on mount ──────────────
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const saved = restoreFormState();
    if (saved) {
      dispatch({ type: 'RESTORE', state: saved });
    }

    // Pre-populate postal code from address store if available
    const coords = $addressCoords.get();
    if (coords?.postalCode && !saved?.postalCode) {
      dispatch({ type: 'SET_FIELD', field: 'postalCode', value: coords.postalCode });
    }
  }, []);

  // ── Ensure cart exists on mount ──────────────────────────────────
  useEffect(() => {
    const client = getClient();
    ensureCart(client).catch((err) => {
      log.error('checkout', 'Failed to ensure cart:', err);
    });
  }, []);

  // ── Create checkout from cart when cart is ready ──────────────────
  useEffect(() => {
    if (!cart?.id || cart.line_items.length === 0) return;
    if (checkout?.cart_id === cart.id) return; // already created for this cart

    createCheckout(cart.id).catch((err) => {
      log.error('checkout', 'Failed to create checkout:', err);
    });
  }, [cart?.id, cart?.line_items.length, checkout?.cart_id]);

  // ── Redirect to menu if cart is empty ────────────────────────────
  useEffect(() => {
    if (cart && cart.line_items.length === 0) {
      window.location.href = `/${lang}/`;
    }
  }, [cart?.line_items.length, lang]);

  // ── Persist form on blur ─────────────────────────────────────────
  const handleBlur = useCallback(() => {
    persistFormState(form);
  }, [form]);

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

  // If cart is empty (redirect pending), show stable wrapper
  if (cart && cart.line_items.length === 0) {
    return <div class="min-h-screen" />;
  }

  // ── Place order handler (placeholder for Task 17) ────────────────
  const handlePlaceOrder = useCallback(() => {
    persistFormState(form);
    log.warn('checkout', 'Place order triggered — payment flow not yet implemented');
  }, [form]);

  return (
    <div class="min-h-screen bg-background">
      <CheckoutHeader lang={typedLang} merchantName={merchant.name} />

      <div class="mx-auto max-w-5xl md:flex md:gap-8 md:px-4 md:py-6">
        {/* ── Left column: form ──────────────────────────────── */}
        {}
        <div class="flex-1 md:max-w-xl" onBlur={handleBlur}>
          {/* Mobile order summary (above form) */}
          <div class="px-4 py-4 md:hidden">
            <OrderSummary lang={typedLang} currency={currency} />
          </div>

          {/* Placeholder for ExpressCheckout (Task 18) */}
          <div class="px-4 py-3 text-muted-foreground text-sm">[Express checkout - Task 18]</div>

          <FormDivider lang={typedLang} visible={true} />

          {/* Placeholder for ContactInfoSection (Task 11) */}
          <div class="px-4 py-3 text-muted-foreground text-sm">[Contact info - Task 11]</div>

          {/* Placeholder for FulfillmentToggle (Task 12) */}
          <div class="px-4 py-3 text-muted-foreground text-sm">[Fulfillment toggle - Task 12]</div>

          {/* Placeholder for AddressSection (Task 13) */}
          <div class="px-4 py-3 text-muted-foreground text-sm">[Delivery address - Task 13]</div>

          {/* Placeholder for SchedulingSection (Task 14) */}
          <div class="px-4 py-3 text-muted-foreground text-sm">[Scheduling - Task 14]</div>

          {/* Placeholder for ShippingRateSelector (Task 15) */}
          <div class="px-4 py-3 text-muted-foreground text-sm">[Shipping rates - Task 15]</div>

          {/* Placeholder for PaymentSection (Task 16) */}
          <div class="px-4 py-3 text-muted-foreground text-sm">[Payment - Task 16]</div>

          {/* Desktop place order button */}
          <div class="hidden md:block px-4 py-6">
            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={loading}
              class={`flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 ${loading ? 'pointer-events-none opacity-50' : ''}`}
            >
              {loading ? (
                <>
                  <svg class="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    />
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  {t('processing', typedLang)}
                </>
              ) : (
                <>
                  {t('placeOrder', typedLang)} — {formatPrice(cartTotal, currency, locale)}
                </>
              )}
            </button>
            <p class="mt-3 text-center text-xs text-muted-foreground">
              {t('privacyNotice', typedLang)}
            </p>
          </div>
        </div>

        {/* ── Right column: sticky order summary (desktop) ───── */}
        <div class="hidden md:block md:w-80 lg:w-96">
          <div class="sticky top-6">
            <OrderSummary lang={typedLang} currency={currency} />
          </div>
        </div>
      </div>

      {/* ── Mobile sticky CTA ────────────────────────────────── */}
      <PlaceOrderButton lang={typedLang} currency={currency} onPlace={handlePlaceOrder} />
    </div>
  );
}
