# Security & Reliability Critique: Checkout Flow Design

**Role:** Security & Reliability Critic
**Date:** 2026-03-18
**Document under review:** `docs/plans/2026-03-17-checkout-flow-design.md`

---

## 1. Payment Security -- Stripe Integration

### 1.1 Client Secret Exposure in URL Parameters

**Vulnerability/Risk:** For bank-redirect flows (iDEAL, Bancontact), Stripe appends `payment_intent_client_secret` to the return URL as a query parameter. The success page design reads this value from `window.location.search`. Query parameters are logged in web server access logs, Vercel function logs, browser history, analytics tools (PostHog is active in this codebase), and any HTTP referrer headers if the user navigates away from the success page. The `client_secret` grants the ability to confirm or retrieve the PaymentIntent, making its leakage a direct payment security concern.

**Severity:** High

**Recommendation:**
- Set `Referrer-Policy: no-referrer` specifically on the checkout success page to prevent the `client_secret` from leaking via the `Referer` header to external links (e.g., the "Back to menu" link). The current global policy is `strict-origin-when-cross-origin`, which strips the path and query for cross-origin requests but still sends the full URL for same-origin navigations.
- Ensure PostHog and any analytics scripts are blocked or sanitized on the success page to prevent `client_secret` from being captured in pageview URLs. The current codebase loads PostHog via `requestIdleCallback` on every page.
- Clear the query string from the browser URL bar immediately after reading the parameters (via `history.replaceState`).

### 1.2 No Server-Side Amount Validation Before Payment Confirmation

**Vulnerability/Risk:** The flow is: (1) user fills form, (2) frontend calls `POST /checkout/{id}/payment/` to get a `client_secret`, (3) frontend calls `stripe.confirmPayment()`. The design does not mention any mechanism for the frontend to verify that the PaymentIntent amount matches the checkout total displayed to the user. If the backend has a bug or race condition that creates a PaymentIntent with a stale or incorrect amount, the user could be charged an unexpected amount. More critically, there is no description of whether the backend re-validates cart line items, pricing, and totals at PaymentIntent creation time.

**Severity:** Critical

**Recommendation:**
- The `POST /checkout/{id}/payment/` response should include the PaymentIntent `amount` and `currency`. The frontend must compare these against the displayed checkout total before calling `stripe.confirmPayment()`. If they differ, abort and re-fetch the checkout.
- Confirm with the backend team that `POST /payment/` re-validates all line item prices against the current product catalog and recomputes totals atomically. Document this guarantee in the design.

### 1.3 Race Between Checkout Modification and Payment

**Vulnerability/Risk:** The design allows `PATCH /checkout/{id}/delivery/` to be called at any time to update the checkout. There is no locking mechanism described between the delivery PATCH and the payment POST. A malicious or buggy client could: (1) create a checkout with expensive items, (2) call `POST /payment/` to get the `client_secret`, (3) PATCH the checkout to add cheaper items or change fulfillment method, (4) confirm payment at the old (potentially lower or higher) amount.

**Severity:** High

**Recommendation:**
- The backend must either: (a) invalidate the PaymentIntent if the checkout is modified after `POST /payment/`, requiring a new `POST /payment/` call, or (b) use Stripe's `amount` update on the PaymentIntent when the checkout is modified, ensuring the amount is always synchronized.
- The design should explicitly state the backend's behavior when a checkout is modified after a PaymentIntent has been created.

### 1.4 Double-Completion Risk

**Vulnerability/Risk:** The design shows two paths to calling `POST /checkout/{id}/complete/`: (1) inline after `stripe.confirmPayment()` resolves for card payments, and (2) on the success page for bank-redirect returns. If a card payment user is slow and the page also somehow triggers the redirect flow, or if the user manually navigates to the success page URL with fabricated parameters, `/complete/` could be called multiple times. The design mentions "double submit" prevention only for the Place Order button (disabled + spinner), not for the `/complete/` endpoint itself.

**Severity:** High

**Recommendation:**
- The backend `POST /checkout/{id}/complete/` must be idempotent. If the checkout is already completed, it should return the existing order details rather than creating a duplicate order or returning an error.
- The frontend should check `checkout.status` before calling `/complete/` and skip the call if already completed.
- Document the idempotency guarantee explicitly.

---

## 2. CSRF and Session Security

### 2.1 Checkout ID in sessionStorage Is Not Authenticated

**Vulnerability/Risk:** The checkout ID is stored in `sessionStorage` and used as the sole identifier for all checkout API calls. The design is guest-only with no authentication. This means anyone who knows (or guesses) a checkout ID can: read the checkout (GET), modify the delivery address (PATCH), trigger payment (POST /payment/), or complete the order (POST /complete/). Checkout IDs from the backend are likely UUIDs, which are not guessable, but this should be explicitly confirmed.

**Severity:** Medium

**Recommendation:**
- Confirm that checkout IDs are UUIDv4 (122 bits of entropy) and not sequential integers or short alphanumeric strings.
- Consider having the backend return a checkout-scoped bearer token at creation time (similar to how the cart uses HMAC signing) that must be sent with all subsequent checkout requests. This prevents IDOR even if the UUID is somehow leaked (e.g., in logs, analytics, or URL referrers).
- At minimum, bind the checkout to the cart ID and validate that the requesting client's cart matches.

### 2.2 No CSRF Protection on Checkout Mutations

**Vulnerability/Risk:** The checkout endpoints (POST create, PATCH delivery, POST payment, POST complete) are state-mutating and called from the browser. The existing codebase uses HMAC signing (`X-Vendor-Signature` header) on write requests, which provides some CSRF protection since an attacker cannot forge the signature. However, the `hmacSecret` is embedded in the merchant JSON config files and is stripped from the client-side serialization in `BaseLayout.astro`. The client-side SDK (`src/lib/api.ts`) still passes `merchant.hmacSecret` to `createStorefrontClient` -- but the client-side merchant object has had `hmacSecret` stripped. This means **client-side write requests are not HMAC-signed**.

**Severity:** High

**Recommendation:**
- Verify whether client-side API calls actually include HMAC signatures. Based on the code, `BaseLayout.astro` strips `hmacSecret` before serializing to `window.__MERCHANT__`, but `api.ts` reads `merchant.hmacSecret` from the store. If the stripped value is `undefined`, the signing fetch wrapper is not applied, and client-side writes go unsigned. If the backend enforces HMAC on all writes, client-side checkout calls will fail. If the backend does not enforce HMAC, there is no CSRF protection.
- Implement explicit CSRF protection for checkout endpoints: either a synchronizer token pattern, `SameSite=Strict` cookies with session binding, or `Origin` header validation on the backend.

### 2.3 Checkout ID Validation Pattern Missing

**Vulnerability/Risk:** The cart store (`src/stores/cart.ts`) validates cart IDs from `localStorage` against a strict regex (`/^[a-zA-Z0-9_-]+$/`) to prevent path traversal. The checkout design does not mention equivalent validation for the checkout ID read from `sessionStorage`. A tampered `sessionStorage` value could inject path traversal characters into API URLs like `/api/v1/checkout/{id}/delivery/`.

**Severity:** Medium

**Recommendation:**
- Apply the same ID validation pattern used for cart IDs to checkout IDs. Validate the checkout ID against `/^[a-zA-Z0-9_-]+$/` immediately after reading from `sessionStorage`, and clear the stored value if invalid. The cart store implementation is the exact pattern to follow.

---

## 3. Input Validation

### 3.1 Client-Side Only Validation Described

**Vulnerability/Risk:** Section 8 of the design specifies client-side validation (on blur) for email, phone, names, and address fields. There is no mention of server-side validation. Client-side validation is trivially bypassed. If the backend does not independently validate these fields, the system is vulnerable to: malformed data persisted in the database, injection attacks if any field is rendered in admin UIs or emails without sanitization, and data quality issues affecting order fulfillment.

**Severity:** High

**Recommendation:**
- Document the backend validation contract explicitly. Every field accepted by `PATCH /delivery/` must be validated server-side: email format (RFC 5322), phone format (E.164 or regional), address field lengths and character sets, and postal code format per country.
- The frontend should display backend validation errors returned in the PATCH response (the design mentions this for invalid addresses but not other fields).

### 3.2 Phone Field Lacks Format Validation

**Vulnerability/Risk:** The design specifies `type="tel"` for the phone field and marks it as required, but does not specify format validation. `type="tel"` provides no browser-level format enforcement -- it only changes the mobile keyboard. Users can enter arbitrary strings. Phone numbers are commonly used for order notifications (SMS) and delivery driver contact. Invalid phone numbers cause operational failures.

**Severity:** Medium

**Recommendation:**
- Use a well-tested phone number library (e.g., `libphonenumber-js`, ~3 KB gzipped) for client-side validation. Validate against the merchant's configured country.
- Ensure the backend enforces E.164 format or equivalent.

### 3.3 XSS via Checkout Object Rendering

**Vulnerability/Risk:** The checkout object returned from the API will be rendered in the order summary and success page. If any field (product names, address lines, error messages) contains malicious HTML/JS and is rendered without escaping, XSS is possible. The codebase has `sanitizeHtml` and `escapeHtml` utilities in `src/lib/sanitize.ts`, but the design does not specify their use in checkout components. Preact's JSX auto-escapes text content by default, which mitigates the most common vectors, but unsafe inner HTML patterns would bypass this.

**Severity:** Low (mitigated by Preact's default escaping)

**Recommendation:**
- Establish a rule: no raw HTML injection in any checkout component. All API-sourced text must go through JSX text interpolation.
- If the backend returns HTML in any checkout field (e.g., merchant terms), use `sanitizeHtml()` before rendering.

---

## 4. Rate Limiting and Abuse

### 4.1 Unrestricted Checkout Creation

**Vulnerability/Risk:** `POST /api/v1/checkout/` creates a new checkout (and presumably a Stripe PaymentIntent or at least a server-side resource) each time. There is no mention of rate limiting. An attacker could spam this endpoint to: exhaust server resources, create thousands of Stripe PaymentIntents (which count toward Stripe API rate limits and may incur costs), and pollute the database with abandoned checkouts.

**Severity:** High

**Recommendation:**
- Rate limit checkout creation per IP address (e.g., 10 per minute) and per cart ID (e.g., 3 active checkouts per cart).
- The frontend should reuse existing checkouts (the sessionStorage recovery path handles this), but the backend must also enforce limits.
- Consider deferring PaymentIntent creation to `POST /payment/` rather than `POST /checkout/` to avoid creating Stripe resources for abandoned checkouts.

### 4.2 Time Slot Reservation Abuse

**Vulnerability/Risk:** The design describes slot reservation on delivery PATCH: selecting a slot increments `reserved_count`, changing a slot releases the old and reserves the new. An attacker could repeatedly PATCH different slots to artificially deplete capacity across all slots, effectively performing a denial-of-service on the merchant's pickup schedule.

**Severity:** High

**Recommendation:**
- Rate limit `PATCH /delivery/` per checkout ID (e.g., 10 per minute).
- Limit the number of slot changes per checkout (e.g., 5 changes max, then require a new checkout).
- Implement slot reservation TTL (the design mentions "backend TTL or cleanup job" but this needs to be short -- 10-15 minutes -- to prevent sustained slot hoarding).
- Consider not reserving slots at delivery PATCH time; instead, reserve atomically at `POST /payment/` time when the user commits to paying.

### 4.3 Delivery PATCH as an Oracle

**Vulnerability/Risk:** `PATCH /delivery/` accepts arbitrary addresses and returns shipping rates and costs. Without rate limiting, this endpoint could be used to enumerate delivery zones, extract pricing information for competitive intelligence, or probe the shipping provider integrations.

**Severity:** Low

**Recommendation:**
- Rate limit the endpoint per checkout ID and per IP.
- Ensure the backend does not return overly detailed error messages about why an address is outside the delivery zone.

---

## 5. Data Exposure and Privacy

### 5.1 PII in Checkout API Responses

**Vulnerability/Risk:** The checkout object returned by the API likely contains: email, phone, first name, last name, full delivery address, and potentially partial payment information. This object is stored in a Preact nanostore (`$checkout`) accessible to any JavaScript on the page. If a third-party script (PostHog, Stripe.js, or a compromised dependency) reads the global state, PII could be exfiltrated.

**Severity:** Medium

**Recommendation:**
- Audit the checkout API response to ensure it does not return more PII than necessary for the frontend's rendering needs.
- Do not store sensitive PII (email, phone) in the nanostore if it is only needed by the form component locally. The design already mentions form field state is "local to the Preact island via useState/useReducer" -- ensure this principle is strictly followed and PII never flows into the global `$checkout` store.
- Ensure PostHog's session recording (if enabled) is configured to mask form inputs on the checkout page.

### 5.2 GDPR Compliance for Guest Checkout Data

**Vulnerability/Risk:** Guest checkout collects email, phone, name, and address without account creation. Under GDPR: (a) there must be a legal basis for processing (legitimate interest or consent), (b) a privacy notice must be displayed at the point of data collection, (c) data retention limits must be defined and enforced, and (d) guest data must be deletable upon request. The design does not mention any of these requirements.

**Severity:** High (regulatory)

**Recommendation:**
- Add a brief privacy notice or link to the privacy policy near the email field (e.g., "We use your details to process and deliver your order. See our Privacy Policy.").
- Define a data retention period for abandoned checkout data (e.g., 30 days) and completed order data (e.g., per local tax law requirements, typically 7 years for financial records but personal data should be minimized).
- Ensure the backend supports data deletion for guest orders by email address to comply with GDPR right-to-erasure requests.
- Consider adding a marketing consent checkbox if the merchant wants to reuse the email for promotional purposes.

### 5.3 Checkout Data Not Protected by Cache Headers

**Vulnerability/Risk:** The middleware's `CACHEABLE_PATTERNS` do not include `/checkout`. The design mentions adding `no-store` cache headers for checkout routes (Section 12, "Modified Files"), which is correct. However, if this is missed during implementation, checkout pages containing PII could be cached by CDN edge nodes or browser back-forward caches.

**Severity:** Medium

**Recommendation:**
- Explicitly add checkout routes to the middleware's cache control logic with `private, no-store, no-cache, must-revalidate`.
- Include the success page (`/checkout/success`) in this rule as well, since it displays order details.
- Add an E2E test that verifies the `Cache-Control` header on checkout responses.

---

## 6. Stripe Webhook Reliability

### 6.1 No Webhook Fallback for Completion

**Vulnerability/Risk:** This is the most critical reliability gap in the design. The entire order completion depends on the frontend calling `POST /checkout/{id}/complete/` after Stripe confirms payment. If the user closes the browser, loses network connectivity, or the tab crashes after `stripe.confirmPayment()` succeeds but before `/complete/` fires, the payment is captured but no order is created. The customer is charged with no order record. The design does not mention Stripe webhooks at all.

**Severity:** Critical

**Recommendation:**
- Implement a Stripe `payment_intent.succeeded` webhook handler on the backend that automatically completes the checkout if it has not already been completed. This is the standard Stripe-recommended pattern and the only reliable way to handle payment completion.
- The webhook should be the **primary** completion mechanism. The frontend `/complete/` call should be a "fast path" optimization that completes the checkout before the webhook arrives, but the system must not depend on it.
- Use Stripe's webhook signature verification (`stripe-signature` header) to prevent spoofed webhook events.
- Implement idempotency so that both the webhook and the frontend `/complete/` call can fire without creating duplicate orders.

### 6.2 Bank Redirect Return Fragility

**Vulnerability/Risk:** For iDEAL/Bancontact payments, the user is redirected to their bank, then back to the success page. The success page reads the `payment_intent` from query params and calls `/complete/`. If the redirect URL is bookmarked, shared, or visited after the checkout is cleaned up, the completion will fail. If the user's browser blocks the redirect-back (popup blockers, network issues), the order is never completed despite successful payment.

**Severity:** High

**Recommendation:**
- This is fully mitigated by implementing the webhook fallback from 6.1.
- The success page should gracefully handle the case where the checkout is already completed (by webhook) when it tries to call `/complete/`.
- Add a "checking your payment status..." loading state on the success page that polls the order status if the initial `/complete/` call returns a "checkout not found" or "already completed" response.

### 6.3 Abandoned Checkout Cleanup and Slot Release

**Vulnerability/Risk:** The design mentions "backend TTL or cleanup job" for releasing reserved time slots on abandoned checkouts. If the cleanup job fails or runs infrequently, slots remain reserved indefinitely. This is particularly dangerous combined with the slot reservation abuse described in 4.2.

**Severity:** Medium

**Recommendation:**
- Define a specific TTL for checkout abandonment (e.g., 30 minutes of inactivity).
- The cleanup job should run at least every 5 minutes.
- Slot reservations should have their own independent TTL that is shorter than the checkout TTL (e.g., 15 minutes).
- Log slot release events for operational monitoring.

---

## 7. Third-Party Script Risks

### 7.1 No Content Security Policy (CSP)

**Vulnerability/Risk:** The codebase has no CSP header. The `vercel.json` includes `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`, and `Permissions-Policy` -- but no `Content-Security-Policy`. Without CSP, any injected script (via XSS, compromised dependency, or browser extension) can execute freely, exfiltrate form data, and intercept Stripe payment details. This is particularly dangerous on the checkout page where payment card details are entered.

**Severity:** Critical

**Recommendation:**
- Implement a Content-Security-Policy header. A starting policy for the checkout page:
  ```
  default-src 'self';
  script-src 'self' https://js.stripe.com;
  frame-src https://js.stripe.com https://hooks.stripe.com;
  connect-src 'self' https://api.stripe.com <API_BASE_URL>;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https:;
  ```
- Note: The inline scripts in `BaseLayout.astro` (PostHog stub, merchant JSON injection, localStorage check) will require either `nonce`-based CSP or refactoring into external scripts. `'unsafe-inline'` for `script-src` would negate most of CSP's XSS protection.
- Start with `Content-Security-Policy-Report-Only` to identify violations before enforcing.

### 7.2 No Subresource Integrity (SRI) for Stripe.js

**Vulnerability/Risk:** Stripe.js is loaded from `https://js.stripe.com`. If Stripe's CDN is compromised or a MITM attack occurs (unlikely but possible in some network environments), a malicious script could replace Stripe.js and intercept payment card details. Stripe explicitly advises against SRI because they frequently update their JavaScript, but this creates a trust dependency on Stripe's infrastructure.

**Severity:** Low (Stripe's infrastructure is robust, and they explicitly recommend against SRI)

**Recommendation:**
- Do NOT use SRI for Stripe.js (Stripe's official guidance -- they rotate script hashes frequently).
- Instead, rely on CSP to restrict which domains can serve scripts (see 7.1).
- Ensure Stripe.js is loaded only on checkout pages, not globally. Loading it on every page via `BaseLayout.astro` would unnecessarily expand the attack surface.
- Use `loadStripe` from `@stripe/stripe-js` (which the design already specifies) rather than a raw `<script>` tag, as the npm package handles loading correctly.

### 7.3 PostHog on Checkout Pages

**Vulnerability/Risk:** PostHog analytics loads on every page including checkout. Session recordings and event captures could inadvertently collect PII (email, phone, name) and payment-adjacent data. Even without session recording, pageview events with checkout URLs may capture query parameters containing Stripe secrets (see 1.1).

**Severity:** Medium

**Recommendation:**
- Configure PostHog to mask all input elements on checkout pages (`maskAllInputs: true` in the session recording config).
- Strip query parameters from pageview URLs sent to PostHog on the checkout success page.
- Consider disabling PostHog session recording entirely on the checkout flow and using only event-based analytics with sanitized properties.

---

## Summary of Findings by Severity

| # | Finding | Severity |
|---|---------|----------|
| 6.1 | No webhook fallback for order completion | Critical |
| 1.2 | No server-side amount validation before payment | Critical |
| 7.1 | No Content Security Policy header | Critical |
| 1.1 | Client secret exposure in URL / referrer / analytics | High |
| 1.3 | Race between checkout modification and payment | High |
| 1.4 | Double-completion risk without idempotency guarantee | High |
| 2.2 | Client-side HMAC signing gap / no CSRF protection | High |
| 3.1 | Client-side only validation described | High |
| 4.1 | Unrestricted checkout creation | High |
| 4.2 | Time slot reservation abuse | High |
| 5.2 | GDPR compliance gaps for guest data | High |
| 6.2 | Bank redirect return fragility | High |
| 2.1 | Checkout ID not authenticated (IDOR risk) | Medium |
| 2.3 | Checkout ID validation pattern missing | Medium |
| 3.2 | Phone field lacks format validation | Medium |
| 5.1 | PII in checkout API responses / nanostore exposure | Medium |
| 5.3 | Checkout cache header implementation risk | Medium |
| 6.3 | Abandoned checkout cleanup and slot release TTL | Medium |
| 7.3 | PostHog PII capture on checkout pages | Medium |
| 3.3 | XSS via checkout object rendering | Low |
| 4.3 | Delivery PATCH as a pricing oracle | Low |
| 7.2 | No SRI for Stripe.js (accepted risk) | Low |

---

## Top 3 Recommendations Before Implementation

1. **Implement Stripe webhooks as the primary completion mechanism.** The frontend `/complete/` call is a convenience optimization, not the source of truth. Without webhooks, any browser-side failure after payment confirmation results in charged customers with no orders. This is a business-critical reliability gap.

2. **Add a Content Security Policy header.** The checkout page handles payment card data via Stripe Elements. Without CSP, the page has no defense against script injection. Start with report-only mode and the policy outlined in 7.1, then enforce before launch.

3. **Validate the HMAC signing path for client-side checkout API calls.** The current code strips `hmacSecret` from the client-side merchant object but the API client attempts to read it. Either the client-side calls are going unsigned (CSRF risk) or they will fail at runtime. Resolve this ambiguity and implement explicit CSRF protection for checkout mutations.
