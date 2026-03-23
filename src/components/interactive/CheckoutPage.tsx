import { useReducer, useEffect, useCallback, useRef, useState } from 'preact/hooks';
import { lazy, Suspense } from 'preact/compat';
import { useStore } from '@nanostores/preact';
import { $cart, $cartTotal, ensureCart } from '@/stores/cart';
import { $merchant } from '@/stores/merchant';
import {
  $checkout,
  $checkoutLoading,
  $checkoutError,
  clearStoredCheckoutId,
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
import { FormDivider } from './checkout/FormDivider';
import { OrderSummary } from './checkout/OrderSummary';
import { PlaceOrderButton } from './checkout/PlaceOrderButton';
import { PrivacyNotice } from './checkout/PrivacyNotice';
import CheckoutFormOrchestrator from './checkout/CheckoutFormOrchestrator';
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

  // ── Create checkout from cart when cart is ready ──────────────────
  useEffect(() => {
    if (!cart?.id || cart.line_items.length === 0) return;

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
  }, [cart?.id, cart?.line_items.length, checkout?.cart_id, checkout?.status]);

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

  // ── Initiate payment when gateway config is available from checkout ──
  // Gateway config comes from the checkout response (after delivery_set).
  // We only need to initiate payment to get a client_secret for the Stripe Element.
  useEffect(() => {
    if (!checkout?.id) return;
    if (stripeConfig) return;

    const gateways = checkout.available_payment_gateways;
    if (!gateways) return;

    const stripeGateway = gateways.find((g) => g.id === 'stripe');
    if (!stripeGateway) return;

    const pk = stripeGateway.config.publishable_key ?? '';
    const acct = stripeGateway.config.stripe_account ?? '';
    if (!pk) return;

    initiatePayment(checkout.id)
      .then((paymentResult) => {
        if (paymentResult?.client_secret) {
          setStripeConfig({
            clientSecret: paymentResult.client_secret,
            publishableKey: pk,
            stripeAccount: acct,
          });
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        $checkoutError.set(`Payment initialization failed: ${msg}`);
        log.error('checkout', 'Failed to initiate payment:', err);
      });
  }, [checkout?.id, checkout?.available_payment_gateways, stripeConfig]);

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
  // PaymentIntent is already created (when Payment Element mounted).
  // Flow: validate → confirm with Stripe → complete checkout
  const handlePlaceOrder = useCallback(async () => {
    if (isSubmitting) return;
    if (!validateForm()) return;
    if (!checkout) return;

    setIsSubmitting(true);
    persistFormState(form);

    try {
      // If Stripe Payment Element is mounted, confirm the existing PaymentIntent
      if (stripeRef.current && elementsRef.current && stripeConfig?.clientSecret) {
        const { error } = await stripeRef.current.confirmPayment({
          elements: elementsRef.current,
          confirmParams: {
            return_url: `${window.location.origin}/${lang}/checkout/success?checkout_id=${checkout.id}`,
          },
          redirect: 'if_required',
        });

        if (error) {
          $checkoutError.set(error.message ?? t('paymentDeclined', typedLang));
          return;
        }

        // Card/wallet payment succeeded inline — complete checkout
        const result = await ensurePaymentAndComplete(
          checkout.id,
          stripeConfig.clientSecret,
          stripeRef.current as unknown as Parameters<typeof ensurePaymentAndComplete>[2],
          lang,
        );

        if (result.status === 'succeeded' && result.redirectUrl) {
          window.location.href = result.redirectUrl;
        }
      } else {
        // Stripe not loaded — complete via backend (webhook will handle)
        const completed = await completeCheckout(checkout.id);
        window.location.href = `/${lang}/checkout/success?order=${completed.order_number ?? ''}`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      $checkoutError.set(msg);
      log.error('checkout', 'Place order error:', msg);
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

          <CheckoutFormOrchestrator
            lang={typedLang}
            form={form}
            dispatch={dispatch}
            formErrors={formErrors}
            setFormErrors={setFormErrors}
            checkoutId={checkout?.id}
            merchantSlug={merchant?.slug}
          />

          {/* Stripe Payment Element */}
          {stripeConfig?.clientSecret && (
            <div class="px-4 py-4">
              <h2 class="text-base font-semibold mb-3">{t('payment', typedLang)}</h2>
              <Suspense fallback={<div class="animate-pulse rounded-lg bg-muted h-[200px]" />}>
                <StripePaymentForm
                  clientSecret={stripeConfig.clientSecret}
                  publishableKey={stripeConfig.publishableKey}
                  stripeAccount={stripeConfig.stripeAccount}
                  billingName={`${form.firstName} ${form.lastName}`.trim()}
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
