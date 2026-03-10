import { describe, it, expect, beforeEach } from 'vitest';
import {
  $addressCoords,
  $addressEligibility,
  getStoredAddress,
  setStoredAddress,
  clearStoredAddress,
  isAddressExpired,
  ADDRESS_TTL_MS,
} from './address';

describe('address stores', () => {
  beforeEach(() => {
    $addressCoords.set(null);
    $addressEligibility.set(null);
    localStorage.clear();
  });

  it('initializes with null state', () => {
    expect($addressCoords.get()).toBeNull();
    expect($addressEligibility.get()).toBeNull();
  });
});

describe('address persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves address from localStorage', () => {
    const coords = {
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
    };
    setStoredAddress(coords);

    const stored = getStoredAddress();
    expect(stored).not.toBeNull();
    expect(stored!.postalCode).toBe('1015 BS');
    expect(stored!.latitude).toBe(52.3702);
  });

  it('clears stored address', () => {
    setStoredAddress({
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
    });
    clearStoredAddress();
    expect(getStoredAddress()).toBeNull();
  });

  it('detects expired addresses (>7 days)', () => {
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    expect(isAddressExpired(eightDaysAgo)).toBe(true);
  });

  it('accepts fresh addresses (<7 days)', () => {
    const oneDayAgo = Date.now() - 1 * 24 * 60 * 60 * 1000;
    expect(isAddressExpired(oneDayAgo)).toBe(false);
  });

  it('returns null for expired stored address', () => {
    const expired = {
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
      storedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    };
    localStorage.setItem('sous_address', JSON.stringify(expired));
    expect(getStoredAddress()).toBeNull();
  });

  it('exports ADDRESS_TTL_MS as 7 days in milliseconds', () => {
    expect(ADDRESS_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
