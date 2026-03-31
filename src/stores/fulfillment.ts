import { atom } from 'nanostores';

export type FulfillmentChoice = 'delivery' | 'pickup' | null;

const STORAGE_KEY = 'sous_fulfillment_choice';

export const $fulfillmentChoice = atom<FulfillmentChoice>(null);
export const $showFulfillmentModal = atom(false);

/** Read stored choice from localStorage. Returns null if not set or expired. */
export function getStoredFulfillmentChoice(): FulfillmentChoice {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { choice: string; storedAt: number };
    // Expire after 7 days
    if (Date.now() - parsed.storedAt > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    if (parsed.choice === 'delivery' || parsed.choice === 'pickup') return parsed.choice;
    return null;
  } catch {
    return null;
  }
}

export function setFulfillmentChoice(choice: FulfillmentChoice): void {
  $fulfillmentChoice.set(choice);
  if (typeof window === 'undefined') return;
  if (choice) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice, storedAt: Date.now() }));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/** Initialize on page load: restore choice or show modal for first-time visitors. */
export function initFulfillment(): void {
  const stored = getStoredFulfillmentChoice();
  if (stored) {
    $fulfillmentChoice.set(stored);
  } else {
    $showFulfillmentModal.set(true);
  }
}
