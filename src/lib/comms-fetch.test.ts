import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchCommsMessages } from './comms-fetch';
import type { StorefrontClient } from './sdk-stub';

function makeSdk(overrides: Partial<StorefrontClient> = {}): StorefrontClient {
  return {
    GET: vi.fn().mockResolvedValue({ data: null, error: null }),
    POST: vi.fn().mockResolvedValue({ data: null, error: null }),
    PATCH: vi.fn().mockResolvedValue({ data: null, error: null }),
    DELETE: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
}

describe('fetchCommsMessages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns messages array when API returns array', async () => {
    const messages = [{ id: 1, contents: [{ surface: 'top_banner', headline: 'Hi' }] }];
    const sdk = makeSdk({
      GET: vi.fn().mockResolvedValue({ data: messages }),
    });
    const result = await fetchCommsMessages(sdk);
    expect(result).toEqual(messages);
  });

  it('returns messages from results wrapper', async () => {
    const messages = [{ id: 1, contents: [] }];
    const sdk = makeSdk({
      GET: vi.fn().mockResolvedValue({ data: { results: messages } }),
    });
    const result = await fetchCommsMessages(sdk);
    expect(result).toEqual(messages);
  });

  it('returns empty array on API error', async () => {
    const sdk = makeSdk({
      GET: vi.fn().mockResolvedValue({ data: null, error: { status: 500 } }),
    });
    const result = await fetchCommsMessages(sdk);
    expect(result).toEqual([]);
  });

  it('returns empty array on thrown exception', async () => {
    const sdk = makeSdk({
      GET: vi.fn().mockRejectedValue(new Error('Network error')),
    });
    const result = await fetchCommsMessages(sdk);
    expect(result).toEqual([]);
  });

  it('returns empty array when sdk is null', async () => {
    const result = await fetchCommsMessages(null);
    expect(result).toEqual([]);
  });
});
