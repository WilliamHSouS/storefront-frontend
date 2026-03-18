# UX & Conversion Critique: Checkout Flow Design

**Role:** UX & Conversion Critic
**Date:** 2026-03-18
**Document under review:** `docs/plans/2026-03-17-checkout-flow-design.md`

---

## 1. Single Page vs Progressive Disclosure

**Concern:** The design states "every section visible on one scrollable page" as a conversion principle, but this conflates "fewer page transitions" with "fewer perceived steps." On mobile, the proposed layout stacks Contact (4 fields) + Fulfillment toggle + Address (3 fields) + Scheduling (toggle + date pills + time slots) + Stripe Payment Element into a single scroll. That is approximately 1800-2200px of form content before the user even reaches the Place Order button. Baymard Institute research consistently shows that *perceived* complexity drives abandonment more than actual step count. A single long form can feel more overwhelming than a clean 2-3 step accordion, even if both contain the same fields.

The design also creates a subtle API timing problem: Stripe Payment Element is mounted at the bottom of the page. On a slow connection, the user scrolls past empty/loading Stripe UI, which erodes trust at the most sensitive moment of checkout. With progressive disclosure, the payment section only renders once the user has committed to the prior steps, giving Stripe more time to initialize invisibly.

**Severity:** Major

**Recommendation:** Use an accordion or "smart collapse" pattern instead of a flat scroll. Each section (Contact, Fulfillment + Address, Scheduling, Payment) starts collapsed except the current one. Completed sections collapse into a summary line showing what the user entered (e.g., "john@example.com, +31 6 1234 5678") with an Edit button. This preserves the single-page nature (no route transitions, no lost state) while reducing visible complexity at any given moment. Stripe Payment Element initializes in the background but only becomes visible when the user reaches it, which also avoids the "loading payment form" trust gap.

As evidence from this codebase: the existing `CartDrawer` already uses progressive disclosure well -- it collapses the footer totals section behind a scroll boundary and puts the CTA at the end. The checkout should follow the same instinct.

---

## 2. Mobile Sticky CTA

**Concern:** The sticky bottom bar pattern is well-established, but there are three specific risks in this design:

**2a. Viewport consumption.** The existing `CartBar` component is 52px tall (`py-3` + text). The proposed Place Order bar will need to be at least as tall, plus it includes the order total. Combined with `env(safe-area-inset-bottom)` on devices with home indicators (iPhone: 34px), the sticky bar consumes 86px+ of viewport. On an iPhone SE (viewport height 548px) or older Android devices (~600px), that is 14-16% of the screen permanently lost. When the mobile keyboard is open (typically 260-300px), the visible content area shrinks to roughly 200px. If the sticky bar remains visible during keyboard input, the user sees the bar, the active input field, and almost nothing else -- no context about where they are in the form.

**2b. Keyboard overlap.** The design does not specify behavior when the virtual keyboard is open. On iOS Safari, `position: fixed` elements shift unpredictably with the visual viewport. The sticky bar may float over the form or disappear entirely depending on the OS version. On Android Chrome, `position: fixed` elements typically stay anchored, but the reduced viewport makes them dominate the screen.

**2c. Double CTA on desktop.** The desktop layout shows "Place order" both inline at the bottom of the left column AND presumably the sticky bar is hidden at `md+`. This is fine, but the design should explicitly confirm the sticky bar is `md:hidden` to avoid a confusing double button.

**Severity:** Major (2a, 2b), Minor (2c)

**Recommendation:**
- Hide the sticky CTA when any input is focused (listen for `focusin`/`focusout` on the form container). This recovers screen space during active typing. The CTA reappears when the user dismisses the keyboard.
- Explicitly use `md:hidden` on the sticky bar, matching the existing `CartBar` pattern (`class="fixed bottom-0 left-0 right-0 z-40 md:hidden"`).
- Consider making the sticky bar appear only after the user scrolls past the inline Place Order button, using an `IntersectionObserver`. This way it acts as a persistent reminder only when the inline button is out of view, rather than permanently consuming space.

---

## 3. Order Summary Collapse on Mobile

**Concern:** The design collapses the order summary by default on mobile ("3 items . EUR 24.50 [chevron]"). The rationale is presumably to save vertical space. However, this creates a trust deficit at the moment of payment. Research from the Baymard Institute (2023 checkout usability study) found that 17% of users abandoned checkout because they "couldn't see / calculate the total order cost up-front." When the summary is collapsed, users who want to verify what they are paying for must actively tap to expand -- an extra interaction that many will not take, leading to either anxiety-driven abandonment or post-purchase regret.

This is particularly problematic because the design uses progressive API updates: the total changes as the user selects fulfillment method and shipping rate. If the summary is collapsed, the user does not see these total changes happening, which undermines the "totals always reflect current state" principle.

**Severity:** Critical

**Recommendation:** Default the order summary to **expanded** on mobile for carts with 3 or fewer items (which covers the majority of restaurant orders). For larger carts (4+ items), collapse the item list but keep the totals breakdown (subtotal, shipping, tax, total) always visible. The total line should be visible at all times regardless of collapse state -- the collapsible portion should be the line items only, not the price breakdown.

On desktop, the sticky sidebar already handles this well. The gap is specifically on mobile where the collapsed summary hides the information users need most.

---

## 4. Form Field Ordering

**Concern:** The proposed order is: Contact Info -> Fulfillment Toggle -> Address -> Scheduling -> Payment. There are two issues:

**4a. Express checkout is buried.** Apple Pay, Google Pay, and iDEAL (via Stripe Payment Element) can complete checkout with a single tap or bank redirect. These users do not need to fill in contact info, address, or scheduling first. By placing payment last, the design forces express-checkout users through 8+ form fields before they reach the one-tap option. This is a significant conversion miss for the Netherlands market specifically, where iDEAL accounts for ~60% of online payments. The Stripe Payment Element will show iDEAL prominently for Dutch users -- but only after they have already filled out their entire address.

**4b. Fulfillment before contact is arguably better.** The first decision the user makes (delivery vs pickup) determines the rest of the form. If they choose pickup, the address section disappears entirely. Showing fulfillment first reduces perceived form length immediately. Contact info (email, phone, name) is less variable -- everyone fills it out. Putting the "branching" decision first gives the user a sense of control and reduces the chance they fill in an address only to switch to pickup and feel they wasted effort.

**Severity:** Critical (4a), Minor (4b)

**Recommendation:**
- Add an **express checkout section at the very top**, above the form. Show Apple Pay / Google Pay buttons (via Stripe Payment Request Button Element) and an iDEAL quick-pay option. These require zero form fields -- Stripe handles contact info collection within the express flow. If the user does not use express checkout, they proceed to the manual form below. This is the pattern used by Shopify Checkout, Amazon, and virtually every high-converting e-commerce checkout.
- Reorder the manual form to: Fulfillment Toggle -> Contact Info -> Address (conditional) -> Scheduling -> Payment. Lead with the decision that shapes the rest of the form.

---

## 5. Scheduling Picker UX

**Concern:** The design proposes horizontal-scroll pills for dates and vertical list for time slots. Several issues:

**5a. Horizontal scroll discoverability.** Horizontal scroll containers are notoriously low-discoverability on mobile. There is no universal affordance for "swipe sideways." If the merchant offers scheduling 7+ days out, users may not realize dates beyond the visible 3-4 pills exist. The design shows `[Today] [Mar 18] [Mar 19] [+]` -- what does `[+]` mean? A "show more" button? A calendar? This is ambiguous.

**5b. Accessibility gaps.** Horizontal scroll pill lists are difficult for screen reader users and keyboard navigation. `role="tablist"` with arrow key navigation would be the correct ARIA pattern, but the design does not mention this. The time slot list ("14:00-14:30", "14:30-15:00") needs `role="radiogroup"` semantics with `aria-disabled` for full slots rather than visual-only greying.

**5c. Time slot density.** For a restaurant with 30-minute slots over a 10-hour day, that is 20 time slots rendered as a vertical list. On mobile, this pushes the Payment section far down the page (exacerbating the single-page scroll problem from point 1). Users must scroll through unavailable ("Full") slots to find open ones.

**5d. No time zone handling.** Restaurant ordering is local, but the design does not mention how times are displayed. If the API returns UTC times, the frontend must convert to the merchant's local timezone, not the user's browser timezone (a user ordering from a different timezone should see the restaurant's local time).

**Severity:** Major (5a, 5b), Minor (5c, 5d)

**Recommendation:**
- Replace horizontal pills with a **dropdown or compact calendar widget** for dates. A native `<select>` element for dates is accessible by default, works on every device, and does not have discoverability issues. For a more polished UX, use a small inline calendar (7-day strip with left/right arrows, not scroll).
- Implement proper ARIA: `role="radiogroup"` for time slots, `aria-disabled="true"` + `aria-label="Full"` for unavailable slots. Use `role="listbox"` or `role="radiogroup"` -- not a plain `<div>` list.
- Filter out unavailable slots by default, with a "Show all times" toggle if the user wants to see the full schedule. This reduces the list length significantly.
- Explicitly convert API times to the merchant's configured timezone (available in `MerchantConfig`) before display.

---

## 6. Fulfillment Toggle

**Concern:** The design says "Default: Delivery (if the user's address is eligible). Falls back to pickup-only if address is outside delivery zone." This creates several awkward states:

**6a. Premature default.** Delivery is the default, but at the point the toggle renders, the user has not entered their address yet (address form comes after the toggle). So "if the user's address is eligible" cannot be evaluated. The default is actually "delivery regardless of eligibility" until an address is entered and validated. The user may fill in their entire address, trigger the delivery PATCH, and only then discover delivery is not available to them. That is a frustrating backtrack.

**6b. Showing unavailable options.** If the merchant only supports pickup (no delivery zone configured), should the toggle still show both options? The design does not address single-fulfillment merchants. Showing a "Delivery" option that immediately errors ("Not available in your area") is worse than not showing it at all.

**6c. Address-dependent toggling.** The existing `FulfillmentOverlay` component already handles fulfillment eligibility at the product level based on `$addressCoords`. But the checkout design does not reference this existing pattern. If a user entered their postcode on the menu page (via `AddressBar`), the checkout should pre-populate the address and pre-evaluate delivery eligibility using the already-stored `$addressCoords`.

**Severity:** Major (6a), Minor (6b), Major (6c)

**Recommendation:**
- **Pre-populate from `$addressCoords`.** If the user already entered their postcode on the menu page, hydrate the address form and evaluate delivery eligibility immediately on checkout load. This is data that already exists in the `address` store.
- **For merchants with only one fulfillment type, skip the toggle entirely.** Render the appropriate section (address or pickup location) without asking the user to choose.
- **For the "address not yet entered" state**, default to delivery but show an inline note: "Enter your address to confirm delivery availability." If the PATCH returns an ineligibility error, switch to pickup automatically with a clear message ("Delivery is not available to your address. We have switched to pickup.") rather than just highlighting fields in red.

---

## 7. Error UX

**Concern:** The design specifies "inline validation on blur" and a table of API error scenarios. Several gaps:

**7a. Scroll-to-error on submit.** The design does not describe what happens when the user taps "Place Order" with validation errors in fields above the fold. On a long single-page form, the error may be in the Contact section while the user is looking at the Payment section. "Inline error messages below each field" are invisible if the field is scrolled out of view. The user taps Place Order, nothing happens (or a generic toast appears), and they do not know why.

**7b. Payment failure recovery.** "Stripe shows inline error in Payment Element" is correct for card-level errors (declined, insufficient funds). But what about the flow after failure? The button re-enables, but the user has no guidance on what to try next. "Payment failed. Please try again." (from the i18n keys) is generic. Does the user need a different card? Is it a temporary issue? Should they try iDEAL instead?

**7c. Network error during PATCH.** The design says "Toast: Connection lost, please try again." But toasts are ephemeral -- they disappear after a few seconds. If the PATCH failed, the checkout is in an inconsistent state (frontend has data the backend does not). The user continues filling out the form, reaches payment, and gets a confusing error because the backend checkout is missing the address. A toast is not sufficient for state-critical errors.

**7d. Slot reservation race condition.** The design acknowledges `SlotFullError` and says "refresh slot list + show toast." But between the refresh and the user selecting a new slot, more slots may fill up. There is no mention of optimistic reservation or hold-while-browsing. For popular restaurants at peak times, this could result in a frustrating loop of "select slot -> slot full -> select another -> slot full."

**7e. No error summary.** For accessibility (WCAG 2.1 SC 3.3.1), form validation errors should be presented as a summary at the top of the form in addition to inline messages. Screen reader users who tab through the form may not encounter inline errors below fields they already passed.

**Severity:** Critical (7a), Major (7b, 7c), Minor (7d), Major (7e)

**Recommendation:**
- **Scroll-to-first-error on submit.** When Place Order is tapped with validation errors, `scrollIntoView({ behavior: 'smooth', block: 'center' })` to the first invalid field, focus it, and announce the error to screen readers via `aria-live="assertive"`. This is the established pattern used by the existing `AddressBar` component for its error state (inline `role="alert"`).
- **Payment failure: contextual guidance.** After a Stripe decline, show a persistent (non-toast) inline message below the Payment Element with specific guidance: "Your payment was declined. Try a different payment method or contact your bank." Include a visible link/button to retry or switch methods.
- **Network errors on PATCH: persistent banner, not toast.** Replace the toast with a persistent error banner at the top of the affected section. The banner stays until the PATCH succeeds on retry. Auto-retry the PATCH once after a 2-second delay before showing the banner.
- **Slot contention: short-lived hold.** When a user taps a time slot, immediately send the PATCH and show a brief "Reserving..." state on the slot pill. If the PATCH succeeds, mark the slot as confirmed. If it fails with `SlotFullError`, grey out that slot inline (no full list refresh needed -- just mark the one slot as full and let the user pick another).
- **Error summary for a11y.** On submit with errors, inject an `aria-live="assertive"` summary at the top of the form: "There are 2 errors: Email is required. Street address is required." Each error links to the corresponding field with `id` anchors.

---

## Summary Table

| # | Issue | Severity | Core Risk |
|---|-------|----------|-----------|
| 1 | Single-page cognitive overload | Major | Perceived complexity drives abandonment |
| 2a | Sticky CTA viewport consumption | Major | Unusable on small phones with keyboard open |
| 2b | Sticky CTA keyboard behavior | Major | iOS/Android fixed-position inconsistencies |
| 3 | Collapsed order summary hides totals | Critical | Users cannot verify what they are paying |
| 4a | Express checkout (Apple Pay/iDEAL) buried | Critical | Majority payment method requires full form first |
| 4b | Fulfillment toggle ordering | Minor | Branching decision should come first |
| 5a | Horizontal scroll date pills | Major | Low discoverability, ambiguous overflow |
| 5b | Scheduling picker accessibility | Major | Missing ARIA roles and keyboard nav |
| 6a | Delivery default before address entry | Major | False promise, frustrating backtrack |
| 6c | Ignoring existing address data | Major | Wastes data already collected on menu page |
| 7a | No scroll-to-error on submit | Critical | User taps Place Order, nothing visible happens |
| 7c | Toast for state-critical errors | Major | Ephemeral notification for persistent problem |
| 7e | No accessible error summary | Major | WCAG violation, screen reader users blocked |

### Top 3 Changes That Would Most Improve Conversion

1. **Add express checkout (Apple Pay / Google Pay / iDEAL) at the top of the page.** This is the single highest-impact change for the Dutch market. One-tap checkout bypasses the entire form.

2. **Keep order totals visible on mobile at all times.** Collapse line items if needed, but never collapse the price breakdown. Users must see what they are paying before they pay.

3. **Implement scroll-to-first-error with focus management.** Without this, every validation error on a long form becomes a silent failure that the user cannot diagnose.
