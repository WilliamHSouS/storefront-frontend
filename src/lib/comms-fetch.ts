import type { StorefrontClient } from './sdk-stub';
import type { CommsMessage } from '@/stores/comms';

/**
 * Fetch active merchant comms messages from the API.
 * Returns empty array on any failure — comms are non-critical.
 */
export async function fetchCommsMessages(
  sdk: StorefrontClient | null | undefined,
): Promise<CommsMessage[]> {
  if (!sdk) return [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- merchant-comms endpoint not in SDK types
    const { data } = await sdk.GET('/api/v1/merchant-comms/storefront/active/' as any);
    // eslint-enable @typescript-eslint/no-explicit-any -- end merchant-comms SDK workaround
    if (!data) return [];
    if (Array.isArray(data)) return data as unknown as CommsMessage[];
    const wrapped = data as unknown as Record<string, unknown>;
    return (wrapped.results as CommsMessage[]) ?? [];
  } catch {
    return [];
  }
}
