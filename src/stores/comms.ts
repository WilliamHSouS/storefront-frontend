import { atom, computed } from 'nanostores';

export type CommsTheme = 'info' | 'success' | 'warning' | 'urgent' | 'promotional';

export interface CommsContent {
  id: string;
  surface: string;
  headline: string;
  body: string;
  cta_label: string;
  cta_url: string;
  theme: CommsTheme;
  custom_colors: Record<string, string>;
  extra: Record<string, unknown>;
}

export interface CommsMessage {
  id: string;
  priority: number;
  dismissible: boolean;
  dismiss_duration: string | null;
  contents: CommsContent[];
}

export interface SurfaceEntry {
  message: CommsMessage;
  content: CommsContent;
}

/** All comms messages from the API, set from SSR data. */
export const $commsMessages = atom<CommsMessage[]>([]);

/** Dismissed message IDs mapped to expiry timestamps. */
export const $dismissedMessages = atom<Record<string, number>>({});

function surfaceStore(surface: string) {
  return computed([$commsMessages, $dismissedMessages], (messages, dismissed) => {
    const now = Date.now();
    const entries: SurfaceEntry[] = [];

    for (const message of messages) {
      // Skip dismissed messages whose expiry hasn't passed
      const expiry = dismissed[message.id];
      if (expiry !== undefined && expiry > now) continue;

      for (const content of message.contents) {
        if (content.surface === surface) {
          entries.push({ message, content });
        }
      }
    }

    // Sort by priority ascending (lower number = higher priority)
    entries.sort((a, b) => a.message.priority - b.message.priority);
    return entries;
  });
}

export const $topBannerMessages = surfaceStore('top_banner');
export const $bottomBannerMessages = surfaceStore('bottom_banner');
export const $modalMessages = surfaceStore('modal');
export const $toastMessages = surfaceStore('toast');
export const $inlineCartMessages = surfaceStore('inline_cart');
export const $inlineCheckoutMessages = surfaceStore('inline_checkout');
