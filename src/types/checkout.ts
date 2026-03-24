// src/types/checkout.ts

export type FulfillmentType = 'local_delivery' | 'pickup' | 'nationwide_delivery';

export type CheckoutStatus = 'created' | 'delivery_set' | 'shipping_pending' | 'paid' | 'completed';

export interface CheckoutAddress {
  first_name: string;
  last_name: string;
  street_address_1: string;
  street_address_2?: string;
  city: string;
  postal_code: string;
  country_code: string;
  phone_number?: string;
}

export interface CheckoutLineItem {
  product_id: number | string;
  variant_id: string;
  product_title: string;
  title: string;
  quantity: number;
  unit_price: string;
  total_price: string;
  line_total: string;
  tax_rate: string;
  tax_amount: string;
  fulfillment_type: FulfillmentType | string;
  fulfillment_date: string | null;
  options: Array<{ name: string; value: string; surcharges?: unknown[] }>;
  product_type: string;
  surcharges: unknown[];
  gift_card_details?: unknown;
}

export interface Checkout {
  id: string;
  cart_id: string;
  merchant_id: number;
  channel_id: number | null;
  status: CheckoutStatus;
  currency: string;
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
  purpose: string;
  created_at: string | null;
  updated_at: string | null;
  available_payment_gateways: PaymentGatewayConfig[] | null;
}

export interface PaymentGatewayConfig {
  id: string;
  name: string;
  type: string;
  config: Record<string, string>;
}

export interface PaymentResult extends Checkout {
  client_secret?: string;
  redirect_url?: string;
  payment_intent_id?: string;
}

export interface ShippingRate {
  id: string;
  name: string;
  cost: string;
  original_cost: string;
  rate_id: string;
  expires_at: string | null;
}

export interface ShippingGroup {
  id: string;
  merchant_shipping_provider_id: number;
  shipping_cost: string;
  selected_rate_id: string | null;
  is_digital: boolean;
  available_rates: ShippingRate[];
  line_items: Array<{ product_id: number | string; title: string; quantity: number }>;
}

export interface TimeSlot {
  id: string;
  start_time: string;
  end_time: string;
  capacity: number;
  reserved_count: number;
  available: boolean;
  remaining_capacity: number;
}

export interface TimeSlotsResponse {
  location_id: number;
  date: string;
  time_slots: TimeSlot[];
}

export interface CheckoutFormState {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  street: string;
  city: string;
  postalCode: string;
  countryCode: string;
  fulfillmentMethod: 'delivery' | 'pickup';
  pickupLocationId: number | null;
  schedulingMode: 'asap' | 'scheduled';
  scheduledDate: string | null;
  selectedSlotId: string | null;
  selectedShippingRateId: string | null;
}
