import { describe, it, expect } from 'vitest';
import { resolveMerchantSlug } from './resolve-merchant';
import { loadMerchantConfig } from '@/merchants';

/**
 * Integration tests: verify resolveMerchantSlug + loadMerchantConfig
 * work together end-to-end for the full subdomain → config pipeline.
 */
describe('merchant resolution pipeline', () => {
  it('resolves a known merchant from production subdomain', () => {
    const slug = resolveMerchantSlug('bar-sumac.ordersous.com', '{}', undefined, '.ordersous.com');
    const config = loadMerchantConfig(slug);
    expect(config).not.toBeNull();
    expect(config!.slug).toBe('bar-sumac');
    expect(config!.languages).toContain(config!.defaultLanguage);
  });

  it('returns null config for unknown merchant', () => {
    const slug = resolveMerchantSlug(
      'nonexistent.ordersous.com',
      '{}',
      undefined,
      '.ordersous.com',
    );
    const config = loadMerchantConfig(slug);
    expect(config).toBeNull();
  });

  it('resolves merchant from localhost with port', () => {
    const slug = resolveMerchantSlug('bar-sumac.poweredbysous.localhost:4321');
    const config = loadMerchantConfig(slug);
    expect(config).not.toBeNull();
    expect(config!.slug).toBe('bar-sumac');
  });

  it('falls back to default merchant for bare localhost', () => {
    const slug = resolveMerchantSlug('localhost:4321', '{}', 'bar-sumac');
    const config = loadMerchantConfig(slug);
    expect(config).not.toBeNull();
  });

  it('resolves custom domain to merchant config', () => {
    const customDomains = '{"barsumac.nl":"bar-sumac"}';
    const slug = resolveMerchantSlug('barsumac.nl', customDomains);
    const config = loadMerchantConfig(slug);
    expect(config).not.toBeNull();
    expect(config!.slug).toBe('bar-sumac');
  });

  it('merchant config has all required fields', () => {
    const config = loadMerchantConfig('bar-sumac');
    expect(config).not.toBeNull();
    expect(config!.merchantId).toBeTruthy();
    expect(config!.name).toBeTruthy();
    expect(config!.currency).toBeTruthy();
    expect(config!.theme).toBeTruthy();
    expect(config!.languages.length).toBeGreaterThan(0);
    expect(config!.contact).toBeTruthy();
  });
});
