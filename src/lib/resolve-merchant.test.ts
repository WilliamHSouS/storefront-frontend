import { describe, it, expect, vi } from 'vitest';
import { resolveMerchantSlug } from './resolve-merchant';

describe('resolveMerchantSlug', () => {
  it('extracts slug from platform domain via PLATFORM_SUFFIXES', () => {
    expect(resolveMerchantSlug('bar-sumac.ordersous.com', '{}', undefined, '.ordersous.com')).toBe(
      'bar-sumac',
    );
  });

  it('supports multiple comma-separated suffixes', () => {
    const suffixes = '.ordersous.com, .poweredbysous.localhost';
    expect(resolveMerchantSlug('bar-sumac.ordersous.com', '{}', undefined, suffixes)).toBe(
      'bar-sumac',
    );
    expect(
      resolveMerchantSlug('bar-sumac.poweredbysous.localhost:4321', '{}', undefined, suffixes),
    ).toBe('bar-sumac');
  });

  it('auto-prepends dot if suffix is missing it', () => {
    expect(resolveMerchantSlug('bar-sumac.ordersous.com', '{}', undefined, 'ordersous.com')).toBe(
      'bar-sumac',
    );
  });

  it('falls back to .poweredbysous.localhost when no PLATFORM_SUFFIXES', () => {
    expect(resolveMerchantSlug('bar-sumac.poweredbysous.localhost:4321')).toBe('bar-sumac');
  });

  it('falls back to .poweredbysous.localhost for empty string', () => {
    expect(resolveMerchantSlug('bar-sumac.poweredbysous.localhost:4321', '{}', undefined, '')).toBe(
      'bar-sumac',
    );
  });

  it('falls back to DEFAULT_MERCHANT for Vercel hostnames', () => {
    expect(resolveMerchantSlug('storefront-frontend-sous.vercel.app', '{}', 'bar-sumac')).toBe(
      'bar-sumac',
    );
  });

  it('resolves Vercel hostname via CUSTOM_DOMAINS', () => {
    const customDomains = '{"bar-sumac--feat-xyz.vercel.app":"bar-sumac"}';
    expect(resolveMerchantSlug('bar-sumac--feat-xyz.vercel.app', customDomains)).toBe('bar-sumac');
  });

  it('looks up custom domain from env map', () => {
    const customDomains = '{"barsumac.nl":"bar-sumac"}';
    expect(resolveMerchantSlug('barsumac.nl', customDomains)).toBe('bar-sumac');
  });

  it('handles malformed CUSTOM_DOMAINS JSON gracefully', () => {
    expect(resolveMerchantSlug('barsumac.nl', 'not-json')).toBe('demo-restaurant');
  });

  it('logs a warning when CUSTOM_DOMAINS JSON is malformed', () => {
    (globalThis as Record<string, unknown>).__TESTING__ = false;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveMerchantSlug('barsumac.nl', 'not-json');
    expect(warnSpy).toHaveBeenCalledWith(
      '[merchant]',
      'Failed to resolve merchant:',
      expect.any(SyntaxError),
    );
    warnSpy.mockRestore();
    (globalThis as Record<string, unknown>).__TESTING__ = true;
  });

  it('strips Vercel preview branch suffix from slug', () => {
    expect(
      resolveMerchantSlug('bar-sumac--feat-xyz.ordersous.com', '{}', undefined, '.ordersous.com'),
    ).toBe('bar-sumac');
  });

  it('falls back to default when hostname equals the suffix (no subdomain)', () => {
    expect(resolveMerchantSlug('.ordersous.com', '{}', 'fallback', '.ordersous.com')).toBe(
      'fallback',
    );
  });

  it('falls back to DEFAULT_MERCHANT for bare localhost', () => {
    expect(resolveMerchantSlug('localhost:4321', '{}', 'test-merchant')).toBe('test-merchant');
  });

  it('falls back to demo-restaurant when no DEFAULT_MERCHANT', () => {
    expect(resolveMerchantSlug('localhost:4321')).toBe('demo-restaurant');
  });
});
