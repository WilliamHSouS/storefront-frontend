import { atom } from 'nanostores';
import type { AddressCoords, AddressEligibility, StoredAddress } from '@/types/address';

// ── Atoms ──────────────────────────────────────────────────────

export const $addressCoords = atom<AddressCoords | null>(null);
export const $addressEligibility = atom<AddressEligibility | null>(null);

// ── localStorage persistence ───────────────────────────────────

const STORAGE_KEY = 'sous_address';
export const ADDRESS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function isAddressExpired(storedAt: number): boolean {
  return Date.now() - storedAt > ADDRESS_TTL_MS;
}

export function getStoredAddress(): StoredAddress | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored: StoredAddress = JSON.parse(raw);
    if (
      typeof stored.postalCode !== 'string' ||
      stored.postalCode === '' ||
      typeof stored.country !== 'string' ||
      stored.country === '' ||
      typeof stored.latitude !== 'number' ||
      typeof stored.longitude !== 'number' ||
      typeof stored.storedAt !== 'number'
    )
      return null;
    if (isAddressExpired(stored.storedAt)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

export function setStoredAddress(coords: AddressCoords): void {
  if (typeof window === 'undefined') return;
  const stored: StoredAddress = { ...coords, storedAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}

export function clearStoredAddress(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
