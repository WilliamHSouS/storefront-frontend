import { createStorefrontClient, type StorefrontClient } from './sdk-stub';
import { $merchant } from '@/stores/merchant';

/**
 * Client-side SDK singleton for Preact islands.
 *
 * Server-side pages use `Astro.locals.sdk` (created in middleware).
 * Browser-side islands use `getClient()` (lazy singleton, created on first call).
 */
let client: StorefrontClient | null = null;
let clientLang: string | null = null;

export function getClient(): StorefrontClient {
  const currentLang = document.documentElement.lang;
  if (client && currentLang !== clientLang) {
    client = null;
  }
  if (!client) {
    const merchant = $merchant.get();
    if (!merchant) {
      throw new Error('getClient() called before merchant store was initialized');
    }
    client = createStorefrontClient({
      baseUrl: import.meta.env.PUBLIC_API_BASE_URL,
      vendorId: merchant.merchantId,
      language: currentLang,
      merchantSigningKey: merchant.merchantSigningKey || undefined,
    });
    clientLang = currentLang;
  }
  return client;
}

/** Reset the client singleton (useful when language changes). */
export function resetClient(): void {
  client = null;
  clientLang = null;
}
