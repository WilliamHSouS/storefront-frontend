# Code Review Round 2 -- Checkout Flow Implementation

**Date:** 2026-03-18
**Branch:** `emdash/checkout-8al`
**Reviewer:** Claude Opus 4.6 (automated)
**Scope:** Verify Round 1 fixes (commits `bd1de58`, `e2ce71d`, `26c23e9`) and check for regressions

---

## Round 1 Fix Verification

### Critical Issues

| ID | Issue | Verdict | Notes |
|---|---|---|---|
| C1 | PATCH endpoint path mismatch | **FIXED** | `checkout-actions.ts:66` now uses `/api/v1/checkout/{id}/delivery/`. `ExpressCheckout.tsx:36` (`patchDeliveryImmediate`) also uses `/api/v1/checkout/{id}/delivery/`. Mock API at `mock-api.ts:643-644` matches. |
| C2 | No client-side form validation | **FIXED** | `CheckoutPage.tsx:224-254` implements `validateForm()` checking email regex, phone, firstName, lastName, and delivery address fields when `fulfillmentMethod === 'delivery'`. Errors displayed via `formErrors` state passed to `ContactForm` and `DeliveryAddressForm`. |
| C3 | No double-submit protection | **FIXED** | `CheckoutPage.tsx:99` adds `isSubmitting` state. `handlePlaceOrder` (line 258) guards with `if (isSubmitting) return` and sets `setIsSubmitting(true)` at line 262 before any async work. Desktop button (line 432) disables on `isSubmitting`. |
| C4 | Stripe keys are empty strings | **FIXED** | `CheckoutPage.tsx:177-216` fetches payment gateways and `initiatePayment` in parallel via `Promise.all`, extracts `publishable_key` and `stripe_account` from the gateway config, and stores them in `stripeConfig` state. `StripePaymentForm` only renders when `stripeConfig?.clientSecret` is truthy (line 397). |

### Major Issues

| ID | Issue | Verdict | Notes |
|---|---|---|---|
| C5 | `restoreFormState` unsafe cast | **FIXED** | `checkout.ts:119-121` now checks `typeof parsed !== 'object' || parsed === null` and spreads over `FORM_STATE_DEFAULTS`: `{ ...FORM_STATE_DEFAULTS, ...parsed }`. |
| C6 | Missing `autocomplete` attributes | **FIXED** | `ContactForm.tsx:16-21` defines fields with `autocomplete` values (`email`, `tel`, `given-name`, `family-name`), applied at line 34. `DeliveryAddressForm.tsx` has `autocomplete="street-address"` (line 40), `autocomplete="address-level2"` (line 68), `autocomplete="postal-code"` (line 97). |
| C7 | CheckoutHeader links to non-existent cart page | **FIXED** | `CheckoutHeader.tsx:12` now links to `/${lang}/` and the translation key is `backToMenu` (line 18). |
| C8 | URL parameter rendered without validation | **FIXED** | `CheckoutSuccess.tsx:25` validates with `/^[a-zA-Z0-9_-]{1,50}$/` regex, rejecting anything that does not match. |
| C9 | Polling timeout not cleared on unmount | **FIXED** | `CheckoutSuccess.tsx:70-73` stores both `clearInterval(pollInterval)` and `clearTimeout(timeoutId)` in `pollCleanupRef.current`. The cleanup effect at lines 16-19 calls it on unmount. |
| C10 | ExpressCheckout creates duplicate checkout | **FIXED** | `ExpressCheckout.tsx:125-137` now reads `$checkout.get()` and reuses the existing checkout if it has an `id`. Only falls through to `createCheckout(cartId)` if no existing checkout is found. |
| C11 | Stripe re-initializes on every total change | **FIXED** | `ExpressCheckout.tsx:216` dependency array is now `[publishableKey, stripeAccount, currency, cartId]` -- `totalInCents` and `merchantName` are removed. The separate effect at line 219 handles total updates via `prRef.current.update()`. |

### Minor Issues

| ID | Issue | Verdict | Notes |
|---|---|---|---|
| C12 | Hardcoded `'en'` in translation | **FIXED** | `OrderSummary.tsx:46` now passes `lang` prop to `t('itemCount_one', lang)`. |
| C13 | `toCents` in wrong module | **FIXED** | `toCents` now lives in `src/lib/currency.ts:19-21`. `ExpressCheckout.tsx:243` re-exports from `@/lib/currency`. `CheckoutPage.tsx:13` imports from `@/lib/currency`. |
| C14 | `FormDivider` returns `null` | **FIXED** | `FormDivider.tsx:9` now returns `<div />` instead of `null`. |
| C15 | Components destroyed on toggle | **NOT FIXED** | `DeliveryAddressForm.tsx:25` still returns `<></>` when `!visible`. `PickupLocationPicker.tsx:20` same. Acceptable as Minor -- form state is in the parent reducer, not the DOM. |
| C16 | No `<form>` wrapper | **NOT FIXED** | Still no `<form>` element. Acceptable as Minor -- custom validation is now in place. |
| C17 | `mountedRef` not reset on unmount | **FIXED** | `StripePaymentForm.tsx:87` cleanup sets `mountedRef.current = false`. |
| C18 | Unreliable keyboard detection | **NOT FIXED** | `PlaceOrderButton.tsx` still uses focusin/focusout. Acceptable as Minor. |

### Nits

| ID | Issue | Verdict |
|---|---|---|
| C19 | Hardcoded `'NL'` | NOT FIXED (acceptable as Nit) |
| C20 | Duplicated spinner SVG | NOT FIXED (acceptable as Nit) |
| C21 | Hooks after early return | NOT FIXED -- see **N1** below |
| C22 | `$checkoutTotals` format contract | NOT FIXED (acceptable as Nit) |
| C23 | CSP report-only | NOT FIXED (expected for rollout) |
| C24 | Mock Stripe `ready` event never fires | **FIXED** | `stripe-mock.ts:32-33` now calls `if (event === 'ready' && cb) setTimeout(cb, 0)`. |

---

## New Issues Introduced by Fixes

### N1 -- `validateForm()` defined after conditional early return (Hooks violation risk)

- **Severity:** Major
- **File:** `src/components/interactive/CheckoutPage.tsx` (lines 113-115, 224-254)
- **Issue:** The hydration guard `if (!merchant) return <div .../>` at line 113 is placed before several `useEffect` calls (lines 118, 135, 143, 153, 165, 177). This is the same issue as C21 from Round 1, but it has now become more consequential: `validateForm()` is defined as a regular function at line 224 (after the early return), and `handlePlaceOrder` (a `useCallback` at line 257) calls it. In Preact/React, all hooks must be called unconditionally and in the same order on every render. The early return at line 113 means that on renders where `merchant` is null, the `useEffect` and `useCallback` hooks at lines 118-299 are never reached.

  In practice this works because `merchant` transitions from `null` to a value exactly once (on hydration) and never goes back. But it is a latent bug: if any future change causes `merchant` to become null after being set (e.g., a store reset on merchant switch), Preact will throw a hooks-order mismatch error. ESLint `rules-of-hooks` will flag this as an error.

- **Recommendation:** Move the hydration guard below all hook calls. Return the empty `<div>` from the JSX body instead:
  ```tsx
  // All hooks declared unconditionally above...

  if (!merchant) return <div class="min-h-screen" />;

  // Non-hook code (validateForm, JSX) below...
  ```
  Alternatively, move the guard to after line 174 (the last `useEffect`) but before `validateForm` at line 224. The key constraint: all `useEffect`/`useCallback`/`useReducer`/`useState` calls must execute on every render.

### N2 -- `validateForm` is a closure that captures stale `form` in `handlePlaceOrder`

- **Severity:** Major
- **File:** `src/components/interactive/CheckoutPage.tsx` (lines 224-254, 257-299)
- **Issue:** `validateForm` is a plain function (not wrapped in `useCallback`) that reads `form` from the component closure. `handlePlaceOrder` is a `useCallback` with dependency array `[isSubmitting, form, checkout, stripeConfig, lang]` (line 299). Because `validateForm` is re-created on every render but `handlePlaceOrder` only re-creates when its deps change, this works correctly today -- `form` is in the dep array, so `handlePlaceOrder` re-creates when `form` changes, picking up the current `validateForm`.

  However, `validateForm` also calls `setFormErrors` and reads `typedLang` and `form.fulfillmentMethod` from the closure. If someone later removes `form` from the dep array (a common mistake when trying to avoid re-renders), validation will read stale form data. This is fragile but not currently broken.

- **Recommendation:** Wrap `validateForm` in `useCallback` with `[form, typedLang]` as deps, or pass `form` as an argument to `validateForm(form)` to make the dependency explicit. Low urgency since it works today.

### N3 -- Payment gateway fetch uses string interpolation, bypassing SDK path validation

- **Severity:** Minor
- **File:** `src/components/interactive/CheckoutPage.tsx` (lines 194-195)
- **Issue:** The gateway fetch uses template literal interpolation with a type assertion:
  ```ts
  client.GET(`/api/v1/checkout/${checkout.id}/payment-gateways/` as '/api/v1/checkout/{id}/payment-gateways/')
  ```
  This bypasses the SDK's path parameter validation. If `checkout.id` contains special characters (unlikely given `validateStorageId`, but possible from a direct API response), the URL could be malformed. The `as` cast silences the type checker entirely.

- **Recommendation:** Use the SDK's `params.path` pattern like the other endpoints:
  ```ts
  client.GET('/api/v1/checkout/{id}/payment-gateways/', {
    params: { path: { id: checkout.id } }
  })
  ```

### N4 -- `handlePlaceOrder` scroll-to-error targets `[role="alert"]` before DOM update

- **Severity:** Minor
- **File:** `src/components/interactive/CheckoutPage.tsx` (lines 247-250)
- **Issue:** `validateForm` calls `setFormErrors(errors)` (line 245) and then immediately queries `document.querySelector('[role="alert"]')` (line 249). In Preact, `setState` is asynchronous -- the `role="alert"` elements from `ContactForm`/`DeliveryAddressForm` have not been rendered into the DOM yet when the querySelector runs. The scroll will either find nothing or find a stale alert from a previous validation attempt.

- **Recommendation:** Defer the scroll to the next frame:
  ```ts
  requestAnimationFrame(() => {
    const firstError = document.querySelector('[role="alert"]');
    firstError?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  ```

### N5 -- Mobile `PlaceOrderButton` does not respect `isSubmitting` state

- **Severity:** Major
- **File:** `src/components/interactive/checkout/PlaceOrderButton.tsx` (lines 50-54)
- **Issue:** The desktop Place Order button (CheckoutPage.tsx:432) disables on `loading || isSubmitting || !paymentReady`. But the mobile `PlaceOrderButton` component only checks `loading` (from `$checkoutLoading` store, line 53). It does not receive or check `isSubmitting` or `paymentReady`. This means:
  1. On mobile, the button is clickable before Stripe is ready (`paymentReady` is not checked).
  2. On mobile, rapid double-taps are not guarded by `isSubmitting` -- the local guard in `handlePlaceOrder` prevents duplicate execution, but the button does not visually disable, which is confusing and could lead to user frustration or repeated taps.

- **Recommendation:** Pass `isSubmitting` and `paymentReady` as props to `PlaceOrderButton` and include them in the disabled condition. Alternatively, set `$checkoutLoading` to `true` at the start of `handlePlaceOrder` so the existing store-based check covers it.

### N6 -- `restoreFormState` spread allows prototype pollution from crafted sessionStorage

- **Severity:** Minor
- **File:** `src/stores/checkout.ts` (lines 119-121)
- **Issue:** `{ ...FORM_STATE_DEFAULTS, ...parsed }` spreads any JSON-parsed object over the defaults. While `JSON.parse` cannot produce objects with `__proto__` as an own property (it would be a regular key), a crafted sessionStorage value could include unexpected keys like `constructor` or any field not in `CheckoutFormState`. These extra keys would propagate into the form state object and eventually into the reducer. This is low risk because: (a) the attacker would need access to the same browser session, and (b) the form reducer only reads known fields. But it is defense-in-depth to strip unknown keys.

- **Recommendation:** Explicitly pick known fields:
  ```ts
  return {
    ...FORM_STATE_DEFAULTS,
    email: typeof parsed.email === 'string' ? parsed.email : FORM_STATE_DEFAULTS.email,
    // ... etc
  };
  ```
  Low urgency given the threat model.

---

## Summary of New Issues

| ID | Severity | Category | Summary |
|---|---|---|---|
| N1 | Major | Correctness | Hooks called after conditional early return -- latent hooks-order violation |
| N2 | Major | Correctness | `validateForm` closure captures form implicitly -- fragile but not currently broken |
| N3 | Minor | Security | Gateway fetch uses string interpolation + type cast, bypassing SDK path validation |
| N4 | Minor | UX | Scroll-to-error fires before Preact renders the error elements into the DOM |
| N5 | Major | Correctness | Mobile PlaceOrderButton ignores `isSubmitting` and `paymentReady` -- double-tap possible, button active before Stripe ready |
| N6 | Minor | Security | `restoreFormState` spread does not strip unknown keys |

---

## Verdict: PASS WITH CONDITIONS

All four Critical issues (C1-C4) from Round 1 are correctly fixed. All seven Major issues (C5-C11) are fixed. The fixes are well-implemented and introduce no regressions in the resolved areas.

Three new Major-severity issues were identified:

1. **N1 (hooks after early return):** Should be fixed before merge. The fix is mechanical -- move the guard below the hooks. Risk: production crash if merchant store ever resets.
2. **N2 (validateForm closure):** Fragile but works today. Can be deferred to a follow-up.
3. **N5 (mobile button ignores isSubmitting/paymentReady):** Should be fixed before merge. On mobile viewports, users can tap Place Order before Stripe is ready, and the button does not visually disable during submission. The fix is passing two additional props.

**Conditions for PASS:**
- Fix **N1** -- move hydration guard below all hook declarations.
- Fix **N5** -- pass `isSubmitting` and `paymentReady` to `PlaceOrderButton`.

**Recommended follow-ups (non-blocking):**
- N4 -- defer scroll-to-error with `requestAnimationFrame`.
- N3 -- use SDK `params.path` pattern for gateway fetch.
