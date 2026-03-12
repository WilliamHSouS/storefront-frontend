import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/preact';
import { AddressBar } from './AddressBar';
import { $addressCoords } from '@/stores/address';

// Mock address actions
vi.mock('@/stores/address-actions', () => ({
  onAddressChange: vi.fn().mockResolvedValue({ success: true }),
  clearAddress: vi.fn(),
  hydrateAddressFromStorage: vi.fn().mockResolvedValue(undefined),
}));

describe('AddressBar', () => {
  beforeEach(() => {
    cleanup();
    $addressCoords.set(null);
  });

  it('renders compact state with placeholder when no address', () => {
    const { getByRole } = render(<AddressBar lang="en" />);
    const button = getByRole('button', { name: /enter postcode/i });
    expect(button).toBeTruthy();
  });

  it('expands to input mode on click', async () => {
    const { getByRole, getByLabelText } = render(<AddressBar lang="en" />);
    const button = getByRole('button', { name: /enter postcode/i });
    fireEvent.click(button);
    expect(getByLabelText(/postcode/i)).toBeTruthy();
  });

  it('shows postcode in compact state when address is set', () => {
    $addressCoords.set({
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
    });
    const { getByText } = render(<AddressBar lang="en" />);
    expect(getByText('1015 BS')).toBeTruthy();
  });

  it('has clear button when address is set', () => {
    $addressCoords.set({
      postalCode: '1015 BS',
      country: 'NL',
      latitude: 52.3702,
      longitude: 4.8952,
    });
    const { getByRole } = render(<AddressBar lang="en" />);
    expect(getByRole('button', { name: /clear/i })).toBeTruthy();
  });

  it('expands on address-bar:expand custom event', () => {
    const { getByLabelText } = render(<AddressBar lang="en" />);
    document.dispatchEvent(new CustomEvent('address-bar:expand'));
    expect(getByLabelText(/postcode/i)).toBeTruthy();
  });
});
