# Frontend Design: Checkout Flow

**Date:** 2026-03-17
**Status:** Revised (post-debate + review round 1)
**Backend checkout module:** `storefront_backend/storefront_backend/checkout/`
**Reference implementation:** `embedded-commerce-widget/src/screens/checkout/`
**Debate record:** `docs/plans/debates/2026-03-18-checkout-design/`

---

## 1. Overview

A single-page, mobile-first checkout flow at `/{lang}/checkout`. Guest-only, Stripe-powered, supporting pickup and local delivery with ASAP and scheduled fulfillment.

The checkout is a single Preact island (`CheckoutPage`, `client:load`) containing all form sections. Cart state flows in via the existing `$cart` nanostore; a new `$checkout` nanostore holds the server-side checkout object.

### Design Principles

- **Single page, no steps.** Every section visible on one scrollable page. Fewer transitions = fewer drop-offs.
- **Express checkout first.** Apple Pay, Google Pay, and iDEAL are shown at the top of the page before any form fields. One-tap checkout bypasses the entire form.
- **Mobile-first with smart sticky CTA.** "Place Order" button fixed to the bottom of the viewport on mobile, hidden when keyboard is open.
- **Progressive API updates.** Checkout created on first meaningful user action, PATCH'd as the user completes each section. Totals always visible.
- **Guest only.** Email + phone collected in the form. No login required. Auth prefill can be layered on later.
- **Stripe Payment Element.** Auto-detects locale and surfaces Apple Pay, Google Pay, iDEAL, Bancontact as appropriate. One integration covers all payment methods.
- **Webhook-first completion.** Stripe `payment_intent.succeeded` webhook is the primary order creation trigger. The frontend `/complete/` call is a fast-path optimization.

### Known Limitations

- **No saved addresses.** Guest checkout means the user enters their address every time. Auth + address book is a future enhancement.
- **No Cash on Delivery or gift card payments.** Stripe is the only payment gateway at launch.
- **Delivery scheduling is date-only.** Time slots are only available for pickup. Delivery providers (Uber Direct, local) manage their own time windows server-side.

### Backend Requirements

These items require backend coordination before or during frontend implementation:

1. **Stripe webhook handler for `payment_intent.succeeded`** must auto-complete the checkout if not already completed. The backend already has webhook infrastructure (`views_webhook.py`). This webhook is the **primary** completion mechanism — the frontend `/complete/` call is a fast-path that may or may not fire.
2. **`POST /checkout/{id}/complete/` must be idempotent.** If already completed, return the existing order rather than erroring. Both the webhook and frontend may call it.
3. **`POST /checkout/{id}/payment/` response must include PaymentIntent `amount` and `currency`** so the frontend can verify before confirming payment.
4. **HMAC signing on client-side mutations.** The backend enforces HMAC signatures on write requests. The `hmacSecret` from merchant config is included in the client-side `window.__MERCHANT__` object so `sdk-stub.ts` can sign POST/PATCH/DELETE requests. The secret is a vendor-specific HMAC key (not a user credential) — it prevents unauthorized third-party API calls but is not sensitive enough to require server-side-only handling.
5. **Rate limits:** 10 checkout creations per minute per IP, 3 active checkouts per cart, 5 slot changes per checkout, 10 delivery PATCHes per minute per checkout.
6. **Slot reservation TTL:** 15 minutes. Cleanup job runs every 5 minutes.
7. **Merchant timezone.** Add a `timezone` field (IANA format, e.g., `"Europe/Amsterdam"`) to the merchant config or include it in the fulfillment slot API response. Required so the frontend displays pickup slot times in the merchant's local timezone, not the user's browser timezone. Without this, a user in Berlin ordering from an Amsterdam restaurant would see slots shifted by 1 hour.

---

## 2. Architecture

### New Nanostores

```typescript
// src/stores/checkout.ts
import { atom, computed } from 'nanostores';

// The checkout object returned by the backend API
export const $checkout = atom<Checkout | null>(null);
export const $checkoutLoading = atom<boolean>(false);
export const $checkoutError = atom<string | null>(null);

// Derived slices — components subscribe to these to avoid unnecessary re-renders
// Uses display_* fields (pre-formatted for customer-facing currency, handles FX)
export const $checkoutTotals = computed($checkout, (c) => ({
  subtotal: c?.display_subtotal ?? '0.00',
  shipping: c?.display_shipping_cost ?? '0.00',
  tax: c?.display_tax_total ?? '0.00',
  discount: c?.display_discount_amount ?? '0.00',
  total: c?.display_total ?? '0.00',
}));

export const $checkoutStatus = computed($checkout, (c) => c?.status ?? null);
```

### Checkout TypeScript Interface

Derived from the backend's `SerializedCheckoutDict` (`checkout/serialization.py`):

```typescript
// src/types/checkout.ts

interface CheckoutLineItem {
  product_id: number | string;  // matches CartLineItem (backend may return either)
  variant_id: string;
  product_title: string;
  title: string;
  quantity: number;
  unit_price: string;          // Decimal as string
  total_price: string;
  line_total: string;
  tax_rate: string;
  tax_amount: string;
  fulfillment_type: string;    // "local_delivery" | "pickup" | "nationwide_delivery"
  fulfillment_date: string | null;
  options: Array<{ name: string; value: string; surcharges?: unknown[] }>;
  product_type: string;        // "regular" | "gift_card" | etc.
  surcharges: unknown[];
  gift_card_details?: unknown;
}

interface CheckoutAddress {
  first_name: string;
  last_name: string;
  street_address_1: string;
  street_address_2?: string;
  city: string;
  postal_code: string;
  country_code: string;       // ISO 3166-1 alpha-2
  phone_number?: string;
}

type CheckoutStatus = 'created' | 'delivery_set' | 'shipping_pending' | 'paid' | 'completed';

interface Checkout {
  id: string;                  // UUIDv4
  cart_id: string;             // UUIDv4
  merchant_id: number;
  channel_id: number | null;
  status: CheckoutStatus;
  currency: string;            // ISO 4217 (e.g. "EUR")
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
  purpose: string;             // "order" | "edit_delta"
  created_at: string | null;   // ISO 8601
  updated_at: string | null;   // ISO 8601
}

// Payment initiation response extends checkout with Stripe config
interface PaymentResult extends Checkout {
  client_secret?: string;
  redirect_url?: string;
  payment_intent_id?: string;
}
```

The `display_*` fields are **raw decimal strings in the display currency** (e.g., `"19.99"` in EUR), not pre-formatted locale strings. They still need `formatPrice()` from `src/lib/currency.ts` for locale-aware formatting (e.g., `"€ 19,99"` for NL). The distinction from the base fields is only the currency and amount (after FX conversion), not the formatting.

### Cart-Checkout Fingerprint Comparison

To detect cart staleness, compare line items using the same pattern as `CartDrawer.tsx`:

```typescript
// String() coercion ensures matching regardless of whether product_id is number or string
function checkoutFingerprint(checkout: Checkout): string {
  return checkout.line_items
    .map((li) => `${String(li.product_id)}:${li.quantity}`)
    .sort()
    .join(',');
}

function cartFingerprint(cart: Cart): string {
  return cart.line_items
    .map((li) => `${String(li.product_id)}:${li.quantity}`)
    .sort()
    .join(',');
}
```

**Form field state** (email, phone, address, etc.) is local to the Preact island via `useReducer`. Additionally, form state is **persisted to `sessionStorage`** (key: `sous_checkout_form`) on field blur (not on every keystroke — avoids excessive serialization on the main thread). Restored on mount. This prevents data loss on page refresh mid-form, following the same persistence pattern as `$addressCoords` in `localStorage`.

**PII boundary:** Sensitive fields (email, phone) stay in local component state and `sessionStorage` only. They are not stored in the `$checkout` nanostore to limit exposure to third-party scripts.

### Checkout ID Persistence

The checkout ID is stored in `sessionStorage` (key: `sous_checkout_id`). This is intentionally different from the cart ID (`localStorage`):

- **Session-scoped:** A checkout is tied to a single browser session. Opening a new tab starts fresh.
- **Cleared on completion:** Removed after successful order placement.
- **Page refresh safe:** If the user refreshes, we re-fetch the existing checkout rather than creating a new one.
- **Validated on read:** Apply the same `CART_ID_PATTERN` regex (`/^[a-zA-Z0-9_-]+$/`) used for cart IDs. Extract a shared `validateStorageId()` utility.
- **try/catch on access:** Wrap `sessionStorage` in try/catch for private browsing compatibility (matching the existing cart store pattern). Fall back to an in-memory variable.

### PATCH Queue

All delivery PATCH calls go through a request queue to prevent race conditions:

```typescript
// Pattern from existing cart.ts (pendingEnsure, refreshGeneration)
// Lives in src/stores/checkout-actions.ts (following cart.ts / cart-actions.ts convention)
let patchController: AbortController | null = null;
let patchGeneration = 0;
let patchTimer: ReturnType<typeof setTimeout> | null = null;

function patchDelivery(data: DeliveryPatchData) {
  // Cancel pending debounce and in-flight request
  if (patchTimer) clearTimeout(patchTimer);
  patchController?.abort();

  const generation = ++patchGeneration;

  // Debounce: wait 500ms for more changes to coalesce
  // Uses setTimeout + clearTimeout pattern from CartDrawer promotion check
  patchTimer = setTimeout(async () => {
    patchController = new AbortController();

    const result = await sdk.PATCH(`/checkout/${id}/delivery/`, {
      body: data,
      signal: patchController.signal,
    });

    // Only commit if this is still the latest request
    if (generation === patchGeneration && result.data) {
      $checkout.set(result.data);
    }
  }, 500);
}
```

This prevents the race condition where rapid fulfillment changes (e.g., switch to pickup then immediately select a location) fire overlapping PATCHes that resolve in arbitrary order.

### Component Tree

```
src/pages/[lang]/checkout.astro              — Astro page (hideSharedIslands={true})
  └── CheckoutPage (client:load)             — Main Preact island
        ├── CheckoutHeader                   — Merchant logo + "← Back to cart"
        ├── OrderSummary                     — Line items + price breakdown
        ├── ExpressCheckout                  — Stripe Payment Request Button (Apple Pay, Google Pay)
        ├── FormDivider                      — "or fill in details below"
        ├── FulfillmentToggle                — Delivery / Pickup radio buttons
        ├── ContactForm                      — Email, phone, first name, last name
        ├── DeliveryAddressForm              — Street, city, postal code, country (conditional)
        ├── PickupLocationPicker             — Location select list (conditional)
        ├── SchedulingPicker                 — ASAP / Schedule toggle + date/time slots
        ├── StripePaymentForm                — Stripe Payment Element (lazy-loaded)
        ├── PrivacyNotice                    — Brief GDPR notice + privacy policy link
        └── PlaceOrderButton                 — Submit button, shows total

src/pages/[lang]/checkout/success.astro      — Order confirmation page
  └── CheckoutSuccess (client:load)          — Confirmation island
```

**Why one large island?** Checkout form sections are tightly coupled — fulfillment method changes which address form shows, address changes affect shipping rates, slot selection depends on location. Splitting into separate islands would require heavy nanostore coordination. A single island with internal components keeps form state management simple.

**Lazy-loaded sub-component:** `StripePaymentForm` is loaded via Preact's `lazy(() => import('./checkout/StripePaymentForm'))`. It depends on the external Stripe.js script and cannot render until `loadStripe` resolves, so lazy-loading costs nothing in UX and saves ~2-3 KB from the critical path.

**Memoization:** `StripePaymentForm` is wrapped in `memo()` to prevent unmount/remount on parent re-renders. Stripe Elements manage their own internal state and must not be disrupted.

**Hydration safety:** `CheckoutPage` uses `client:load` (more aggressive than the `client:idle` used by cart islands). The `getClient()` singleton depends on `$merchant` being populated from `window.__MERCHANT__`. To avoid the timing race documented in `merchant.ts`, the checkout island must guard initialization behind `$merchant.subscribe()` — only calling `ensureCart()` and checkout APIs once `$merchant` is non-null. Alternatively, `checkout.astro` can SSR-fetch cart data via `Astro.locals.sdk` and pass it as a prop, using the client SDK only for mutations.

**Layout integration:** `checkout.astro` passes `hideSharedIslands={true}` to `BaseLayout` to suppress `CartDrawer`, `ProductDetail`, and `SearchBar`. The `CartBar` component (which is NOT gated by `hideSharedIslands`) must also be hidden on checkout pages — add a path check in `CartBar` to self-suppress when on `/checkout`, preventing overlap with the checkout's own sticky "Place Order" button.

---

## 3. Page Layout

### Mobile (default)

```
┌──────────────────────────┐
│  ← Back to cart    Logo  │
├──────────────────────────┤
│  Order summary           │
│  Falafel Wrap ×2  €17.98 │ ← line items shown for ≤3 items
│  Hummus           €6.52  │   collapsed for 4+ items
│  ────────────────────    │
│  Subtotal         €24.50 │ ← price breakdown ALWAYS visible
│  Shipping          €5.00 │
│  Tax               €3.68 │
│  Total            €33.18 │
├──────────────────────────┤
│  ┌────────────────────┐  │
│  │ 🍎 Apple Pay       │  │ ← express checkout (if available)
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │  Google Pay        │  │
│  └────────────────────┘  │
│  ── or fill in details ──│
├──────────────────────────┤
│  How would you like...?  │
│  [● Delivery] [○ Pickup] │
├──────────────────────────┤
│  Contact information     │
│  ┌────────────────────┐  │
│  │ Email              │  │
│  │ Phone              │  │
│  │ First name         │  │
│  │ Last name          │  │
│  └────────────────────┘  │
├──────────────────────────┤
│  Delivery address        │
│  ┌────────────────────┐  │
│  │ Street + number    │  │
│  │ City               │  │
│  │ Postal code        │  │
│  └────────────────────┘  │
├──────────────────────────┤
│  When would you like...? │
│  [● ASAP]  [○ Schedule]  │
├──────────────────────────┤
│  Payment                 │
│  ┌────────────────────┐  │
│  │ Stripe Payment     │  │
│  │ Element            │  │
│  └────────────────────┘  │
├──────────────────────────┤
│  🔒 Your details are     │
│  used to process your    │
│  order. Privacy Policy   │
├──────────────────────────┤
│                          │
├══════════════════════════┤
│ ▓▓ Place order · €33.18 │ ← sticky, md:hidden, hides on focusin
└══════════════════════════┘
```

**Order summary behavior:**
- **≤3 items:** Line items expanded by default. Price breakdown always visible.
- **4+ items:** Line items collapsed ("3 items ▾"), price breakdown always visible. Tap to expand items.
- **Price breakdown (subtotal, shipping, tax, total) is never collapsed.** Users must always see what they're paying.

**Sticky CTA behavior:**
- Uses `md:hidden` (matching existing `CartBar` pattern)
- Hides when any form input is focused (`focusin`/`focusout` listeners on the form container) to recover viewport space when the mobile keyboard is open
- Re-appears when the keyboard dismisses

### Desktop (md+ breakpoint)

```
┌──────────────────────────────────────────────────┐
│  ← Back to cart                            Logo  │
├────────────────────────────┬─────────────────────┤
│                            │                     │
│  Express checkout          │  Order summary      │
│  [Apple Pay] [Google Pay]  │  (always expanded)  │
│  ── or fill in details ──  │                     │
│                            │  Falafel Wrap ×2    │
│  Fulfillment method        │    €17.98           │
│  [Delivery] [Pickup]       │  Hummus             │
│                            │    €6.52            │
│  Contact information       │                     │
│  [form fields]             │  Subtotal   €24.50  │
│                            │  Shipping    €5.00  │
│  Delivery address          │  Tax         €3.68  │
│  [form fields]             │  ─────────────────  │
│                            │  Total      €33.18  │
│  Scheduling                │                     │
│  [ASAP] [Schedule]         │  [discount code]    │
│                            │                     │
│  Payment                   │                     │
│  [Stripe Element]          │                     │
│                            │                     │
│  🔒 Privacy Policy         │                     │
│  [Place order · €33.18]    │                     │
│                            │                     │
└────────────────────────────┴─────────────────────┘
```

Desktop uses a two-column layout: left column is the form (max-width ~640px), right column is a sticky order summary sidebar.

---

## 4. API Flow

### Sequence

```
1. Page load
   ├── await ensureCart()  (do NOT assume $cart is populated — user may have
   │   navigated directly to /checkout via bookmark or shared link)
   ├── If cart is empty → redirect to /{lang}/ (menu, not cart — empty cart is a dead end)
   ├── Check sessionStorage for existing checkout ID (validated against CART_ID_PATTERN)
   │   └── If found → GET /api/v1/checkout/{id}/
   │       ├── Compare cart fingerprint (item IDs + quantities + total) with checkout
   │       │   └── If diverged → show banner "Your cart has changed" [Update / Keep current]
   │       └── Restore form state from sessionStorage sous_checkout_form
   ├── Fetch payment gateways → GET /api/v1/checkout/{id}/payment-gateways/
   │   (or defer until checkout exists — see step 2)
   └── Do NOT load Stripe.js yet (deferred to checkout creation to avoid
       wasted bandwidth for users who bounce immediately)

2. User completes first form section (deferred checkout creation)
   ├── If no checkout exists yet → POST /api/v1/checkout/  { cart_id }
   │   └── Store checkout ID in sessionStorage
   └── PATCH /api/v1/checkout/{id}/delivery/  (via PATCH queue)
       {
         email, shipping_address, billing_address,
         shipping_method_id, fulfillment_slot_id
       }
       → Returns updated checkout with shipping_cost, totals

3. After delivery section is complete — parallel fetches then payment init
   ├── Promise.all([
   │     GET /api/v1/checkout/{id}/shipping/,        → shipping groups + rates
   │     GET /api/v1/checkout/{id}/payment-gateways/, → Stripe config
   │     GET /api/v1/fulfillment/locations/{id}/slots/?date=...  → time slots (if pickup + scheduled)
   │   ])
   └── Then (sequential, needs gateway_id from above):
       POST /api/v1/checkout/{id}/payment/  { gateway_id: "stripe" }
       → Returns { config: { client_secret, publishable_key, stripe_account, amount, currency } }
       → Frontend verifies amount matches displayed total
       → Mount Stripe Payment Element with client_secret

4. User clicks "Place Order"
   └── stripe.confirmPayment({ elements, confirmParams })
       → confirmParams.return_url includes checkout_id:
         /{lang}/checkout/success?checkout_id={id}

5. After Stripe confirms
   ├── Inline (card, Apple Pay, Google Pay):
   │   └── POST /api/v1/checkout/{id}/complete/  (fast-path)
   │       → Returns { order_number, status: "completed" }
   │       → Clear sessionStorage
   │       → Redirect to /{lang}/checkout/success?order={order_number}
   │
   └── Bank redirect (iDEAL, Bancontact):
       → Stripe redirects to return_url with payment_intent params
       → Success page reads checkout_id from URL (not sessionStorage)
       → Success page confirms payment status, calls /complete/
       → If already completed by webhook, /complete/ returns existing order

6. Webhook fallback (backend, async)
   └── Stripe sends payment_intent.succeeded webhook
       → Backend auto-completes checkout if status != "completed"
       → Idempotent: if already completed, no-op
```

### Deferred Checkout Creation

The checkout is NOT created on page load. Instead:
- The page renders immediately using `$cart` data for the order summary
- The checkout is created (`POST /checkout/`) when the user completes the first form section (demonstrating purchase intent)
- This prevents wasted backend resources from accidental visits, bots, and immediate bounces

### Delivery PATCH Timing

All PATCHes go through the **PATCH queue** (Section 2). The queue:
- Debounces with a 500ms trailing delay after the last field change
- Cancels in-flight requests when superseded via `AbortController`
- Only commits the response if it's from the latest generation

PATCHes fire when:
- Contact section fields are all populated and user moves to next section
- Address is fully entered (all required fields populated on blur of last field)
- Fulfillment method changes
- Time slot is selected or changed
- Shipping rate is selected

Each PATCH returns updated totals (including shipping cost), which update the order summary via `$checkoutTotals`.

### Checkout Creation Timeout

If `POST /checkout/` does not respond within 10 seconds, abort via `AbortController` (matching the existing `AbortSignal` pattern in `cart-actions.ts`) and show "Checkout is taking longer than expected" with a retry button.

---

## 5. Stripe Integration

### Express Checkout (Payment Request Button)

At the top of the page, above the manual form, show Stripe's **Payment Request Button**:

```typescript
const paymentRequest = stripe.paymentRequest({
  country: 'NL',
  currency: 'eur',
  total: { label: merchant.name, amount: totalInCents },
  requestPayerName: true,
  requestPayerEmail: true,
  requestPayerPhone: true,
});

// Check if Apple Pay / Google Pay is available
const canMakePayment = await paymentRequest.canMakePayment();
if (canMakePayment) {
  // Show the button — renders Apple Pay on Safari, Google Pay on Chrome
  const prButton = elements.create('paymentRequestButton', { paymentRequest });
  prButton.mount('#express-checkout');
}
```

When a user completes express checkout:
1. `paymentRequest` fires a `paymentmethod` event with name, email, phone, shipping address
2. Frontend creates the checkout (`POST /checkout/`), sets delivery (`PATCH /delivery/`), and initiates payment (`POST /payment/`) in sequence
3. Confirms the PaymentIntent and calls `/complete/`

**Express checkout error handling:** Each step in the sequence can fail. The `paymentmethod` event callback receives an `ev.complete()` function that must be called:
- If `PATCH /delivery/` fails (e.g., delivery unavailable at the Apple Pay address): call `ev.complete('fail')` to dismiss the Apple Pay/Google Pay sheet, then show an inline error below the express checkout section explaining why (e.g., "Delivery is not available at this address. Please use the form below to choose pickup.").
- If `POST /payment/` fails: same approach — `ev.complete('fail')` + inline error.
- Express checkout is only shown when the merchant supports delivery (Apple Pay provides a shipping address but not a pickup location selection). For pickup-only merchants, the express section is hidden.

If Apple Pay / Google Pay aren't available (e.g., non-Safari browser without Google Pay configured), the express section is hidden and the user sees only the manual form. The `FormDivider` ("or fill in details below") is also hidden.

### Payment Element Flow

The Payment Element is mounted **after the delivery section is complete**, when `POST /payment/` returns the `client_secret`. This is NOT on "Place Order" click — it's earlier.

```typescript
import { loadStripe } from '@stripe/stripe-js';

// 1. Load Stripe when checkout is created (not on page mount — avoids
//    wasted 40 KB download for users who bounce before completing a section)
const stripePromise = loadStripe(publishableKey, {
  stripeAccount: stripeAccountId,
});

// 2. After delivery is complete, create PaymentIntent
const paymentResult = await sdk.POST(`/checkout/${id}/payment/`, {
  body: { gateway_id: 'stripe' },
});
const { client_secret, amount, currency } = paymentResult.data.config;

// 3. Verify amount matches displayed total
if (amount !== expectedAmountInCents) {
  // Amount mismatch — re-fetch checkout to get current totals
  await refetchCheckout();
  return;
}

// 4. Mount Payment Element (user can now enter card details)
const stripe = await stripePromise;
const elements = stripe.elements({
  clientSecret: client_secret,
  appearance: mapMerchantThemeToStripe(merchant.theme),
});
const paymentElement = elements.create('payment');
paymentElement.mount('#stripe-payment-container');

// 5. On "Place Order" click — only confirms, doesn't create
const { error } = await stripe.confirmPayment({
  elements,
  confirmParams: {
    return_url: `${origin}/${lang}/checkout/success?checkout_id=${checkoutId}`,
  },
  redirect: 'if_required',
});

if (error) {
  // Show persistent error below Payment Element
  showPaymentError(error.message);
} else {
  // Card/wallet payment succeeded inline — complete and redirect
  await ensurePaymentAndComplete(checkoutId, client_secret);
}
```

### `ensurePaymentAndComplete()` — shared completion logic

Used by both the inline flow and the success page to prevent double-charging on retry:

```typescript
async function ensurePaymentAndComplete(checkoutId: string, clientSecret: string) {
  // Check if already completed (by webhook or prior attempt)
  const checkout = await fetchCheckout(checkoutId);
  if (checkout.status === 'completed') {
    redirectToSuccess(checkout.order_number);
    return;
  }

  // Verify payment status before calling /complete/
  const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);

  switch (paymentIntent.status) {
    case 'succeeded':
      const result = await sdk.POST(`/checkout/${checkoutId}/complete/`);
      redirectToSuccess(result.data.order_number);
      break;
    case 'processing':
      showProcessingState(); // "Payment is being processed..."
      break;
    case 'requires_action':
      showRetryState(); // "Payment requires additional action"
      break;
    default:
      showPaymentError('Payment failed. Please try another method.');
  }
}
```

### Key Decisions

- **`redirect: 'if_required'`**: For card payments and Apple Pay/Google Pay, Stripe resolves the promise without redirecting. For iDEAL/Bancontact (bank redirects), Stripe handles the redirect.
- **`appearance` theming**: Map merchant HSL theme colors to Stripe's appearance API so the payment form visually matches the checkout.
- **Stripe.js is external**: Loaded from `js.stripe.com`, does not count toward our 65 KB bundle budget. Only loaded on checkout pages.
- **Payment Element auto-detection**: Based on locale and device, Stripe automatically shows relevant payment methods (iDEAL for Dutch, Apple Pay on Safari, Google Pay on Chrome, etc.).

### Success Page

The success page reads `checkout_id` from the **URL query parameter** (not `sessionStorage`) to handle bank-redirect returns where session may be lost:

```typescript
// src/pages/[lang]/checkout/success.astro → CheckoutSuccess island
const urlParams = new URLSearchParams(window.location.search);
const checkoutId = urlParams.get('checkout_id');
const orderNumber = urlParams.get('order');
const paymentIntent = urlParams.get('payment_intent');
const clientSecret = urlParams.get('payment_intent_client_secret');

// Immediately clean sensitive params from URL
history.replaceState({}, '', `/${lang}/checkout/success${orderNumber ? `?order=${orderNumber}` : ''}`);

if (orderNumber && !paymentIntent) {
  // Direct redirect from inline payment — order already completed
  showConfirmation(orderNumber);
} else if (checkoutId && paymentIntent && clientSecret) {
  // Returning from bank redirect — use shared completion logic
  await ensurePaymentAndComplete(checkoutId, clientSecret);
} else {
  // No valid params — redirect to menu
  redirectToMenu();
}
```

---

## 6. Fulfillment & Scheduling

### Fulfillment Toggle

Two options as radio buttons (large tap targets on mobile):

- **Delivery** — shows `DeliveryAddressForm`
- **Pickup** — shows `PickupLocationPicker`

**Default logic:**
- If `$addressCoords` exists (user entered postcode on menu page), pre-populate the **postal code field only** (street and city are not stored in `$addressCoords`) and use the stored coordinates to evaluate delivery eligibility immediately
- If delivery is available at the stored address → default to Delivery
- If delivery is not available → default to Pickup, show message: "Delivery is not available at your address. We've selected pickup."
- If no address stored and no postcode known → default to Delivery with inline note: "Enter your address to confirm delivery availability"
- **Single fulfillment merchants:** If the merchant only supports one fulfillment type, skip the toggle entirely and show the appropriate form directly

**Ineligibility handling:** If the delivery PATCH returns an ineligibility error after the user enters their full address, switch to pickup automatically with a clear inline message — not just red field highlights.

### Scheduling Picker

```
┌────────────────────────────────────┐
│  When would you like your order?   │
│                                    │
│  [● ASAP]  [○ Schedule]           │
│                                    │
│  ── when Schedule is selected ──   │
│                                    │
│  Date:                             │
│  [◀] Today  Mar 18  Mar 19 [▶]    │  ← 7-day strip with arrows (not scroll)
│                                    │
│  Time: (pickup only)               │
│  ○ 14:00–14:30                     │  ← radio group, available only
│  ○ 14:30–15:00                     │
│  ○ 15:30–16:00                     │
│  [Show all times ▾]               │  ← reveals full slots (full shown greyed)
└────────────────────────────────────┘
```

**Changes from original design:**
- **Date selector:** 7-day strip with left/right arrow buttons instead of horizontal scroll pills. Better discoverability, keyboard navigable.
- **Time slots:** Only available slots shown by default. "Show all times" toggle reveals full schedule including unavailable ones.
- **Accessibility:** `role="radiogroup"` for time slots, `aria-disabled="true"` + `aria-label="Full"` for unavailable slots. Date selector uses `role="listbox"` with arrow key navigation.
- **Timezone:** API times converted to merchant's configured timezone (see Backend Requirement #7), not the user's browser timezone. If the timezone field is not yet available, default to `"Europe/Amsterdam"` with a TODO to make it dynamic.

### Time Slot API

**Pickup slots:** Fetched from `GET /api/v1/fulfillment/locations/{location_id}/slots/?date=YYYY-MM-DD`

Response shape:
```json
{
  "location_id": 1,
  "date": "2026-03-18",
  "time_slots": [
    {
      "id": "uuid",
      "start_time": "14:00",
      "end_time": "14:30",
      "capacity": 10,
      "reserved_count": 3,
      "available": true,
      "remaining_capacity": 7
    }
  ]
}
```

- Slots are re-fetched when the user changes dates or opens the scheduler
- Selected slot ID is sent as `fulfillment_slot_id` in the delivery PATCH
- Backend atomically reserves the slot via `select_for_update`

**Delivery scheduling:** Date-only picker. No time slots — delivery providers manage their own windows. `fulfillment_slot_id` is null for ASAP delivery.

### Slot Reservation Lifecycle

1. User taps a slot → immediately show "Reserving..." state on the slot pill → delivery PATCH fires with `fulfillment_slot_id`
2. Backend reserves the slot atomically (increments `reserved_count`)
3. If user changes slot → backend releases old, reserves new
4. If slot is full when PATCH is called → grey out that specific slot inline (no full list refresh), show inline message "This slot just filled up"
5. On order completion → slot stays reserved (it's consumed)
6. On checkout abandonment → slot released by backend cleanup (15-minute TTL, job runs every 5 minutes)

**Pre-payment slot validation:** Before initiating payment (`POST /payment/`), re-fetch the checkout to verify the reserved slot is still valid. This catches the case where a user selects a slot, walks away, and returns after the slot's reservation TTL has expired.

---

## 7. Shipping Rates

Shipping rates come from the backend's shipping provider architecture. The frontend treats them generically — it doesn't need to know about Uber Direct, local delivery, etc.

### Flow

1. After address is set, fetch `GET /api/v1/checkout/{id}/shipping/`
2. Backend returns shipping groups with available rates:

```json
[
  {
    "id": "grp-vendor-1",
    "shipping_cost": "5.00",
    "selected_rate_id": "local_delivery",
    "available_rates": [
      { "id": "local_delivery", "name": "Local Delivery", "cost": "5.00" },
      { "id": "uber_direct", "name": "Uber Direct", "cost": "7.50" }
    ],
    "line_items": [...]
  }
]
```

3. If multiple rates available, show a selector. If only one, auto-select it.
4. Selected rate sent as `shipping_method_id` in the delivery PATCH.
5. Backend recalculates totals with the selected shipping cost.

For the common case (single vendor, single delivery option), the user never sees a shipping selector — it's auto-selected and the price just shows in the order summary.

---

## 8. Error Handling

### Client-Side Validation

On blur, not on submit. Inline error messages below each field.

| Field | Validation |
|---|---|
| Email | Required, email format |
| Phone | Required, `type="tel"`, validated with `libphonenumber-js` (~3 KB) against merchant country |
| First name | Required |
| Last name | Required |
| Street | Required (delivery only) |
| City | Required (delivery only) |
| Postal code | Required (delivery only) |
| Fulfillment method | Required (default: delivery) |
| Pickup location | Required (pickup only) |

**Server-side validation is authoritative.** Client-side validation is a UX convenience. The backend independently validates all fields on every PATCH. Backend validation errors are displayed inline next to the relevant field.

### Scroll-to-Error on Submit

When "Place Order" is tapped with validation errors:
1. `scrollIntoView({ behavior: 'smooth', block: 'center' })` to the first invalid field
2. Focus the first invalid field
3. Inject an `aria-live="assertive"` error summary at the top of the form: "There are N errors: [field]: [error message]." Each error links to the corresponding field via `id` anchor.

This follows WCAG 2.1 SC 3.3.1 and the existing `role="alert"` pattern used by `AddressBar`.

### API Error Handling

| Scenario | UX Response |
|---|---|
| Cart empty / expired | Redirect to `/{lang}/` (menu page, not empty cart) with toast "Your cart has expired" |
| Checkout creation fails | Inline error banner with retry button |
| Checkout creation timeout (10s) | "Checkout is taking longer than expected" with retry button |
| Delivery PATCH — invalid address | Highlight address fields, show backend error inline |
| Delivery PATCH — delivery unavailable | Switch to pickup, show message "Delivery is not available at your address" |
| Delivery PATCH — `SlotFullError` | Grey out that slot inline, show "This slot just filled up" |
| Delivery PATCH — network error | Persistent error banner at top of affected section (not toast). Auto-retry once after 2s. |
| Payment amount mismatch | Re-fetch checkout, show "Your order total has been updated" |
| Payment declined | Persistent inline error below Payment Element: "Your payment was declined. Try a different payment method or contact your bank." |
| PaymentIntent `processing` | "Your payment is being processed. You'll receive confirmation shortly." |
| PaymentIntent `requires_action` | "Your payment requires additional action." with retry link |
| Bank redirect payment fails | Success page shows failure state with "Try again" link back to checkout |
| `/complete/` fails after payment | Webhook fallback will complete the order. Show "We're confirming your order..." and poll checkout status. |
| 409 Conflict on any checkout call | Re-fetch checkout, update `$checkout`, show toast explaining what changed |
| Double submit | "Place Order" disabled + spinner on first click. Re-enabled on error. |

**Key principle:** State-critical errors (PATCH failures, network errors during checkout mutation) use **persistent banners**, not ephemeral toasts. Toasts are only for informational messages that don't affect form state.

### Checkout State Recovery

| Scenario | Behavior |
|---|---|
| Page refresh | Re-fetch checkout from validated sessionStorage ID. Restore form fields from `sessionStorage` `sous_checkout_form`. |
| Browser back from success | Checkout ID already cleared. Shows empty checkout → redirects to menu. |
| New tab | No sessionStorage → shows cart data, defers checkout creation. |
| Cart modified in another tab | Detect via `storage` event on `localStorage`. Compare cart fingerprint (item IDs + quantities + total). If diverged, show banner: "Your cart has changed. [Update checkout] [Keep current]." |
| Direct navigation to /checkout | `await ensureCart()` first. If cart empty, redirect to menu. |

---

## 9. Security

### Content Security Policy

The checkout page handles payment data via Stripe Elements. A CSP header is required:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://js.stripe.com 'nonce-{random}';
  frame-src https://js.stripe.com https://hooks.stripe.com;
  connect-src 'self' https://api.stripe.com https://*.posthog.com {API_BASE_URL};
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https:;
```

- Inline scripts in `BaseLayout.astro` (PostHog stub, merchant JSON) will use `nonce`-based CSP
- `style-src 'unsafe-inline'` is required by Stripe Elements (they inject inline styles). This is an accepted risk documented in Stripe's CSP guide. It does NOT extend to `script-src` which uses nonces.
- `connect-src` includes `*.posthog.com` for analytics ingest. If PostHog is disabled on checkout pages (see below), this can be removed.
- Start with `Content-Security-Policy-Report-Only` to identify violations before enforcing
- Enforce before launch

### PostHog on Checkout Pages

- `maskAllInputs: true` in session recording config for checkout pages
- Strip query parameters from pageview URLs on the success page (prevent `client_secret` capture)
- Consider disabling session recording on checkout entirely, using event-based analytics only

### Success Page URL Hygiene

- `history.replaceState` immediately after reading `payment_intent_client_secret` from URL params
- `Referrer-Policy: no-referrer` on the checkout success page specifically (prevent client_secret leak via Referer header to "Back to menu" link)
- Checkout IDs are UUIDv4 (122 bits of entropy, not sequential) — confirmed from backend model `id = models.UUIDField(primary_key=True, default=uuid.uuid4)`. Not enumerable.

### GDPR

- Privacy notice near the email field: "We use your details to process and deliver your order. [Privacy Policy]"
- Marketing consent checkbox if merchant wants to reuse email for promotions (optional, merchant-configured)
- Backend data retention: abandoned checkout data deleted after 30 days; completed order PII minimized per retention policy
- Backend must support data deletion by email for right-to-erasure requests

---

## 10. i18n

New translation keys added to `src/i18n/messages/{en,nl,de}.json`:

```json
{
  "checkoutTitle": "Checkout",
  "expressCheckout": "Express checkout",
  "orFillInDetails": "or fill in details below",
  "contactInfo": "Contact information",
  "email": "Email",
  "phone": "Phone",
  "firstName": "First name",
  "lastName": "Last name",
  "fulfillmentMethod": "How would you like your order?",
  "delivery": "Delivery",
  "pickup": "Pickup",
  "deliveryUnavailable": "Delivery is not available at your address. We've selected pickup.",
  "confirmDeliveryAvailability": "Enter your address to confirm delivery availability",
  "deliveryAddress": "Delivery address",
  "street": "Street and number",
  "city": "City",
  "postalCode": "Postal code",
  "country": "Country",
  "pickupLocation": "Pickup location",
  "selectLocation": "Select a location",
  "scheduling": "When would you like your order?",
  "asap": "As soon as possible",
  "schedule": "Schedule for later",
  "selectDate": "Select a date",
  "selectTime": "Select a time",
  "slotFull": "Full",
  "slotReserving": "Reserving...",
  "slotJustFilled": "This slot just filled up",
  "showAllTimes": "Show all times",
  "today": "Today",
  "tomorrow": "Tomorrow",
  "payment": "Payment",
  "placeOrder": "Place order",
  "processing": "Processing...",
  "paymentProcessing": "Your payment is being processed. You'll receive confirmation shortly.",
  "paymentDeclined": "Your payment was declined. Try a different payment method or contact your bank.",
  "paymentRequiresAction": "Your payment requires additional action.",
  "orderConfirmed": "Order confirmed!",
  "orderNumber": "Order number",
  "thankYou": "Thank you for your order",
  "confirmingOrder": "We're confirming your order...",
  "backToMenu": "Back to menu",
  "backToCart": "Back to cart",
  "cartExpired": "Your cart has expired",
  "cartChanged": "Your cart has changed",
  "updateCheckout": "Update checkout",
  "keepCurrent": "Keep current",
  "slotUnavailable": "This time slot is no longer available",
  "connectionError": "Connection lost. Please try again.",
  "checkoutSlow": "Checkout is taking longer than expected",
  "retry": "Try again",
  "privacyNotice": "We use your details to process and deliver your order.",
  "privacyPolicy": "Privacy Policy",
  "errorSummary_one": "There is {{count}} error",
  "errorSummary_other": "There are {{count}} errors",
  "itemCount_one": "{{count}} item",
  "itemCount_other": "{{count}} items"
}
```

---

## 11. E2E Testing

### Mock API Additions

Add to `e2e/helpers/mock-api.ts`:

| Endpoint | Mock Behavior |
|---|---|
| `POST /api/v1/checkout/` | Returns checkout object with line items from mock cart |
| `GET /api/v1/checkout/{id}/` | Returns stored checkout |
| `PATCH /api/v1/checkout/{id}/delivery/` | Updates checkout with address/shipping, returns updated totals |
| `GET /api/v1/checkout/{id}/shipping/` | Returns single shipping group with local_delivery rate |
| `GET /api/v1/checkout/{id}/payment-gateways/` | Returns Stripe gateway config |
| `POST /api/v1/checkout/{id}/payment/` | Returns mock client_secret + amount + currency |
| `POST /api/v1/checkout/{id}/complete/` | Returns order_number (idempotent — returns same order on repeat calls) |
| `GET /api/v1/fulfillment/locations/{id}/slots/` | Returns mock time slots with capacity |

### Test Scenarios

```
e2e/checkout.spec.ts
  ├── shows checkout page with cart items and price breakdown
  ├── validates required fields (email, phone, name)
  ├── scroll-to-first-error on Place Order with validation errors
  ├── completes delivery checkout (happy path)
  ├── completes pickup checkout with time slot
  ├── shows ASAP vs scheduled toggle
  ├── handles full time slot gracefully (greyed out inline)
  ├── shows shipping rate options when multiple available
  ├── redirects to menu when cart is empty
  ├── pre-populates postal code from existing $addressCoords
  ├── mobile: sticky place order button visible, hides on input focus
  ├── mobile: order summary price breakdown always visible
  ├── desktop: two-column layout with sticky sidebar
  ├── express checkout buttons shown when available
  ├── deferred checkout creation (no POST until first section complete)
  ├── rapid fulfillment toggle does not corrupt checkout state (PATCH queue test)
  ├── address change during in-flight PATCH uses latest values
  ├── auto-switches to pickup when delivery is unavailable at entered address
  ├── cart change detection across tabs (two-page approach with waitForSelector)

e2e/checkout-success.spec.ts
  ├── shows order confirmation with order number
  ├── handles bank redirect return (checkout_id in URL)
  ├── handles already-completed checkout (idempotent /complete/)
  ├── cleans sensitive params from URL
  ├── back to menu link works

e2e/checkout-security.spec.ts
  ├── Cache-Control: no-store on checkout pages
  ├── Cache-Control: no-store on success pages
  ├── rejects invalid checkout_id in URL (path traversal attempt)
  ├── rejects invalid checkout_id from sessionStorage
```

### Unit Tests

Following the existing `cart.ts` / `cart-actions.test.ts` convention:

```
src/stores/checkout.test.ts
  ├── $checkoutTotals derivation from checkout object
  ├── $checkoutStatus derivation
  ├── checkout ID persistence to/from sessionStorage
  ├── checkout ID validation (rejects invalid patterns)
  ├── sessionStorage try/catch fallback for private browsing

src/stores/checkout-actions.test.ts
  ├── createCheckout — creates and stores ID
  ├── patchDelivery — debounce coalesces rapid calls
  ├── patchDelivery — AbortController cancels in-flight on new call
  ├── patchDelivery — generation counter discards stale responses
  ├── ensurePaymentAndComplete — skips /complete/ if already completed
  ├── ensurePaymentAndComplete — handles 'processing' status
  ├── ensurePaymentAndComplete — handles 'requires_action' status
  ├── cart fingerprint comparison — detects divergence
  ├── cart fingerprint comparison — handles matching carts

src/lib/validate-id.test.ts
  ├── accepts valid UUIDs and alphanumeric IDs
  ├── rejects path traversal attempts (../, etc.)
  ├── rejects empty strings and null
```

### Stripe Mocking

Stripe.js is mocked via **`page.route()` interception** of `https://js.stripe.com/**`. This returns a mock script that sets `window.Stripe` to a mock constructor. The `@stripe/stripe-js` `loadStripe` wrapper detects `window.Stripe` and uses it — this works reliably with bundled ES module imports (unlike `page.addInitScript()` which cannot intercept already-bundled imports).

Mock Stripe object must implement at minimum:
- `elements()` → returns mock Elements with `create()` and `mount()`
- `confirmPayment()` → resolves with `{ error: null }`
- `retrievePaymentIntent()` → resolves with `{ paymentIntent: { status: 'succeeded' } }`
- `paymentRequest()` → returns mock with `canMakePayment()` and event listeners for express checkout tests

The mock is set up in a shared `e2e/helpers/stripe-mock.ts` utility.

---

## 12. Bundle Impact

| Addition | Estimated Size (gzipped) |
|---|---|
| `CheckoutPage` island (form components, lazy Stripe) | ~12-15 KB |
| `$checkout` store + derived atoms | ~1 KB |
| `libphonenumber-js/mobile` (phone validation) | ~7 KB |
| `@stripe/stripe-js` loader (bundled, injects script tag) | ~2 KB |
| i18n keys (3 languages) | ~1.5 KB |
| **Total new client JS** | **~23-27 KB** |

Stripe.js itself (~40 KB) loads from `js.stripe.com` externally — not counted in our 65 KB budget. But `@stripe/stripe-js` (the npm loader) and `libphonenumber-js/mobile` are bundled.

Current budget usage is ~45 KB. With checkout additions we'd be at **~68-72 KB, exceeding the 65 KB limit.**

### Bundle Budget Strategy

**Before implementation begins:** Create a minimal `CheckoutPage.tsx` skeleton (JSX structure, no logic) and run `pnpm size:check` to measure the baseline. This validates whether the approach is viable.

**Mitigation options (in order of preference):**

1. **Checkout-specific budget.** Measure checkout pages separately from the global budget. Checkout is a distinct entry point that users only visit when purchasing. Add a second `size-limit` entry: `{ "path": "dist/client/**/checkout*.js", "limit": "30 KB" }` and raise the global limit to 75 KB.

2. **Code-split OrderSummary.** Extract to a `client:visible` island reading from `$checkoutTotals` nanostore. It's read-only with no form coupling. Saves ~2-3 KB from the main island.

3. **Use a lighter phone validator.** Replace `libphonenumber-js/mobile` (~7 KB) with a simple regex for the merchant's country. Less accurate but saves ~6 KB. Defer full validation to the backend.

4. **Use `client:only="preact"`.** Skip SSR for the checkout island entirely (it's form-heavy with no SEO value). This doesn't reduce bundle size but may affect how `size-limit` measures.

The phone validation library choice should be confirmed during the skeleton build measurement.

---

## 13. Files to Create/Modify

### New Files

| File | Purpose |
|---|---|
| `src/pages/[lang]/checkout.astro` | Checkout page (Astro SSR shell) |
| `src/pages/[lang]/checkout/success.astro` | Order confirmation page |
| `src/components/interactive/CheckoutPage.tsx` | Main checkout Preact island |
| `src/components/interactive/checkout/CheckoutHeader.tsx` | Logo + back link |
| `src/components/interactive/checkout/OrderSummary.tsx` | Line items + price breakdown |
| `src/components/interactive/checkout/ExpressCheckout.tsx` | Stripe Payment Request Button |
| `src/components/interactive/checkout/ContactForm.tsx` | Email, phone, name fields |
| `src/components/interactive/checkout/FulfillmentToggle.tsx` | Delivery / Pickup selector |
| `src/components/interactive/checkout/DeliveryAddressForm.tsx` | Address fields |
| `src/components/interactive/checkout/PickupLocationPicker.tsx` | Location selector |
| `src/components/interactive/checkout/SchedulingPicker.tsx` | ASAP + date/time picker |
| `src/components/interactive/checkout/StripePaymentForm.tsx` | Stripe Elements wrapper (lazy-loaded) |
| `src/components/interactive/checkout/PlaceOrderButton.tsx` | Submit button with total |
| `src/components/interactive/checkout/PrivacyNotice.tsx` | GDPR notice + policy link |
| `src/components/interactive/CheckoutSuccess.tsx` | Success page island |
| `src/stores/checkout.ts` | Checkout nanostore + derived atoms + types |
| `src/stores/checkout-actions.ts` | Mutation functions: createCheckout, patchDelivery (PATCH queue), initiatePayment, ensurePaymentAndComplete |
| `src/types/checkout.ts` | Checkout, CheckoutLineItem, CheckoutAddress, PaymentResult interfaces |
| `src/lib/validate-id.ts` | Shared validateStorageId() utility (extracted from cart pattern) |
| `src/stores/checkout.test.ts` | Unit tests for checkout store + derivations |
| `src/stores/checkout-actions.test.ts` | Unit tests for PATCH queue, payment flow, fingerprint |
| `src/lib/validate-id.test.ts` | Unit tests for shared ID validation |
| `e2e/checkout.spec.ts` | Checkout E2E tests |
| `e2e/checkout-success.spec.ts` | Success page E2E tests |
| `e2e/checkout-security.spec.ts` | Security header + ID validation E2E tests |
| `e2e/helpers/stripe-mock.ts` | Shared Stripe.js mock via page.route() interception |

### Modified Files

| File | Change |
|---|---|
| `src/i18n/messages/en.json` | Add checkout translation keys |
| `src/i18n/messages/nl.json` | Add checkout translation keys |
| `src/i18n/messages/de.json` | Add checkout translation keys |
| `e2e/helpers/mock-api.ts` | Add checkout endpoint mocks |
| `src/middleware.ts` | Add explicit `Cache-Control: private, no-store, no-cache, must-revalidate` for `/checkout` routes. Must run BEFORE the `isCacheable` block since checkout currently gets no Cache-Control header (no header ≠ no-store). Pattern: `if (url.pathname.match(/^\/[a-z]{2}\/checkout/))` |
| `vercel.json` | Add CSP header (report-only initially), `Referrer-Policy: no-referrer` on success page |
| `src/stores/cart.ts` | Extract `CART_ID_PATTERN` validation to shared `validate-id.ts` |
| `src/components/interactive/CartBar.tsx` | Self-suppress on `/checkout` routes — render empty wrapper `<div class="md:hidden" />` (not `null`) for DOM stability, following the island stability gotcha in CLAUDE.md |
