/**
 * Client-side i18n — reads from window.__MESSAGES__ (injected by BaseLayout).
 *
 * This module does NOT import the JSON translation files. Instead, the server
 * injects the active language's messages into the page via a script tag.
 * This saves ~4.5 kB gzipped by avoiding bundling all 3 language files.
 *
 * For server-side usage (Astro components), use '@/i18n' which has all languages.
 */

// Type-only import — erased at compile time, does NOT pull in the JSON files
import type { MessageKey } from './index';

type Messages = Record<string, string>;

/**
 * SSR message store — populated by `setSSRMessages()` during Astro island
 * server-rendering so that `t()` returns real translations (not raw keys)
 * in the SSR HTML. Prevents hydration mismatches where Preact skips
 * attribute updates (e.g. aria-label) when diffing SSR output vs client.
 */
let ssrMessages: Messages | null = null;

/**
 * Inject messages for server-side rendering of Preact islands.
 * Called from BaseLayout's frontmatter so SSR output contains
 * translated strings instead of raw message keys.
 */
export function setSSRMessages(messages: Messages): void {
  ssrMessages = messages;
}

function getDict(): Messages {
  if (typeof window !== 'undefined' && window.__MESSAGES__) {
    return window.__MESSAGES__;
  }
  // During SSR (no window), use the messages injected by BaseLayout
  if (ssrMessages) {
    return ssrMessages;
  }
  return {};
}

/**
 * Get a translated string — client-side version.
 * Reads from window.__MESSAGES__ injected by BaseLayout.
 * Falls back to returning the key itself if the message is missing.
 */
export function t(
  key: MessageKey,
  _lang: string,
  params?: Record<string, string | number>,
): string {
  const dict = getDict();
  let text = dict[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }

  return text;
}

export type { MessageKey };
