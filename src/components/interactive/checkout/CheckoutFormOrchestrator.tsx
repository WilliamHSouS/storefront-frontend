import { useEffect, useCallback, useState } from 'preact/hooks';
import { useStore } from '@nanostores/preact';
import { $checkout } from '@/stores/checkout';
import { patchDelivery, cancelPendingPatch } from '@/stores/checkout-actions';
import { persistFormState } from '@/stores/checkout';
import { onAddressChange } from '@/stores/address-actions';
import { $addressCoords } from '@/stores/address';
import { getClient } from '@/lib/api';
import { t } from '@/i18n/client';
import * as log from '@/lib/logger';
import type { CheckoutFormState } from '@/types/checkout';
import type { FormAction } from '../CheckoutPage';
import { ContactForm } from './ContactForm';
import DeliveryAddressForm from './DeliveryAddressForm';
import FulfillmentToggle from './FulfillmentToggle';
import { PickupLocationPicker } from './PickupLocationPicker';
import SchedulingPicker from './SchedulingPicker';

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface CheckoutFormOrchestratorProps {
  lang: 'nl' | 'en' | 'de';
  form: CheckoutFormState;
  dispatch: (action: FormAction) => void;
  formErrors: Record<string, string>;
  setFormErrors: (errors: Record<string, string>) => void;
  checkoutId: string | undefined;
  merchantSlug: string | undefined;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CheckoutFormOrchestrator({
  lang,
  form,
  dispatch,
  formErrors,
  setFormErrors,
  checkoutId,
  merchantSlug,
}: CheckoutFormOrchestratorProps) {
  const checkout = useStore($checkout);

  const [pickupLocations, setPickupLocations] = useState<
    Array<{
      id: number;
      name: string;
      distance_km?: number;
      address?: { street?: string; city?: string; postal_code?: string };
      pickup_instructions?: string;
    }>
  >([]);
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

  // ── Cancel pending PATCH on unmount ──────────────────────────────
  useEffect(() => {
    return () => cancelPendingPatch();
  }, []);

  // ── Fetch pickup locations (merchant-level, not checkout-specific) ──
  useEffect(() => {
    if (!merchantSlug) return;
    const client = getClient();

    client
      .GET('/api/v1/pickup-locations/')
      .then(({ data }) => {
        if (!data || !Array.isArray(data)) return;
        const locs = (
          data as Array<{
            id: number;
            name: string;
            address?: { street?: string; city?: string; postal_code?: string };
            pickup_instructions?: string;
          }>
        ).map((loc) => ({
          id: loc.id,
          name: loc.name,
          distance_km: undefined as number | undefined,
          address: loc.address,
          pickup_instructions: loc.pickup_instructions,
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
  }, [merchantSlug]);

  // ── Determine available fulfillment methods ──
  // Always show delivery (customer can enter address, backend validates).
  // Show pickup when pickup locations exist.
  useEffect(() => {
    const available: ('delivery' | 'pickup')[] = ['delivery'];

    if (pickupLocations.length > 0) available.push('pickup');

    setAvailableFulfillment(available);
  }, [pickupLocations.length]);

  // ── Fetch time slots for a date ────────────────────────────────
  // Uses the location-based /fulfillment/locations/{id}/slots/ endpoint.
  // Falls back to the first pickup location ID. Does not require a checkout.
  const fetchTimeSlots = useCallback(
    async (date: string) => {
      // Need at least one pickup location to get a fulfillment location ID
      const locationId = pickupLocations[0]?.id;
      if (!locationId) {
        setTimeSlots([]);
        return;
      }
      setTimeSlotsLoading(true);
      const client = getClient();

      try {
        const { data } = await client.GET('/api/v1/fulfillment/locations/{location_id}/slots/', {
          params: { path: { location_id: String(locationId) }, query: { date } },
        });

        if (!data) {
          setTimeSlots([]);
          return;
        }
        const response = data as unknown as {
          time_slots?: Array<{
            id?: string;
            start_time: string;
            end_time: string;
            available: boolean;
            capacity?: number;
            reserved_count?: number;
            remaining_capacity?: number;
          }>;
        };
        const slots = (response.time_slots ?? []).map((s) => ({
          ...s,
          id: s.id ?? `${s.start_time}-${s.end_time}`,
          capacity: s.capacity ?? 0,
          reserved_count: s.reserved_count ?? 0,
          remaining_capacity: s.remaining_capacity ?? 0,
        }));
        setTimeSlots(slots);
      } catch (err) {
        log.error('checkout', 'Failed to fetch time slots:', err);
        setTimeSlots([]);
      } finally {
        setTimeSlotsLoading(false);
      }
    },
    [pickupLocations],
  );

  // ── Auto-fetch time slots when in "scheduled" mode ──────────────
  // Fires when: (1) user toggles to "Schedule for later", or (2) page loads
  // with schedulingMode restored as 'scheduled' and pickup locations load.
  useEffect(() => {
    if (form.schedulingMode !== 'scheduled') return;
    if (pickupLocations.length === 0) return; // locations not loaded yet
    if (timeSlots.length > 0) return; // already have slots

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const defaultDate = form.scheduledDate ?? `${yyyy}-${mm}-${dd}`;

    fetchTimeSlots(defaultDate);
  }, [form.schedulingMode, pickupLocations.length]);

  // ── Field-level validation (on blur) ─────────────────────────────
  const validateFieldsForPatch = useCallback((): boolean => {
    const errors: Record<string, string> = {};

    // Only validate fields that have been touched (non-empty)
    if (form.email && !EMAIL_RE.test(form.email)) {
      errors.email = t('emailInvalid', lang);
    }

    // Replace errors (don't merge) — clears fixed errors
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [form.email, lang, setFormErrors]);

  // ── Persist form on blur + trigger delivery PATCH ────────────────
  const handleBlur = useCallback(() => {
    persistFormState(form);

    // Run field validation — don't PATCH if invalid
    if (!validateFieldsForPatch()) return;

    // Only PATCH if checkout exists and we have valid contact + address data
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
      first_name: form.firstName,
      last_name: form.lastName,
      phone_number: form.phone,
      fulfillment_type: form.fulfillmentMethod === 'pickup' ? 'pickup' : 'local_delivery',
    };

    if (form.fulfillmentMethod === 'delivery') {
      deliveryData.shipping_address = {
        street_address_1: form.street,
        city: form.city,
        postal_code: form.postalCode,
        country_code: form.countryCode,
      };

      // Persist address to localStorage + hydrate $addressCoords so the cart
      // shows shipping estimates and the home page remembers the postal code.
      if (
        !$addressCoords.get()?.postalCode ||
        $addressCoords.get()?.postalCode !== form.postalCode
      ) {
        onAddressChange({ postalCode: form.postalCode, country: form.countryCode }).catch(() => {});
      }
    }

    if (form.fulfillmentMethod === 'pickup' && form.pickupLocationId) {
      deliveryData.pickup_location_id = form.pickupLocationId;
    }

    // Only send fulfillment_slot_id if it looks like a valid UUID
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      form.selectedSlotId &&
      form.schedulingMode === 'scheduled' &&
      UUID_RE.test(form.selectedSlotId)
    ) {
      deliveryData.fulfillment_slot_id = form.selectedSlotId;
    }

    patchDelivery(checkoutId, deliveryData);
  }, [form, checkoutId, validateFieldsForPatch]);

  // ── Auto-PATCH when fulfillment method or pickup location changes ──
  // These changes don't come from text field blur, so they need their own trigger
  useEffect(() => {
    // Only if contact info is complete and checkout exists
    if (!checkout?.id) return;
    if (!form.email || !EMAIL_RE.test(form.email)) return;
    if (!form.firstName || !form.lastName || !form.phone) return;

    handleBlur();
  }, [
    form.fulfillmentMethod,
    form.pickupLocationId,
    checkout?.id,
    form.email,
    form.firstName,
    form.lastName,
    form.phone,
    handleBlur,
  ]);

  // ── JSX ──────────────────────────────────────────────────────────
  return (
    <>
      {/* Contact information — always visible */}
      <div class="px-4 py-3">
        <ContactForm
          lang={lang}
          form={form}
          dispatch={dispatch}
          onBlur={handleBlur}
          errors={formErrors}
        />
      </div>

      {/* Fulfillment sections — only after shipping methods are loaded */}
      {availableFulfillment.length > 0 && (
        <>
          <div class="px-4 py-3">
            <FulfillmentToggle
              lang={lang}
              form={form}
              dispatch={dispatch}
              availableMethods={availableFulfillment}
              deliveryEligible={availableFulfillment.includes('delivery') ? true : false}
            />
          </div>

          {/* Delivery address (visible only for delivery) */}
          {form.fulfillmentMethod === 'delivery' && (
            <div class="px-4 py-3">
              <DeliveryAddressForm
                lang={lang}
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
                lang={lang}
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
          lang={lang}
          form={form}
          dispatch={dispatch}
          timeSlots={timeSlots}
          onDateChange={(date) => {
            // Clear selected slot when date changes (old slot is for a different date)
            dispatch({ type: 'SET_FIELD', field: 'selectedSlotId', value: null });
            fetchTimeSlots(date);
          }}
          onSlotSelect={(slotId) => {
            dispatch({ type: 'SET_FIELD', field: 'selectedSlotId', value: slotId });
          }}
          loading={timeSlotsLoading}
        />
      </div>
    </>
  );
}
