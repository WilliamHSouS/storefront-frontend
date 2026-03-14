/** Shared custom event names — prevents typo-based silent breakage between dispatchers and listeners. */
export const EVENTS = {
  OPEN_PRODUCT: 'open-product',
  TOGGLE_CATEGORY_DRAWER: 'toggle-category-drawer',
  ADDRESS_BAR_EXPAND: 'address-bar:expand',
} as const;
