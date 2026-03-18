/* eslint-disable @typescript-eslint/no-explicit-any -- checkout/location endpoints not in OpenAPI spec */
import { useReducer, useEffect, useCallback, useRef, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { useStore } from '@nanostores/preact';
import { $cart, $cartTotal, ensureCart } from '@/stores/cart';
import { $merchant } from '@/stores/merchant';
import {
  $checkout,
  $checkoutLoading,
  $checkoutError,
  persistFormState,
  restoreFormState,
} from '@/stores/checkout';
import {
  createCheckout,
  patchDelivery,
  initiatePayment,
  completeCheckout,
  ensurePaymentAndComplete,
} from '@/stores/checkout-actions';
import { $addressCoords } from '@/stores/address';
import { formatPrice, langToLocale, toCents } from '@/lib/currency';
import { getClient } from '@/lib/api';
import { t } from '@/i18n';
import * as log from '@/lib/logger';
import type { Stripe, StripeElements } from '@stripe/stripe-js';
import type { CheckoutFormState } from '@/types/checkout';
import { CheckoutHeader } from './checkout/CheckoutHeader';
import { ContactForm } from './checkout/ContactForm';
import DeliveryAddressForm from './checkout/DeliveryAddressForm';
import { FormDivider } from './checkout/FormDivider';
import FulfillmentToggle from './checkout/FulfillmentToggle';
import { OrderSummary } from './checkout/OrderSummary';
import { PickupLocationPicker } from './checkout/PickupLocationPicker';
import { PlaceOrderButton } from './checkout/PlaceOrderButton';
import { PrivacyNotice } from './checkout/PrivacyNotice';
import SchedulingPicker from './checkout/SchedulingPicker';
import ExpressCheckout from './checkout/ExpressCheckout';

const StripePaymentForm = lazy(() =>
  import('./checkout/StripePaymentForm').then((m) => ({ default: m.StripePaymentForm })),
);

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
  const checkoutError = useStore($checkoutError);

  const [form, dispatch] = useReducer(formReducer, INITIAL_FORM_STATE);
  const initializedRef = useRef(false);

  // Stripe payment state
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expressAvailable, setExpressAvailable] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [stripeConfig, setStripeConfig] = useState<{
    clientSecret: string;
    publishableKey: string;
    stripeAccount: string;
  } | null>(null);
  const [availableFulfillment, setAvailableFulfillment] = useState<('delivery' | 'pickup')[]>([]);
  const [timeSlots, setTimeSlots] = useState<
    Array<{
      id: string;
      start_time: string;
      end_time: string;
      capacity: number;
      reserved_count: number;
      available: boolean;
      remaining_capacity: number;
    }>
  >([]);
  const [timeSlotsLoading, setTimeSlotsLoading] = useState(false);
  const [pickupLocations, setPickupLocations] = useState<
    Array<{ id: number; name: string; distance_km?: number }>
  >([]);

  const typedLang = lang as 'nl' | 'en' | 'de';
  const currency = merchant?.currency ?? 'EUR';
  const locale = langToLocale(lang);

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

  // ── Fetch pickup locations (merchant-level, not checkout-specific) ──
  useEffect(() => {
    if (!merchant) return;
    const client = getClient();
    const locationsUrl = '/api/v1/pickup-locations/';

    client
      .GET(locationsUrl as any)
      .then(({ data }) => {
        if (!data || !Array.isArray(data)) return;
        const locs = (
          data as Array<{ id: number; name: string; address?: { street?: string; city?: string } }>
        ).map((loc) => ({
          id: loc.id,
          name: loc.name,
          distance_km: undefined as number | undefined,
        }));
        setPickupLocations(locs);
        // Auto-select if only one location
        if (locs.length === 1) {
          dispatch({ type: 'SET_FIELD', field: 'pickupLocationId', value: locs[0].id });
        }
      })
      .catch((err) => {
        log.error('checkout', 'Failed to fetch pickup locations:', err);
      });
  }, [merchant?.slug]);

  // ── Create checkout from cart when cart is ready ──────────────────
  useEffect(() => {
    if (!cart?.id || cart.line_items.length === 0) return;
    if (checkout?.cart_id === cart.id) return; // already created for this cart

    createCheckout(cart.id).catch((err) => {
      log.error('checkout', 'Failed to create checkout:', err);
    });
  }, [cart?.id, cart?.line_items.length, checkout?.cart_id]);

  // ── Fetch available shipping methods after checkout is created ────
  useEffect(() => {
    if (!checkout?.id) return;

    const client = getClient();
    client

      .GET(`/api/v1/checkout/${checkout.id}/shipping/` as any)
      .then(({ data }) => {
        if (!data) return;
        const groups = data as Array<{
          id: string;
          available_rates: Array<{ rate_id: string; name: string }>;
        }>;
        // Determine available fulfillment types from shipping rates
        const methods = new Set<'delivery' | 'pickup'>();
        for (const group of groups) {
          for (const rate of group.available_rates ?? []) {
            const id = rate.rate_id?.toLowerCase() ?? rate.name?.toLowerCase() ?? '';
            if (id.includes('pickup')) methods.add('pickup');
            else methods.add('delivery');
          }
        }
        const available = methods.size > 0 ? Array.from(methods) : ['pickup' as const];
        setAvailableFulfillment(available);

        // Auto-select the first available method if current selection isn't available
        if (!available.includes(form.fulfillmentMethod)) {
          dispatch({ type: 'SET_FULFILLMENT', method: available[0] });
        }

        // Auto-select shipping rate if only one is available
        if (groups.length === 1 && groups[0].available_rates?.length === 1) {
          const rateId = groups[0].available_rates[0].rate_id;
          dispatch({ type: 'SET_FIELD', field: 'selectedShippingRateId', value: rateId });
        }
      })
      .catch((err) => {
        log.error('checkout', 'Failed to fetch shipping methods:', err);
      });
  }, [checkout?.id]);

  // ── Fetch time slots for a date ────────────────────────────────
  const fetchTimeSlots = useCallback(
    (date: string) => {
      // Use the first pickup location or default to 1
      const locationId = form.pickupLocationId ?? pickupLocations[0]?.id ?? 1;
      setTimeSlotsLoading(true);
      const client = getClient();
      const slotsUrl = `/api/v1/pickup-locations/${locationId}/time-slots/?date=${date}`;

      client
        .GET(slotsUrl as any)
        .then(({ data }) => {
          if (!data) {
            setTimeSlots([]);
            return;
          }
          const response = data as {
            time_slots?: Array<{
              id: string;
              start_time: string;
              end_time: string;
              capacity: number;
              reserved_count: number;
              available: boolean;
              remaining_capacity: number;
            }>;
          };
          setTimeSlots(response.time_slots ?? []);
        })
        .catch((err) => {
          log.error('checkout', 'Failed to fetch time slots:', err);
          setTimeSlots([]);
        })
        .finally(() => {
          setTimeSlotsLoading(false);
        });
    },
    [form.pickupLocationId, pickupLocations],
  );

  // ── Redirect to menu if cart is empty ────────────────────────────
  useEffect(() => {
    if (cart && cart.line_items.length === 0) {
      window.location.href = `/${lang}/`;
    }
  }, [cart?.line_items.length, lang]);

  // ── Field-level validation (on blur) ─────────────────────────────
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validateFieldsForPatch = useCallback((): boolean => {
    const errors: Record<string, string> = {};

    // Only validate fields that have been touched (non-empty)
    if (form.email && !EMAIL_RE.test(form.email)) {
      errors.email = t('emailInvalid', typedLang);
    }

    // Replace errors (don't merge) — clears fixed errors
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [form.email, typedLang]);

  // ── Persist form on blur + trigger delivery PATCH ────────────────
  const handleBlur = useCallback(() => {
    persistFormState(form);

    // Run field validation — don't PATCH if invalid
    if (!validateFieldsForPatch()) return;

    // Only PATCH if checkout exists and we have valid contact + address data
    const checkoutId = checkout?.id;
    if (!checkoutId) return;

    // Require valid email + contact info before PATCHing
    if (!form.email || !EMAIL_RE.test(form.email)) return;
    if (!form.firstName || !form.lastName || !form.phone) return;

    // For delivery, also require address
    if (form.fulfillmentMethod === 'delivery') {
      if (!form.street || !form.city || !form.postalCode) return;
    }

    const deliveryData: Record<string, unknown> = {
      email: form.email,
      shipping_address: {
        first_name: form.firstName,
        last_name: form.lastName,
        street_address_1: form.street,
        city: form.city,
        postal_code: form.postalCode,
        country_code: form.countryCode,
        phone_number: form.phone,
      },
    };

    if (form.selectedShippingRateId) {
      deliveryData.shipping_method_id = form.selectedShippingRateId;
    }

    if (form.selectedSlotId) {
      deliveryData.fulfillment_slot_id = form.selectedSlotId;
    }

    patchDelivery(checkoutId, deliveryData);
  }, [form, checkout?.id, validateFieldsForPatch]);

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

  // ── Fetch payment gateway config (Stripe keys) after checkout created ──
  // Payment is NOT initiated here — only when user clicks Place Order
  useEffect(() => {
    if (!checkout?.id) return;
    if (stripeConfig) return;

    const client = getClient();

    interface GatewayConfigEntry {
      key: string;
      value: string;
    }
    interface PaymentGateway {
      id: string;
      config?: GatewayConfigEntry[];
    }

    const gatewayUrl = `/api/v1/checkout/${checkout.id}/payment-gateways/`;

    client
      .GET(gatewayUrl as any)
      .then(({ data }) => {
        const gateways = (data as unknown as PaymentGateway[]) ?? [];
        const stripeGateway = gateways.find((g) => g.id === 'stripe');
        const configMap = new Map((stripeGateway?.config ?? []).map((c) => [c.key, c.value]));
        const pk = (configMap.get('publishable_key') as string) ?? '';
        const acct = (configMap.get('stripe_account') as string) ?? '';
        if (pk) {
          setStripeConfig({ clientSecret: '', publishableKey: pk, stripeAccount: acct });
        }
      })
      .catch((err) => {
        log.error('checkout', 'Failed to fetch payment gateways:', err);
      });
  }, [checkout?.id, stripeConfig]);

  // ── Form validation ─────────────────────────────────────────────
  function validateForm(): boolean {
    const errors: Record<string, string> = {};

    if (!form.email) {
      errors.email = t('fieldRequired', typedLang, { field: t('email', typedLang) });
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      errors.email = t('emailInvalid', typedLang);
    }
    if (!form.phone) {
      errors.phone = t('fieldRequired', typedLang, { field: t('phone', typedLang) });
    }
    if (!form.firstName) {
      errors.firstName = t('fieldRequired', typedLang, { field: t('firstName', typedLang) });
    }
    if (!form.lastName) {
      errors.lastName = t('fieldRequired', typedLang, { field: t('lastName', typedLang) });
    }
    if (form.fulfillmentMethod === 'delivery') {
      if (!form.street)
        errors.street = t('fieldRequired', typedLang, { field: t('street', typedLang) });
      if (!form.city) errors.city = t('fieldRequired', typedLang, { field: t('city', typedLang) });
      if (!form.postalCode)
        errors.postalCode = t('fieldRequired', typedLang, { field: t('postalCode', typedLang) });
    }

    setFormErrors(errors);

    if (Object.keys(errors).length > 0) {
      // Scroll to first error
      const firstErrorField = document.querySelector('[role="alert"]');
      firstErrorField?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  }

  // ── Place order handler ─────────────────────────────────────────
  // Payment is initiated HERE (on user click), not automatically.
  // Flow: validate → initiate payment (gets client_secret) → confirm with Stripe → complete
  const handlePlaceOrder = useCallback(async () => {
    if (isSubmitting) return;
    if (!validateForm()) return;
    if (!checkout) return;

    setIsSubmitting(true);
    persistFormState(form);

    try {
      // Step 1: Initiate payment on the backend (creates PaymentIntent)
      const paymentResult = await initiatePayment(checkout.id);
      if (!paymentResult?.client_secret) {
        log.error('checkout', 'No client_secret returned from payment initiation');
        return;
      }

      // Step 2: If Stripe is loaded and Payment Element is mounted, confirm payment
      if (stripeRef.current && elementsRef.current) {
        const { error } = await stripeRef.current.confirmPayment({
          elements: elementsRef.current,
          confirmParams: {
            return_url: `${window.location.origin}/${lang}/checkout/success?checkout_id=${checkout.id}`,
          },
          redirect: 'if_required',
        });

        if (error) {
          log.error('checkout', 'Stripe confirmPayment error:', error.message);
          return;
        }

        // Card/wallet payment succeeded inline — complete checkout
        const result = await ensurePaymentAndComplete(
          checkout.id,
          paymentResult.client_secret,
          stripeRef.current as unknown as Parameters<typeof ensurePaymentAndComplete>[2],
          lang,
        );

        if (result.status === 'succeeded' && result.redirectUrl) {
          window.location.href = result.redirectUrl;
        }
      } else {
        // Stripe not loaded — complete via backend (webhook will handle)
        await completeCheckout(checkout.id);
        window.location.href = `/${lang}/checkout/success?order=${checkout.order_number ?? ''}`;
      }
    } catch (err) {
      log.error('checkout', 'Place order error:', err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, form, checkout, stripeConfig, lang]);

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
        <div class="flex-1 md:max-w-xl w-full" onBlur={handleBlur}>
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

          {/* Express checkout (Apple Pay / Google Pay) — only when Stripe is configured */}
          {stripeConfig?.publishableKey && (
            <ExpressCheckout
              lang={typedLang}
              publishableKey={stripeConfig.publishableKey}
              stripeAccount={stripeConfig.stripeAccount}
              merchantName={merchant.name}
              currency={currency}
              totalInCents={toCents(cartTotal)}
              cartId={cart?.id ?? ''}
              onSuccess={(orderNumber) => {
                window.location.href = `/${lang}/checkout/success?order=${orderNumber}`;
              }}
              onError={(msg) => {
                log.error('checkout', 'Express checkout error:', msg);
              }}
              onAvailable={setExpressAvailable}
            />
          )}

          <FormDivider lang={typedLang} visible={expressAvailable} />

          {/* Contact information — always visible */}
          <div class="px-4 py-3">
            <ContactForm
              lang={typedLang}
              form={form}
              dispatch={dispatch}
              onBlur={handleBlur}
              errors={formErrors}
            />
          </div>

          {/* Fulfillment sections — only after shipping methods are loaded */}
          {availableFulfillment.length > 0 && (
            <>
              <FulfillmentToggle
                lang={typedLang}
                form={form}
                dispatch={dispatch}
                availableMethods={availableFulfillment}
                deliveryEligible={availableFulfillment.includes('delivery') ? true : false}
              />

              {/* Delivery address (visible only for delivery) */}
              {form.fulfillmentMethod === 'delivery' && (
                <div class="px-4 py-3">
                  <DeliveryAddressForm
                    lang={typedLang}
                    form={form}
                    dispatch={dispatch}
                    onBlur={handleBlur}
                    errors={formErrors}
                    visible
                  />
                </div>
              )}

              {/* Pickup location (visible only for pickup) */}
              {form.fulfillmentMethod === 'pickup' && (
                <div class="px-4 py-3">
                  <PickupLocationPicker
                    lang={typedLang}
                    form={form}
                    dispatch={dispatch}
                    locations={pickupLocations}
                    visible
                  />
                </div>
              )}
            </>
          )}

          {/* Scheduling */}
          <div class="px-4 py-3">
            <SchedulingPicker
              lang={typedLang}
              form={form}
              dispatch={dispatch}
              timeSlots={timeSlots}
              onDateChange={fetchTimeSlots}
              onSlotSelect={(slotId) => {
                dispatch({ type: 'SET_FIELD', field: 'selectedSlotId', value: slotId });
              }}
              isPickup={form.fulfillmentMethod === 'pickup'}
              loading={timeSlotsLoading}
            />
          </div>

          {/* Stripe Payment Element */}
          {stripeConfig?.clientSecret && (
            <div class="px-4 py-4">
              <h2 class="text-base font-semibold mb-3">{t('payment', typedLang)}</h2>
              <Suspense fallback={<div class="animate-pulse rounded-lg bg-muted h-[200px]" />}>
                <StripePaymentForm
                  clientSecret={stripeConfig.clientSecret}
                  publishableKey={stripeConfig.publishableKey}
                  stripeAccount={stripeConfig.stripeAccount}
                  merchantTheme={{
                    primary: merchant.theme?.primary,
                    background: merchant.theme?.background,
                    foreground: merchant.theme?.foreground,
                    radius: merchant.theme?.radius,
                  }}
                  onStripeReady={(stripe, elements) => {
                    stripeRef.current = stripe;
                    elementsRef.current = elements;
                  }}
                  onError={(msg) => {
                    log.error('checkout', 'Stripe payment form error:', msg);
                  }}
                />
              </Suspense>
            </div>
          )}

          {/* Privacy notice */}
          <PrivacyNotice lang={typedLang} />

          {/* Desktop place order button */}
          <div class="hidden md:block px-4 py-6">
            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={loading || isSubmitting}
              class={`flex h-12 w-full items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90 ${loading || isSubmitting ? 'pointer-events-none opacity-50' : ''}`}
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
          </div>

          {/* Bottom spacer for mobile sticky CTA */}
          <div class="h-24 md:hidden" />
        </div>

        {/* ── Right column: sticky order summary (desktop) ───── */}
        <div class="hidden md:block md:w-80 lg:w-96">
          <div class="sticky top-6">
            <OrderSummary lang={typedLang} currency={currency} />
          </div>
        </div>
      </div>

      {/* ── Mobile sticky CTA ────────────────────────────────── */}
      <PlaceOrderButton
        lang={typedLang}
        currency={currency}
        onPlace={handlePlaceOrder}
        disabled={isSubmitting}
      />
    </div>
  );
}
