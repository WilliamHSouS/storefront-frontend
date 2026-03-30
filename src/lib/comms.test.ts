import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { $dismissedMessages } from '@/stores/comms';

// Mock getClient — must be before comms import
const mockPost = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock('@/lib/api', () => ({
  getClient: () => ({ POST: mockPost }),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Must import after localStorage mock is set up
import {
  parseDurationMs,
  DISMISSED_STORAGE_KEY,
  loadDismissedState,
  dismissMessage,
  isDismissed,
  createCommsBatcher,
  type CommsEvent,
} from './comms';

describe('parseDurationMs', () => {
  it('parses "1:00:00" → 3600000', () => {
    expect(parseDurationMs('1:00:00')).toBe(3_600_000);
  });

  it('parses "0:30:00" → 1800000', () => {
    expect(parseDurationMs('0:30:00')).toBe(1_800_000);
  });

  it('parses "01:30:00" → 5400000', () => {
    expect(parseDurationMs('01:30:00')).toBe(5_400_000);
  });

  it('returns Infinity for invalid string', () => {
    expect(parseDurationMs('not-a-duration')).toBe(Infinity);
    expect(parseDurationMs('')).toBe(Infinity);
    expect(parseDurationMs('1:2:3')).toBe(Infinity); // minutes/seconds must be 2 digits
  });
});

describe('dismiss logic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    $dismissedMessages.set({});
    localStorageMock.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('dismissMessage stores permanent dismiss (null duration)', () => {
    dismissMessage('msg-1', null);
    const state = $dismissedMessages.get();
    expect(state['msg-1']).toBe(Infinity);
  });

  it('dismissMessage stores timed dismiss that expires', () => {
    const now = Date.now();
    dismissMessage('msg-2', '1:00:00');
    const state = $dismissedMessages.get();
    expect(state['msg-2']).toBe(now + 3_600_000);

    // Not expired yet
    expect(isDismissed('msg-2')).toBe(true);

    // Advance past expiry
    vi.advanceTimersByTime(3_600_001);
    expect(isDismissed('msg-2')).toBe(false);
  });

  it('persists to localStorage', () => {
    dismissMessage('msg-3', null);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      DISMISSED_STORAGE_KEY,
      expect.any(String),
    );
    const calls = localStorageMock.setItem.mock.calls;
    const stored = JSON.parse(calls[calls.length - 1][1] as string);
    expect(stored['msg-3']).toBe(null); // Infinity serialised as null
  });

  it('loadDismissedState reads from localStorage', () => {
    const now = Date.now();
    const future = now + 60_000;
    localStorageMock.getItem.mockReturnValueOnce(
      JSON.stringify({ 'msg-a': future, 'msg-b': null }),
    );
    const state = loadDismissedState();
    expect(state['msg-a']).toBe(future);
    expect(state['msg-b']).toBe(Infinity); // null → Infinity
  });

  it('loadDismissedState prunes expired entries', () => {
    const now = Date.now();
    const past = now - 1000;
    const future = now + 60_000;
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({ expired: past, valid: future }));
    const state = loadDismissedState();
    expect(state).not.toHaveProperty('expired');
    expect(state['valid']).toBe(future);
    // Should save pruned version back
    expect(localStorageMock.setItem).toHaveBeenCalled();
  });

  it('loadDismissedState handles corrupt localStorage', () => {
    localStorageMock.getItem.mockReturnValueOnce('not-valid-json{{{');
    const state = loadDismissedState();
    expect(state).toEqual({});
  });
});

describe('isDismissed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    $dismissedMessages.set({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false for unknown message', () => {
    expect(isDismissed('unknown')).toBe(false);
  });

  it('returns true for permanently dismissed message', () => {
    $dismissedMessages.set({ 'msg-perm': Infinity });
    expect(isDismissed('msg-perm')).toBe(true);
  });
});

describe('createCommsBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPost.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeEvent(id: string): CommsEvent {
    return {
      message_id: id,
      content_id: `content-${id}`,
      event_type: 'impression',
      subject_key: 'top_banner',
      metadata: {},
    };
  }

  it('queues events and flushes after 5s', () => {
    const batcher = createCommsBatcher('https://api.test', 'vendor-1');
    batcher.track(makeEvent('1'));
    batcher.track(makeEvent('2'));

    expect(mockPost).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);

    expect(mockPost).toHaveBeenCalledTimes(1);
    batcher.destroy();
  });

  it('sends batched events via SDK client', () => {
    const batcher = createCommsBatcher('https://api.test', 'vendor-1');
    batcher.track(makeEvent('1'));
    batcher.track(makeEvent('2'));

    vi.advanceTimersByTime(5000);

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/merchant-comms/storefront/events/',
      expect.objectContaining({
        body: { events: [makeEvent('1'), makeEvent('2')] },
      }),
    );
    batcher.destroy();
  });

  it('does not flush when queue empty', () => {
    const batcher = createCommsBatcher('https://api.test', 'vendor-1');

    vi.advanceTimersByTime(5000);

    expect(mockPost).not.toHaveBeenCalled();
    batcher.destroy();
  });

  it('caps batch at 50 events (remainder sent next flush)', () => {
    const batcher = createCommsBatcher('https://api.test', 'vendor-1');

    for (let i = 0; i < 60; i++) {
      batcher.track(makeEvent(String(i)));
    }

    vi.advanceTimersByTime(5000);

    expect(mockPost).toHaveBeenCalledTimes(1);
    const firstCall = mockPost.mock.calls[0];
    expect(firstCall[1].body.events).toHaveLength(50);

    // Next flush sends remaining 10
    vi.advanceTimersByTime(5000);
    expect(mockPost).toHaveBeenCalledTimes(2);
    const secondCall = mockPost.mock.calls[1];
    expect(secondCall[1].body.events).toHaveLength(10);

    batcher.destroy();
  });

  it('destroy flushes remaining and clears interval', () => {
    const batcher = createCommsBatcher('https://api.test', 'vendor-1');
    batcher.track(makeEvent('final'));

    batcher.destroy();

    expect(mockPost).toHaveBeenCalledTimes(1);

    // No more flushes after destroy
    vi.advanceTimersByTime(10_000);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
