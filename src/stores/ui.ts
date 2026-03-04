import { atom } from 'nanostores';

/** Minimal product reference used to open the product detail modal. */
export interface SelectedProduct {
  id: string | number;
  name: string;
}

export const $activeCategory = atom<string>('');
export const $isCartOpen = atom(false);
export const $isCategoryDrawerOpen = atom(false);
export const $selectedProduct = atom<SelectedProduct | null>(null);
