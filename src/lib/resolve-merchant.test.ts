import { describe, it, expect, vi } from 'vitest';
import { resolveMerchantSlug } from './resolve-merchant';

describe('resolveMerchantSlug', () => {
  it('extracts slug from production domain', () => {
    expect(resolveMerchantSlug('bar-sumac.poweredbysous.com')).toBe('bar-sumac');
  });

  it('extracts slug from localhost with port', () => {
    expect(resolveMerchantSlug('bar-sumac.poweredbysous.localhost:4321')).toBe('bar-sumac');
  });

  it('extracts slug from Vercel preview, stripping branch', () => {
    expect(resolveMerchantSlug('bar-sumac--feat-xyz.vercel.app')).toBe('bar-sumac');
  });

  it('looks up custom domain from env map', () => {
    const customDomains = '{"barsumac.nl":"bar-sumac"}';
    expect(resolveMerchantSlug('barsumac.nl', customDomains)).toBe('bar-sumac');
  });

  it('handles malformed CUSTOM_DOMAINS JSON gracefully', () => {
    expect(resolveMerchantSlug('barsumac.nl', 'not-json')).toBe('bar-sumac');
  });

  it('logs a warning when CUSTOM_DOMAINS JSON is malformed', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveMerchantSlug('barsumac.nl', 'not-json');
    expect(warnSpy).toHaveBeenCalledWith('Failed to resolve merchant:', expect.any(SyntaxError));
    warnSpy.mockRestore();
  });

  it('falls back to DEFAULT_MERCHANT for bare localhost', () => {
    expect(resolveMerchantSlug('localhost:4321', '{}', 'test-merchant')).toBe('test-merchant');
  });

  it('falls back to bar-sumac when no DEFAULT_MERCHANT', () => {
    expect(resolveMerchantSlug('localhost:4321')).toBe('bar-sumac');
  });
});
