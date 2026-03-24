# Code Review Round 1 -- Checkout Flow Implementation

**Date:** 2026-03-18
**Branch:** `emdash/checkout-8al`
**Reviewer:** Claude Opus 4.6 (automated)
**Scope:** All new/modified checkout files (131 files changed, +13,186 / -1,156)
**Design doc:** `docs/plans/2026-03-17-checkout-flow-design.md`

---

## Critical Issues

### C1 -- PATCH endpoint mismatch between actions and mock API
- **Severity:** Critical
- **Files:** `src/stores/checkout-actions.ts` (line 66), `src/components/interactive/checkout/ExpressCheckout.tsx` (line 39), `e2e/helpers/mock-api.ts` (line 643)
- **Issue:** `patchDelivery()` and `patchDeliveryImmediate()` both PATCH to `/api/v1/checkout/{id}/` but the mock API only handles PATCH on `/api/v1/checkout/{id}/delivery/`. The design doc explicitly specifies the `/delivery/` sub-resource (Section 2, line 220: `sdk.PATCH('/checkout/${id}/delivery/', ...)`). This means all delivery PATCHes will 404 in E2E tests and likely in production if the backend expects the `/delivery/` path.
- **Recommendation:** Change both `patchDelivery` and `patchDeliveryImmediate` to use `/api/v1/checkout/{id}/delivery/` to match the backend API contract and mock server.

### C2 -- No client-side form validation before payment submission
- **Severity:** Critical
- **File:** `src/components/interactive/CheckoutPage.tsx` (lines 201-234)
- **Issue:** `handlePlaceOrder` proceeds directly to `stripeRef.current.confirmPayment()` without validating that required fields (email, phone, name, address for delivery) are filled in. The `errors` prop is always passed as `{}` to `ContactForm` and `DeliveryAddressForm` -- there is no validation logic anywhere. The design doc (Section 8, line 767) states: "Client-side validation is a UX convenience" and lists specific validation rules, but none are implemented. Users can submit with completely blank forms.
- **Recommendation:** Implement a `validateForm()` function that checks required fields before calling `confirmPayment`. Populate the `errors` state and scroll to the first error. The design doc specifies: email format, phone presence, name presence, and address fields for delivery.

### C3 -- No double-submit protection on Place Order
- **Severity:** Critical
- **File:** `src/components/interactive/CheckoutPage.tsx` (lines 201-234)
- **Issue:** `handlePlaceOrder` is async but there is no guard to prevent concurrent invocations. Rapid double-clicks (especially on mobile) can trigger duplicate `confirmPayment` calls. The button uses `loading` from `$checkoutLoading` to disable itself, but `handlePlaceOrder` does not set this flag -- it only gets set inside `ensurePaymentAndComplete` after the Stripe call completes. There is a window between click and the first `await` where the button remains active.
- **Recommendation:** Add a local `isSubmitting` state (or set `$checkoutLoading` at the top of `handlePlaceOrder`) to immediately disable the button on first click.

### C4 -- Stripe publishableKey and stripeAccount are empty strings
- **Severity:** Critical
- **File:** `src/components/interactive/CheckoutPage.tsx` (lines 183-186)
- **Issue:** When `initiatePayment` returns, the code sets `publishableKey: ''` and `stripeAccount: ''` with a TODO comment. `loadStripe('')` will fail silently or throw. This means the Stripe Payment Element will never mount, and checkout cannot complete. The mock API already returns `publishable_key` and `stripe_account` from the payment-gateways endpoint (mock-api.ts checkout gateways handler), but this data is never fetched.
- **Recommendation:** Fetch payment gateway config from `/api/v1/checkout/{id}/payment-gateways/` before or alongside `initiatePayment`, and use the returned `publishable_key` and `stripe_account` values.

---

## Major Issues

### C5 -- `restoreFormState` performs unsafe cast without validation
- **Severity:** Major
- **File:** `src/stores/checkout.ts` (lines 97-107)
- **Issue:** `JSON.parse(raw) as CheckoutFormState` blindly trusts that the parsed JSON conforms to `CheckoutFormState`. If the schema changes between deploys (e.g., a new required field is added), stale sessionStorage data will produce an object missing that field, causing runtime errors or undefined behavior in form components. This is a real risk during iterative development of the checkout flow.
- **Recommendation:** Add a lightweight runtime shape check (e.g., verify `typeof parsed.email === 'string'`) or use a schema validation function. At minimum, spread over `INITIAL_FORM_STATE` defaults: `return { ...INITIAL_FORM_STATE, ...parsed }`.

### C6 -- Missing `autocomplete` attributes on all form inputs
- **Severity:** Major
- **Files:** `src/components/interactive/checkout/ContactForm.tsx`, `src/components/interactive/checkout/DeliveryAddressForm.tsx`
- **Issue:** Neither form component sets `autocomplete` attributes. This is both an accessibility issue (WCAG 1.3.5 Identify Input Purpose) and a UX issue -- browsers/password managers cannot autofill checkout fields. For a checkout flow this directly impacts conversion rate. Expected attributes: `autocomplete="email"`, `autocomplete="tel"`, `autocomplete="given-name"`, `autocomplete="family-name"`, `autocomplete="street-address"`, `autocomplete="address-level2"` (city), `autocomplete="postal-code"`.
- **Recommendation:** Add `autocomplete` attributes to every input field in ContactForm and DeliveryAddressForm.

### C7 -- CheckoutHeader links to non-existent cart page
- **Severity:** Major
- **File:** `src/components/interactive/checkout/CheckoutHeader.tsx` (line 12)
- **Issue:** The "Back to cart" link navigates to `/${lang}/cart` but no cart page exists at this route (`src/pages/[lang]/cart*` does not exist). The cart in this codebase is a drawer (`CartDrawer`) opened via the `$isCartOpen` store, not a standalone page. This link will 404 or redirect to the menu with a language-detection redirect loop.
- **Recommendation:** Change the link to navigate back to `/${lang}/` (menu page) or trigger the cart drawer to open. The link text could be changed to "Back to menu" for accuracy.

### C8 -- `CheckoutSuccess` renders URL parameter `order` directly without sanitization
- **Severity:** Major
- **File:** `src/components/interactive/CheckoutSuccess.tsx` (lines 24, 36-39, 102-106)
- **Issue:** The `order` parameter from the URL is read via `params.get('order')` and rendered directly into the DOM: `<span class="font-mono...">{orderNumber}</span>`. While Preact escapes text content by default (preventing XSS via script injection), the order number is also placed into the URL for `history.replaceState` (line 31) without validation. A crafted URL like `?order=<img onerror=...>` is safe in JSX but the value should still be validated against an expected format to prevent UI spoofing (e.g., very long strings, emoji, misleading content like "REFUND ISSUED").
- **Recommendation:** Validate the order number format (alphanumeric + hyphens, reasonable length) before using it. Reject invalid values early.

### C9 -- `CheckoutSuccess` polling has no abort on unmount race condition
- **Severity:** Major
- **File:** `src/components/interactive/CheckoutSuccess.tsx` (lines 46-66)
- **Issue:** The `setTimeout` at line 63 that stops polling after 30s captures `pollInterval` in its closure, but it is not cleared on unmount. If the component unmounts before the 30s timeout fires, the timeout callback will call `clearInterval` on a stale reference and `setLoading(false)` on an unmounted component (Preact warning). The `pollCleanupRef` only clears the interval, not the timeout.
- **Recommendation:** Store the timeout ID and clear it in `pollCleanupRef` alongside the interval:
  ```ts
  const timeoutId = setTimeout(...);
  pollCleanupRef.current = () => {
    clearInterval(pollInterval);
    clearTimeout(timeoutId);
  };
  ```

### C10 -- Express checkout creates a second checkout, ignoring existing one
- **Severity:** Major
- **File:** `src/components/interactive/checkout/ExpressCheckout.tsx` (lines 128-135)
- **Issue:** The `paymentmethod` handler always calls `createCheckout(cartId)`, creating a brand new checkout even though `CheckoutPage` already creates one when the cart is ready (CheckoutPage.tsx line 145). This means the page has one checkout in the `$checkout` store and express checkout creates a different one. The user sees totals from checkout A but pays through checkout B. Cart modifications after page load would be reflected in A but not B.
- **Recommendation:** Use the existing checkout from `$checkout` store if available, and only create a new one if none exists. Pass the checkout ID as a prop or read from the store.

### C11 -- `ExpressCheckout` effect re-runs on every `totalInCents` change, re-initializing Stripe
- **Severity:** Major
- **File:** `src/components/interactive/checkout/ExpressCheckout.tsx` (line 214)
- **Issue:** The main `useEffect` (line 75) includes `totalInCents` in its dependency array. Every time the cart total changes, the entire Stripe Payment Request is torn down and re-initialized (destroying the button, calling `loadStripe` again, and calling `canMakePayment`). Meanwhile, a separate `useEffect` at line 217 already handles total updates via `prRef.current.update()`. The initialization effect should only run once for a given Stripe config.
- **Recommendation:** Remove `totalInCents` and `merchantName` from the first effect's dependency array. The second effect already handles updates.

---

## Minor Issues

### C12 -- `OrderSummary.LineItem` uses hardcoded English translation key
- **Severity:** Minor
- **File:** `src/components/interactive/checkout/OrderSummary.tsx` (line 44)
- **Issue:** The quantity label uses `t('itemCount_one', 'en')` with a hardcoded `'en'` instead of the `lang` prop. Dutch and German users will see English quantity labels.
- **Recommendation:** Change to `t('itemCount_one', lang)` (where `lang` comes from the parent component's prop).

### C13 -- `toCents` is exported from `ExpressCheckout` and imported by `CheckoutPage`
- **Severity:** Minor
- **Files:** `src/components/interactive/checkout/ExpressCheckout.tsx` (lines 25-27, 241), `src/components/interactive/CheckoutPage.tsx` (line 29)
- **Issue:** A generic utility function (`toCents`) is defined inside a component module and re-exported. This creates a circular-ish dependency where `CheckoutPage` imports from its own child component. It also means this utility is not available to other modules without pulling in the ExpressCheckout component.
- **Recommendation:** Move `toCents` to `src/lib/currency.ts` or `src/lib/pricing.ts` where other price-related utilities live.

### C14 -- `FormDivider` always returns `null` violating island DOM stability
- **Severity:** Minor
- **File:** `src/components/interactive/checkout/FormDivider.tsx` (line 9)
- **Issue:** When `visible` is false, `FormDivider` returns `null`. Per CLAUDE.md gotchas: "Preact islands mounted before `<slot/>` in BaseLayout must never return `null`. Always render a stable wrapper element." While `FormDivider` is not a top-level island (it's inside CheckoutPage), the pattern sets a risky precedent and the `visible` prop is always `true` in current usage, making the guard dead code.
- **Recommendation:** Return an empty `<div />` instead of `null` for consistency, or remove the `visible` prop since it is always `true`.

### C15 -- `PickupLocationPicker` and `DeliveryAddressForm` return empty fragments when hidden
- **Severity:** Minor
- **Files:** `src/components/interactive/checkout/PickupLocationPicker.tsx` (line 21), `src/components/interactive/checkout/DeliveryAddressForm.tsx` (line 25)
- **Issue:** Both components return `<></>` (empty fragment) when not visible. While this works functionally inside a non-island parent, using CSS visibility (`hidden` class) or a wrapper div would be better for:
  1. Preserving form state in the DOM (fields are destroyed when toggling fulfillment method)
  2. Avoiding layout shifts on toggle
- **Recommendation:** Consider using `class={visible ? '' : 'hidden'}` on the outer element instead of conditional rendering, so the DOM is stable and form field state is preserved.

### C16 -- Checkout page missing `<form>` element wrapper
- **Severity:** Minor
- **File:** `src/components/interactive/CheckoutPage.tsx` (lines 236-413)
- **Issue:** The checkout form fields are not wrapped in a `<form>` element. This means: (1) pressing Enter in a text field does not submit the form, (2) the browser's built-in form validation (`required` attributes on DeliveryAddressForm inputs) has no effect, (3) password managers may not detect this as a checkout form for autofill.
- **Recommendation:** Wrap the form section in `<form onSubmit={handlePlaceOrder} novalidate>` (using `novalidate` since you'll implement custom validation per C2).

### C17 -- `StripePaymentForm` strict-mode guard prevents re-initialization
- **Severity:** Minor
- **File:** `src/components/interactive/checkout/StripePaymentForm.tsx` (lines 33-34)
- **Issue:** `mountedRef.current` is set to `true` on the first effect run and never reset. If the component unmounts and remounts (e.g., due to a `clientSecret` change triggering re-render of the Suspense boundary), the effect will not re-run and the Payment Element will not mount. The `memo` wrapper reduces this risk but does not eliminate it for key changes.
- **Recommendation:** Reset `mountedRef.current = false` in the cleanup function of the effect.

### C18 -- `PlaceOrderButton` keyboard detection is unreliable
- **Severity:** Minor
- **File:** `src/components/interactive/checkout/PlaceOrderButton.tsx` (lines 21-41)
- **Issue:** The keyboard detection heuristic (hide when any input/textarea/select receives focus, show on any focusout) is unreliable: (1) `focusout` fires even when tabbing between form fields (not closing the keyboard), causing a flash of the CTA between field transitions; (2) it does not account for the Visual Viewport API which is the recommended approach for detecting mobile keyboard presence.
- **Recommendation:** Use `visualViewport.resize` event with a height threshold check (e.g., viewport height < 60% of screen height) for more reliable keyboard detection. Alternatively, debounce the `focusout` handler by ~300ms to avoid flicker.

---

## Nits

### C19 -- Hardcoded country code `'NL'` in multiple locations
- **Severity:** Nit
- **Files:** `src/components/interactive/CheckoutPage.tsx` (line 53), `src/components/interactive/checkout/ExpressCheckout.tsx` (line 91, 169)
- **Issue:** The default country code `'NL'` is hardcoded in the initial form state and Express Checkout's `paymentRequest({ country: 'NL' })`. For multi-merchant support (with merchants potentially in Belgium, Germany), this should derive from merchant config.
- **Recommendation:** Use `merchant.defaultCountry ?? 'NL'` or similar.

### C20 -- Spinner SVG duplicated in three places
- **Severity:** Nit
- **Files:** `CheckoutPage.tsx` (lines 372-386), `PlaceOrderButton.tsx` (lines 58-72)
- **Issue:** The same loading spinner SVG markup is copy-pasted in the desktop Place Order button and the mobile PlaceOrderButton component.
- **Recommendation:** Extract to a shared `Spinner` component in `src/components/interactive/checkout/` or the existing `icons.tsx`.

### C21 -- `CheckoutPage` calls `useEffect` after an early return
- **Severity:** Nit
- **File:** `src/components/interactive/CheckoutPage.tsx` (lines 111-113, 116-130)
- **Issue:** The merchant hydration guard (`if (!merchant) return`) is placed before several `useEffect` calls. In Preact/React, hooks must not be called conditionally -- they must always execute in the same order. However, since this guard returns on every render until merchant is available (and then never returns early again once hydrated), this is safe in practice but violates the Rules of Hooks specification and will trigger lint warnings with `eslint-plugin-hooks`.
- **Recommendation:** Move the guard after all hook calls, rendering the empty div from within the JSX return.

### C22 -- `$checkoutTotals` returns `'0.00'` strings, not currency-formatted
- **Severity:** Nit
- **File:** `src/stores/checkout.ts` (line 17)
- **Issue:** The fallback values `'0.00'` are raw decimal strings, which is fine for `formatPrice` but inconsistent with the computed values which use `display_*` fields. If the display fields use a different format (e.g., `"0,00"` for European locales), the fallback and real values will have different formats.
- **Recommendation:** Document this contract -- that `$checkoutTotals` always returns raw decimal strings suitable for `formatPrice`, not pre-formatted display strings.

### C23 -- CSP header is report-only
- **Severity:** Nit
- **File:** `vercel.json` (lines 21-24)
- **Issue:** The Content-Security-Policy for checkout is set as `Content-Security-Policy-Report-Only`. While this is appropriate for initial rollout (to gather violations without breaking functionality), there should be a tracked item to switch to enforcing mode before going to production.
- **Recommendation:** Add a TODO or project tracking item to switch from `-Report-Only` to enforcing mode after validating no legitimate violations occur.

### C24 -- Mock Stripe `on('ready')` callback never fires
- **Severity:** Nit
- **File:** `e2e/helpers/stripe-mock.ts` (line 32)
- **Issue:** The mock Stripe `on` function is a no-op (`function() { return this; }`). This means the `ready` event callback in `StripePaymentForm` (line 69-72) never fires, so `onStripeReady` is never called, `paymentReady` stays `false`, and the Place Order button stays disabled in E2E tests. The mock is sufficient to avoid JS errors but not to test the checkout flow end-to-end.
- **Recommendation:** Have the mock `on('ready', cb)` call `cb()` asynchronously:
  ```js
  on: function(event, cb) {
    if (event === 'ready' && cb) setTimeout(cb, 0);
    return this;
  }
  ```

---

## Design Doc Compliance

| Design Doc Requirement | Status | Notes |
|---|---|---|
| Single Preact island (`CheckoutPage`, `client:load`) | PASS | Correctly implemented |
| Express checkout (Apple Pay / Google Pay) first | PASS | `ExpressCheckout` renders above form |
| Mobile sticky CTA, hidden when keyboard open | PARTIAL | Implemented but keyboard detection is unreliable (C18) |
| Progressive API updates (PATCH on section complete) | FAIL | PATCH endpoint path wrong (C1), no triggers on field blur |
| Guest only (email + phone in form) | PASS | ContactForm collects both |
| Stripe Payment Element | PARTIAL | Component exists but cannot mount due to empty keys (C4) |
| Webhook-first completion with polling fallback | PASS | `CheckoutSuccess` polls checkout status |
| Form validation (client + server errors) | FAIL | No validation implemented (C2) |
| `hideSharedIslands` on checkout pages | PASS | BaseLayout prop used correctly |
| Cache headers: `private, no-store` on checkout | PASS | Middleware line 109-111 |
| CSP for Stripe domains | PASS | vercel.json (report-only, see C23) |
| Referrer-Policy: no-referrer on success page | PASS | vercel.json line 33 |
| PATCH queue with debounce + abort | PASS | `patchDelivery` implements this correctly |
| Fingerprint comparison (cart vs checkout drift) | PASS | `checkoutFingerprint` / `cartFingerprint` |
| Form state persistence in sessionStorage | PASS | `persistFormState` / `restoreFormState` |
| Cross-tab cart change detection | PASS | StorageEvent listener in CheckoutPage |
| Checkout ID in sessionStorage (not localStorage) | PASS | Uses sessionStorage correctly |
| Validate stored IDs | PASS | `validateStorageId` with allowlist regex |

---

## Test Quality Assessment

**Unit tests (checkout.test.ts, checkout-actions.test.ts):** Good coverage of store operations, persistence, and API actions. Tests verify loading states, error handling, and sessionStorage cleanup. The debounce test for `patchDelivery` is well done.

**ContactForm.test.tsx:** Tests rendering, dispatch, blur callbacks, error display, and input types. Good behavioral coverage.

**validate-id.test.ts:** Covers valid UUIDs, path traversal, empty strings, nulls, and injection attempts. Solid security test.

**E2E tests (checkout.spec.ts):** Cover page rendering, fulfillment toggle, contact form, address visibility toggle, scheduling, empty cart redirect, and mobile CTA. However, they cannot test the full checkout flow end-to-end because the mock Stripe `ready` event never fires (C24) and the PATCH endpoint mismatches (C1).

**Missing test coverage:**
- No unit tests for `OrderSummary`, `SchedulingPicker`, `FulfillmentToggle`, `PlaceOrderButton`, `ExpressCheckout`, `StripePaymentForm`
- No test for `handlePlaceOrder` error paths
- No test for the `ensurePaymentAndComplete` `requires_payment_method` status
- No E2E test for the bank-redirect return flow (checkout_id + payment_intent params)
- No test for `restoreFormState` with malformed/stale data structure

---

## Summary Table

| ID | Severity | Category | File | Summary |
|---|---|---|---|---|
| C1 | Critical | Correctness | checkout-actions.ts, ExpressCheckout.tsx, mock-api.ts | PATCH endpoint path mismatch (`/{id}/` vs `/{id}/delivery/`) |
| C2 | Critical | Correctness | CheckoutPage.tsx | No client-side form validation before payment |
| C3 | Critical | Correctness | CheckoutPage.tsx | No double-submit protection on Place Order |
| C4 | Critical | Correctness | CheckoutPage.tsx | Stripe keys are empty strings; Payment Element cannot mount |
| C5 | Major | Security | checkout.ts | `restoreFormState` unsafe cast without schema validation |
| C6 | Major | Accessibility | ContactForm.tsx, DeliveryAddressForm.tsx | Missing `autocomplete` attributes |
| C7 | Major | Correctness | CheckoutHeader.tsx | "Back to cart" links to non-existent page |
| C8 | Major | Security | CheckoutSuccess.tsx | URL parameter rendered without format validation |
| C9 | Major | Correctness | CheckoutSuccess.tsx | Polling timeout not cleared on unmount |
| C10 | Major | Correctness | ExpressCheckout.tsx | Creates duplicate checkout, ignoring existing one |
| C11 | Major | Performance | ExpressCheckout.tsx | Stripe re-initializes on every total change |
| C12 | Minor | Correctness | OrderSummary.tsx | Hardcoded `'en'` in translation call |
| C13 | Minor | Consistency | ExpressCheckout.tsx, CheckoutPage.tsx | `toCents` utility in wrong module |
| C14 | Minor | Consistency | FormDivider.tsx | Returns `null` (dead code, violates codebase pattern) |
| C15 | Minor | Performance | PickupLocationPicker.tsx, DeliveryAddressForm.tsx | Components destroyed on toggle; CSS hidden preferred |
| C16 | Minor | Accessibility | CheckoutPage.tsx | No `<form>` wrapper |
| C17 | Minor | Correctness | StripePaymentForm.tsx | mountedRef not reset on unmount |
| C18 | Minor | UX | PlaceOrderButton.tsx | Unreliable keyboard detection |
| C19 | Nit | Consistency | Multiple | Hardcoded `'NL'` country code |
| C20 | Nit | Consistency | CheckoutPage.tsx, PlaceOrderButton.tsx | Duplicated spinner SVG |
| C21 | Nit | Correctness | CheckoutPage.tsx | Hooks called after early return |
| C22 | Nit | Consistency | checkout.ts | Undocumented `$checkoutTotals` format contract |
| C23 | Nit | Security | vercel.json | CSP is report-only (expected for rollout) |
| C24 | Nit | Testing | stripe-mock.ts | Mock `ready` event never fires |

---

## Verdict: NEEDS REVISION

The checkout flow demonstrates solid architectural decisions -- the store layer, debounced PATCH queue, fingerprint comparison, and sessionStorage isolation are well designed and well tested. The component decomposition follows existing codebase patterns, the Astro page setup is clean, and infrastructure (cache headers, CSP, Referrer-Policy) is thoughtfully configured.

However, four critical issues block shipping:

1. **C1 (PATCH endpoint mismatch)** means delivery updates will fail against the real backend.
2. **C2 (no form validation)** means users can submit blank forms.
3. **C3 (no double-submit guard)** means duplicate payments are possible.
4. **C4 (empty Stripe keys)** means the Payment Element cannot initialize at all.

These must be resolved before the flow is functional. The major issues (C5-C11) should be addressed in this PR or tracked as immediate follow-ups, particularly C6 (autocomplete -- direct conversion impact), C7 (broken back link), and C10 (duplicate checkout creation in express flow).
