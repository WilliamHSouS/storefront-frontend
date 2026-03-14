import { atom } from 'nanostores';

/** Minimal product reference used to open the product detail modal. */
export interface SelectedProduct {
  id: string | number;
  name: string;
  /** URL slug for shallow routing (e.g. "falafel-wrap--prod-1"). */
  slug?: string;
  /** When true, skip the detail view and show the upsell step directly. */
  skipToUpsell?: boolean;
}

export const $activeCategory = atom<string>('');
export const $isCartOpen = atom(false);
export const $isCategoryDrawerOpen = atom(false);
export const $selectedProduct = atom<SelectedProduct | null>(null);
