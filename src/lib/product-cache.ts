import { getClient } from '@/lib/api';
import * as log from '@/lib/logger';

interface CachedProduct {
  product: Record<string, unknown>;
  suggestions: Array<unknown>;
  fetchedAt: number;
}

const cache = new Map<string, CachedProduct>();
const inflight = new Map<string, Promise<CachedProduct | null>>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function isExpired(entry: CachedProduct): boolean {
  return Date.now() - entry.fetchedAt > CACHE_TTL_MS;
}

/** Get a cached product if available and not expired. */
export function getCached(productId: string): CachedProduct | null {
  const entry = cache.get(productId);
  if (!entry || isExpired(entry)) return null;
  return entry;
}

/** Fetch product + suggestions, caching the result. Deduplicates in-flight requests. */
export async function fetchProduct(
  productId: string,
  signal?: AbortSignal,
): Promise<CachedProduct | null> {
  const cached = getCached(productId);
  if (cached) return cached;

  // Deduplicate: if already fetching this product, wait for the same promise
  const existing = inflight.get(productId);
  if (existing) return existing;

  const promise = doFetch(productId, signal);
  inflight.set(productId, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(productId);
  }
}

async function doFetch(productId: string, signal?: AbortSignal): Promise<CachedProduct | null> {
  try {
    const client = getClient();
    const [productRes, suggestionsRes] = await Promise.all([
      client.GET(`/api/v1/products/{id}/`, {
        params: { path: { id: productId } },
        signal,
      }),
      client.GET(`/api/v1/products/{id}/suggestions/`, {
        params: { path: { id: productId } },
        signal,
      }),
    ]);
    if (signal?.aborted) return null;
    if (!productRes.data) return null;

    const entry: CachedProduct = {
      product: productRes.data as Record<string, unknown>,
      suggestions: (suggestionsRes.data as Array<unknown>) ?? [],
      fetchedAt: Date.now(),
    };
    cache.set(productId, entry);
    return entry;
  } catch (err) {
    if (signal?.aborted) return null;
    log.error('product-cache', 'prefetch failed (non-blocking):', err);
    return null;
  }
}

// ── Prefetch with concurrency control ─────────────────────────────
const MAX_CONCURRENT_PREFETCH = 2;
let activePrefetches = 0;
const prefetchQueue: string[] = [];

function drainQueue(): void {
  while (prefetchQueue.length > 0 && activePrefetches < MAX_CONCURRENT_PREFETCH) {
    const id = prefetchQueue.shift()!;
    if (getCached(id) || inflight.has(id)) continue;
    activePrefetches++;
    fetchProduct(id)
      .catch(() => {
        // Prefetch is best-effort
      })
      .finally(() => {
        activePrefetches--;
        drainQueue();
      });
  }
}

/**
 * Prefetch a product. Fire-and-forget — errors are silently ignored.
 * Limits concurrent prefetches to avoid flooding the API when many cards
 * enter the viewport at once.
 */
export function prefetch(productId: string): void {
  if (getCached(productId) || inflight.has(productId)) return;
  if (prefetchQueue.includes(productId)) return;
  prefetchQueue.push(productId);
  drainQueue();
}
