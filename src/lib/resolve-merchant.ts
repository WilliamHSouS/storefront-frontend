import * as log from '@/lib/logger';

const PLATFORM_SUFFIXES = ['.poweredbysous.com', '.poweredbysous.localhost'];

/**
 * Resolves merchant slug from hostname.
 *
 * Handles:
 *  - Production:       bar-sumac.poweredbysous.com        → "bar-sumac"
 *  - Local dev:        bar-sumac.poweredbysous.localhost:4321 → "bar-sumac"
 *  - Vercel preview:   bar-sumac--branch.vercel.app       → "bar-sumac"
 *  - Custom domain:    barsumac.nl                        → looked up via customDomainsJson
 *  - Fallback:         uses defaultMerchant               → for plain localhost / CI / Vercel
 *
 * Pure function — all env values passed as parameters for testability.
 */
export function resolveMerchantSlug(
  hostname: string,
  customDomainsJson?: string,
  defaultMerchant?: string,
): string {
  const host = hostname.split(':')[0];

  // Custom domain mapping
  let customDomains: Record<string, string> = {};
  try {
    customDomains = JSON.parse(customDomainsJson || '{}');
  } catch (error) {
    log.warn('merchant', 'Failed to resolve merchant:', error);
  }
  if (customDomains[host]) return customDomains[host];

  // Known platform domains: extract first segment before known suffixes
  for (const suffix of PLATFORM_SUFFIXES) {
    if (host.endsWith(suffix)) {
      const prefix = host.slice(0, -suffix.length);
      // Vercel preview branches: "bar-sumac--branch-name" → "bar-sumac"
      return prefix.split('--')[0];
    }
  }

  // Bare localhost / unknown host: fall back to default
  return defaultMerchant || 'demo-restaurant';
}
