/**
 * Analytics event names and property types.
 *
 * Each event has a typed property bag. Core properties (merchant_id,
 * session context, UTM params) are automatically merged by `capture()`.
 */

export const EVENTS = {
  // Catalog
  MENU_VIEWED: 'menu_viewed',
  CATEGORY_VIEWED: 'category_viewed',
  PRODUCT_VIEWED: 'product_viewed',
  PRODUCT_SEARCHED: 'product_searched',

  // Cart
  ITEM_ADDED: 'item_added',
  ITEM_REMOVED: 'item_removed',
  ITEM_QUANTITY_CHANGED: 'item_quantity_changed',
  MODIFIER_SELECTED: 'modifier_selected',
  CART_VIEWED: 'cart_viewed',

  // Checkout
  CHECKOUT_STARTED: 'checkout_started',
  FULFILMENT_SELECTED: 'fulfilment_selected',
  ADDRESS_ENTERED: 'address_entered',
  TIME_SLOT_SELECTED: 'time_slot_selected',
  PAYMENT_METHOD_SELECTED: 'payment_method_selected',
  ORDER_PLACED: 'order_placed',
  PAYMENT_FAILED: 'payment_failed',

  // Auth
  LOGIN_STARTED: 'login_started',
  OTP_REQUESTED: 'otp_requested',
  OTP_VERIFIED: 'otp_verified',
  LOGIN_COMPLETED: 'login_completed',
  LOGOUT: 'logout',

  // Navigation
  LANGUAGE_SWITCHED: 'language_switched',
  PAGE_VIEWED: 'page_viewed',
  CMS_PAGE_VIEWED: 'cms_page_viewed',

  // Orders
  ORDER_HISTORY_VIEWED: 'order_history_viewed',
  REORDER_CLICKED: 'reorder_clicked',

  // Group Orders
  GROUP_ORDER_CREATED: 'group_order_created',
  GROUP_ORDER_JOINED: 'group_order_joined',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Core properties merged into every event automatically. */
export interface CoreProperties {
  merchant_id: string;
  merchant_slug: string;
  language: string;
  session_id: string;
  environment: string;
}

/** Cart snapshot attached to cart/checkout events. */
export interface CartSnapshot {
  cart_item_count: number;
  cart_total: string;
  currency: string;
}

/** Fulfilment snapshot attached to checkout events. */
export interface FulfilmentSnapshot {
  fulfilment_mode?: 'delivery' | 'pickup';
  postal_code?: string; // Truncated to prefix by PII guard
}

/** UTM parameters tracked from landing page. */
export interface UTMProperties {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

/** Event-specific properties (loose — each capture call sends its own bag). */
export type EventProperties = Record<string, string | number | boolean | null | undefined>;
