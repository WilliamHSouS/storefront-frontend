# Architecture Critique: Checkout Flow Design

**Role:** Architecture Critic
**Date:** 2026-03-18
**Reviewing:** `docs/plans/2026-03-17-checkout-flow-design.md`

---

## 1. Single Island Decision

### 1.1 Bundle size risk is real but underestimated

**Concern:** The design estimates the entire `CheckoutPage` island at 8-10 KB gzipped. This covers 10 child components including address form, scheduling picker with date/time pills, fulfillment toggle, order summary with collapsible state, and Stripe Elements orchestration. Looking at the existing codebase, `CartDrawer.tsx` alone is ~450 lines and handles far less form logic. A checkout island with contact form validation, address autocomplete-readiness, date/time picker logic, fulfillment branching, and Stripe lifecycle management will likely land closer to 15-20 KB gzipped. That puts the budget at 60-65 KB, right at the wire.

**Severity:** Major

**Recommendation:** The estimate needs stress-testing. Build the `ContactForm` and `SchedulingPicker` components first and measure. If the island exceeds 12 KB gzipped, split `OrderSummary` into a separate `client:visible` island that reads from `$checkout` nanostore -- it is read-only and has no form coupling. This would also improve LCP since the summary could render server-side and hydrate lazily.

### 1.2 Re-render blast radius

**Concern:** A single island means every keystroke in the email field, every fulfillment toggle, every slot selection triggers a reconciliation pass across the entire component tree. The design says form state is local via `useState`/`useReducer`, which helps, but the `$checkout` nanostore updates (from PATCH responses) will re-render the entire island via `useStore($checkout)`. When a delivery PATCH returns with updated totals, the OrderSummary, PlaceOrderButton, and StripePaymentForm all re-render -- including the Stripe Element mount point.

**Severity:** Major

**Recommendation:** Use `computed()` nanostores (as the codebase already does with `$cartTotal` and `$itemCount`) to derive `$checkoutTotals` and `$checkoutStatus` as narrow slices. Components that only need totals subscribe to the derived atom and skip re-renders when unrelated checkout fields change. Additionally, memoize the Stripe Elements wrapper aggressively -- Stripe Elements handle their own internal state and should not be unmounted/remounted on parent re-renders.

### 1.3 Code splitting is impossible within a single island

**Concern:** With `client:load`, the entire island and all its children are downloaded and parsed before first paint. The `SchedulingPicker` (date pills, time slot grid, capacity display) and `StripePaymentForm` (Stripe Elements lifecycle) are not needed until the user scrolls past the contact section. There is no way to lazy-load sub-components within an Astro island boundary.

**Severity:** Minor (if bundle stays within budget), Major (if it does not)

**Recommendation:** Preact supports `lazy()` + dynamic `import()` within an island. The `StripePaymentForm` is a strong candidate for intra-island lazy loading since it depends on the Stripe.js external script anyway and cannot render until `loadStripe` resolves. Wrapping it in `lazy(() => import('./checkout/StripePaymentForm'))` costs nothing in UX and could save 2-3 KB from the critical path.

---

## 2. State Management

### 2.1 Form state is lost on refresh

**Concern:** The design says form field state (email, phone, address) lives in local `useState`. The checkout recovery section says "Form fields re-populated from checkout object where possible (email, address)." The word "where possible" is doing heavy lifting. If the user has filled out their email and phone but has not yet triggered a delivery PATCH (because they are still typing their address), a page refresh loses all form input. The delivery PATCH only fires "on section completion" -- so a refresh mid-section wipes progress.

**Severity:** Major

**Recommendation:** Either (a) debounce-persist form state to `sessionStorage` (key: `sous_checkout_form`) and restore on mount, or (b) fire a lightweight debounced PATCH for contact fields (email, phone, name) separately from the delivery PATCH, so the backend has partial data to restore. Option (a) is simpler and does not require API changes. The `$addressCoords` store already uses localStorage persistence as a pattern in this codebase.

### 2.2 Race conditions between overlapping PATCH calls

**Concern:** The PATCH fires "on section completion," but sections are not gated. The user can fill contact fields, switch to delivery, enter an address, then immediately change the fulfillment method. This could fire two PATCH calls concurrently: one with the address, one switching to pickup. The backend processes them in arbitrary order. If the pickup PATCH completes first and the address PATCH completes second, the checkout is in an inconsistent state (pickup fulfillment with a delivery address and delivery shipping rate).

**Severity:** Critical

**Recommendation:** Implement a PATCH queue (similar to the `pendingEnsure` pattern already in `cart.ts`). Each PATCH should cancel or supersede the previous in-flight PATCH. Use an `AbortController` for the HTTP request and a generation counter (as `backgroundRefreshShipping` already does) to discard stale responses. Only the most recent PATCH response should be committed to `$checkout`.

### 2.3 No optimistic state for totals

**Concern:** After the user selects a shipping method, the order summary shows stale totals until the PATCH round-trips. On slow connections this could be 1-2 seconds of showing the wrong total next to the "Place Order" button. The user might click "Place Order" during this window.

**Severity:** Minor

**Recommendation:** Show a loading indicator on the totals area while a PATCH is in flight (the design already has `$checkoutLoading`). Alternatively, compute an optimistic total client-side by adding the selected rate's cost to the subtotal. The cart store already has the pattern of `mergeShippingEstimate` for preserving data across responses -- a similar approach could work here.

---

## 3. API Flow

### 3.1 Eager checkout creation generates backend waste

**Concern:** Creating a checkout on every page load means every user who visits `/{lang}/checkout` -- even by accident, even bots, even users who immediately hit "back" -- creates a server-side checkout object. Restaurant ordering has high browse-to-buy ratios. If 30% of users who view their cart click "checkout" and 60% of those abandon within 5 seconds, you are creating checkouts that are immediately orphaned. The backend must then run cleanup jobs to expire these.

**Severity:** Major

**Recommendation:** Defer checkout creation to the first meaningful user action -- specifically, when the user completes the contact section or changes fulfillment method. Show the order summary from `$cart` data (which is already loaded) until the checkout exists. This means the page renders instantly from cart state and only hits the checkout API when the user demonstrates intent. The trade-off is that the first PATCH must become a POST-then-PATCH or a combined "create with delivery data" endpoint. Given that the backend is also being designed now, this is the right time to ask for a `POST /checkout/` that accepts initial delivery data.

### 3.2 Delivery PATCH lacks debouncing or batching

**Concern:** The design says the PATCH fires on "section completion," but section completion is ambiguous. What constitutes completing the address section -- filling the last required field? Blurring the last field? The user might tab through fields quickly, triggering multiple "section complete" events. Also, changing the fulfillment method and then immediately selecting a pickup location fires two PATCHes in quick succession.

**Severity:** Major

**Recommendation:** Debounce the PATCH with a 500ms trailing delay after the last field change within a section. Collect all pending field changes and send them in a single PATCH. This reduces API calls and avoids the race condition from 2.2. The debounce timer resets on each field change, so rapid tab-throughs coalesce into one call.

### 3.3 No cart staleness check beyond `cart_id` comparison

**Concern:** The design checks `$cart.id` against `checkout.cart_id` to detect cart modifications. But the cart ID does not change when items are added or removed -- only the cart contents change. A user could open a second tab, add an item to the cart, return to the checkout tab, and the checkout would not detect the change because the cart ID matches.

**Severity:** Major

**Recommendation:** Compare a cart fingerprint (item count + total, or a hash of line item IDs and quantities -- the `cartFingerprint` pattern already exists in `CartDrawer.tsx`) rather than just the cart ID. If the fingerprint diverges, show a banner: "Your cart has changed. [Update checkout] [Keep current]" and let the user decide. Silently creating a new checkout would discard any form progress.

---

## 4. Stripe Integration

### 4.1 PaymentIntent created too late -- Stripe Elements cannot mount

**Concern:** The design flow shows: (1) lazy-load Stripe.js on page mount, (2) create Elements with `clientSecret` from `POST /payment/`, (3) mount Payment Element, (4) confirm on "Place Order" click. But step 2-3 happen on "Place Order" click (step 4 of the API sequence). This means the Stripe Payment Element is not visible to the user until they click "Place Order." The design's own layout mockup shows the Payment Element in the form *above* the Place Order button -- contradicting the API flow.

There are two interpretations: either the Payment Element is mounted without a `clientSecret` (not possible with the standard integration), or the `POST /payment/` call happens earlier than "Place Order." The design is ambiguous on this critical point.

**Severity:** Critical

**Recommendation:** Clarify the timing explicitly. The standard pattern is: (a) call `POST /payment/` when the payment section becomes relevant (e.g., after delivery details are complete) to get the `clientSecret`, (b) mount the Payment Element immediately with that secret so the user can enter card details, (c) call `confirmPayment` on "Place Order" click. This means the PaymentIntent is created *before* the user clicks submit. Update the API flow diagram (Section 4, step 4) to reflect that `POST /payment/` fires after the delivery PATCH, not on "Place Order."

### 4.2 `redirect: 'if_required'` loses checkout context on redirect

**Concern:** For payment methods that require redirect (iDEAL, Bancontact), Stripe redirects to the bank and then back to `return_url`. The success page must then call `POST /checkout/{id}/complete/`. But the checkout ID is in `sessionStorage`, which is tab-scoped. If the bank redirect opens in a new tab (some mobile browsers do this) or the session is lost during the redirect, the success page cannot find the checkout ID.

**Severity:** Critical

**Recommendation:** Pass the checkout ID in the `return_url` as a query parameter: `/${lang}/checkout/success?checkout_id={id}`. The success page reads it from the URL rather than relying on `sessionStorage`. This is safe because the checkout ID alone is not sufficient to complete the checkout -- the `POST /complete/` call also requires a valid PaymentIntent. Additionally, sign or encrypt the checkout ID in the URL to prevent enumeration. The success page already reads `payment_intent` and `payment_intent_client_secret` from URL params -- adding `checkout_id` is consistent.

### 4.3 No handling of PaymentIntent status edge cases

**Concern:** The design handles `succeeded` and generic failure, but `stripe.confirmPayment` can also return `requires_action` (3D Secure challenge that did not complete), `processing` (bank transfer pending), or `requires_capture` (if using manual capture). The success page only checks `pi.status === 'succeeded'`.

**Severity:** Major

**Recommendation:** Handle at least these statuses on the success page:
- `succeeded` -- call `/complete/`, show confirmation
- `processing` -- show "Payment is being processed, you will receive confirmation shortly"
- `requires_action` -- should not reach the success page, but if it does, show "Payment requires additional action" with a retry link
- Any other status -- show a clear error with a link back to checkout

### 4.4 Double payment risk on retry

**Concern:** If the `POST /checkout/{id}/complete/` call fails after `stripe.confirmPayment` succeeds (network error, server 500), the user sees an error. If they retry, `confirmPayment` could be called again on the same PaymentIntent. Stripe prevents double-charging on the same PaymentIntent, but the UX and recovery path are not specified.

**Severity:** Major

**Recommendation:** Before calling `confirmPayment` on retry, call `stripe.retrievePaymentIntent(clientSecret)` to check status. If already `succeeded`, skip straight to `/complete/`. The success page redirect-recovery code already does this -- the same logic should be applied to the inline confirmation path. Extract this into a shared `ensurePaymentAndComplete()` function.

---

## 5. Session Storage for Checkout ID

### 5.1 sessionStorage is unavailable in private browsing on some browsers

**Concern:** Safari's private browsing mode (prior to iOS 16.4) throws on `sessionStorage.setItem()`. While newer versions have fixed this, some users on older iOS versions will silently fail to persist the checkout ID, causing a new checkout to be created on every interaction that triggers a page refresh.

**Severity:** Minor (declining user base on old iOS)

**Recommendation:** Wrap `sessionStorage` access in try/catch (as the codebase already does for `localStorage` in `cart.ts` -- `getStoredCartId` has this pattern). Fall back to an in-memory variable if storage throws. This is a 5-line change and matches existing conventions.

### 5.2 sessionStorage is not shared across tabs -- but cart is

**Concern:** The design intentionally scopes checkout to a single tab via `sessionStorage`. But `$cart` is backed by `localStorage`, which is shared across tabs. User opens checkout in Tab A, opens a new tab (Tab B) to browse the menu, adds an item. Tab A's checkout now has stale line items. The design acknowledges this but the mitigation (compare `$cart.id` with `checkout.cart_id`) is insufficient per critique point 3.3.

**Severity:** Major (see 3.3)

**Recommendation:** In addition to the fingerprint check from 3.3, listen for the `storage` event on `localStorage` to detect cart changes made in other tabs. When detected, show a non-blocking banner rather than silently invalidating the checkout.

### 5.3 No checkout ID validation

**Concern:** The cart store validates stored IDs against `CART_ID_PATTERN` (`/^[a-zA-Z0-9_-]+$/`) before using them in API URLs. The design does not mention equivalent validation for checkout IDs from `sessionStorage`. A malicious or corrupted value could be injected into API paths.

**Severity:** Major

**Recommendation:** Apply the same `CART_ID_PATTERN` validation to checkout IDs read from `sessionStorage`. Extract the pattern and validation logic into a shared `validateStorageId()` utility. This is a direct consistency gap with the existing cart implementation.

---

## 6. Error Handling Gaps

### 6.1 No timeout on checkout creation

**Concern:** On page load, if `POST /checkout/` hangs (backend overloaded, network degraded), the user sees a loading state indefinitely. The design has `$checkoutLoading` but no timeout or cancellation strategy.

**Severity:** Major

**Recommendation:** Set a 10-second timeout on checkout creation. If exceeded, show "Checkout is taking longer than expected" with a retry button. Use `AbortController` with `setTimeout`, consistent with how `checkPromotionEligibility` uses `AbortSignal` in `cart-actions.ts`.

### 6.2 Concurrent tab checkout creates orphaned PaymentIntents

**Concern:** User opens checkout in Tab A, proceeds to payment (PaymentIntent created). Opens checkout in Tab B (new sessionStorage, new checkout, eventually new PaymentIntent). Completes in Tab B. Tab A's PaymentIntent is now orphaned on Stripe's side. While Stripe automatically expires uncaptured PaymentIntents after a configurable period, this creates noise in the merchant's Stripe dashboard and could affect their Stripe fees depending on their plan.

**Severity:** Minor

**Recommendation:** This is largely a backend concern. The backend should cancel the PaymentIntent when a checkout is abandoned or replaced. Note this as a backend requirement in the design document. On the frontend side, consider storing a flag in `localStorage` (not `sessionStorage`) like `sous_checkout_active=1` and showing a warning if the user opens checkout in a second tab: "You have checkout open in another tab."

### 6.3 No handling of 409 Conflict on checkout operations

**Concern:** If the backend implements optimistic concurrency control on checkout objects (common for order systems), PATCH and POST calls could return 409 Conflict when the checkout has been modified by another request (e.g., a concurrent tab, a background job that expired a slot). The error handling table does not mention 409.

**Severity:** Major

**Recommendation:** Add 409 handling: re-fetch the checkout via `GET /checkout/{id}/`, update `$checkout`, and show a toast explaining what changed ("Your order has been updated"). If the checkout has been completed or cancelled by another process, redirect to the appropriate page.

### 6.4 Slot reservation TTL is invisible to the user

**Concern:** The design mentions backend TTL for slot cleanup on abandonment, but the user has no visibility into this. If a user selects a 14:00 slot, walks away for 15 minutes, and returns to click "Place Order," the slot may have been released and reassigned. The PATCH would fail with `SlotFullError` at the worst possible moment -- after the user thinks they are done.

**Severity:** Major

**Recommendation:** If the backend provides a slot reservation TTL (or expiry timestamp), show a countdown or at minimum re-validate the slot before initiating payment. A lightweight `GET /checkout/{id}/` before `POST /payment/` would catch stale slots before the user commits to payment. Alternatively, the `POST /payment/` endpoint should atomically verify the slot reservation as part of payment initiation and return a clear error if expired.

### 6.5 Empty cart race on page load

**Concern:** The flow starts with "Read $cart (already loaded from cart page)." But if the user navigates directly to `/{lang}/checkout` (bookmark, shared link), `$cart` may not be populated yet. The cart store loads from `localStorage` cart ID and fetches asynchronously. There is a race between the checkout page trying to read `$cart` and the cart store initializing.

**Severity:** Major

**Recommendation:** The checkout page must explicitly `await ensureCart()` or equivalent before attempting checkout creation. Do not rely on `$cart` being pre-populated. If the cart is empty after loading, redirect to the menu page (not the cart page -- an empty cart page is a dead end). This initialization should be the first thing the `CheckoutPage` island does on mount, before any checkout API calls.

---

## Summary by Severity

| Severity | Count | Items |
|----------|-------|-------|
| Critical | 3 | 2.2 (PATCH race conditions), 4.1 (Payment Element timing), 4.2 (redirect loses checkout ID) |
| Major | 11 | 1.1 (bundle estimate), 1.2 (re-render blast radius), 2.1 (form state lost on refresh), 3.1 (eager checkout creation), 3.2 (PATCH debouncing), 3.3 (cart staleness), 4.3 (PI status edge cases), 4.4 (double payment), 5.3 (checkout ID validation), 6.1 (creation timeout), 6.3 (409 handling), 6.4 (slot TTL), 6.5 (empty cart race) |
| Minor | 3 | 1.3 (code splitting), 2.3 (optimistic totals), 5.1 (sessionStorage compat), 6.2 (orphaned PaymentIntents) |

The three critical items should be resolved before implementation begins. The major items should be addressed in the design revision or explicitly deferred with documented trade-offs.
