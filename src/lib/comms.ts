import { $dismissedMessages } from '@/stores/comms';
import * as log from '@/lib/logger';

// ---------------------------------------------------------------------------
// Duration parser
// ---------------------------------------------------------------------------

const DURATION_RE = /^(\d+):(\d{2}):(\d{2})$/;

/**
 * Parse a Python timedelta string in "H:MM:SS" or "HH:MM:SS" format and
 * return the equivalent number of milliseconds.  Returns `Infinity` for
 * unrecognised formats so callers can treat the dismiss as permanent.
 */
export function parseDurationMs(duration: string): number {
  const m = DURATION_RE.exec(duration);
  if (!m) return Infinity;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

// ---------------------------------------------------------------------------
// Dismiss persistence
// ---------------------------------------------------------------------------

export const DISMISSED_STORAGE_KEY = 'sous:comms:dismissed';

/**
 * Read dismissed-message state from localStorage, prune expired entries,
 * save the pruned version back, and return it.
 *
 * Handles corrupt data gracefully — returns `{}` on any error.
 */
export function loadDismissedState(): Record<string, number> {
  if (typeof window === 'undefined') return {};

  try {
    const raw = localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return {};

    const parsed: Record<string, number | null> = JSON.parse(raw);
    const now = Date.now();
    const pruned: Record<string, number> = {};
    let changed = false;

    for (const [id, expiry] of Object.entries(parsed)) {
      // null in JSON represents Infinity (permanent dismiss)
      const expiryMs = expiry === null ? Infinity : expiry;
      if (expiryMs > now) {
        pruned[id] = expiryMs;
      } else {
        changed = true;
      }
    }

    if (changed) {
      _saveDismissedState(pruned);
    }

    return pruned;
  } catch (e) {
    log.warn('comms', 'Failed to read dismissed state from localStorage:', e);
    return {};
  }
}

/**
 * Dismiss a message.  A `null` duration means "dismiss permanently".
 * Updates both the nanostore and localStorage.
 */
export function dismissMessage(messageId: string, dismissDuration: string | null): void {
  const expiry =
    dismissDuration === null ? Infinity : Date.now() + parseDurationMs(dismissDuration);

  const current = $dismissedMessages.get();
  const next = { ...current, [messageId]: expiry };
  $dismissedMessages.set(next);

  _saveDismissedState(next);
}

/**
 * Check whether a message is currently dismissed (i.e. its expiry is in the
 * future or is `Infinity`).
 */
export function isDismissed(messageId: string): boolean {
  const expiry = $dismissedMessages.get()[messageId];
  if (expiry === undefined) return false;
  return expiry > Date.now();
}

// Internal: persist state to localStorage.
// Infinity is serialised as `null` because JSON has no Infinity literal.
function _saveDismissedState(state: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    const serialisable: Record<string, number | null> = {};
    for (const [id, expiry] of Object.entries(state)) {
      serialisable[id] = expiry === Infinity ? null : expiry;
    }
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(serialisable));
  } catch (e) {
    log.warn('comms', 'Failed to save dismissed state to localStorage:', e);
  }
}

// ---------------------------------------------------------------------------
// Analytics batching
// ---------------------------------------------------------------------------

export interface CommsEvent {
  message_id: string;
  content_id: string;
  event_type: 'impression' | 'click' | 'dismiss';
  subject_key: string;
  metadata: Record<string, unknown>;
}

const FLUSH_INTERVAL_MS = 5_000;
const MAX_BATCH_SIZE = 50;

/**
 * Create a fire-and-forget event batcher that POSTs queued comms events to
 * the backend every 5 seconds.
 */
export function createCommsBatcher(
  apiBaseUrl: string,
  vendorId: string,
): {
  track: (event: CommsEvent) => void;
  flush: () => void;
  destroy: () => void;
} {
  const queue: CommsEvent[] = [];

  function flush(): void {
    if (queue.length === 0) return;
    const batch = queue.splice(0, MAX_BATCH_SIZE);
    const url = `${apiBaseUrl}/api/v1/merchant-comms/storefront/events/`;
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Vendor-ID': vendorId },
        body: JSON.stringify({ events: batch }),
      }).catch(() => {
        /* fire-and-forget */
      });
    } catch {
      /* fire-and-forget */
    }
  }

  const intervalId = setInterval(flush, FLUSH_INTERVAL_MS);

  function destroy(): void {
    flush();
    clearInterval(intervalId);
  }

  return {
    track: (event: CommsEvent) => queue.push(event),
    flush,
    destroy,
  };
}
