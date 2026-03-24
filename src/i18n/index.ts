import nl from './messages/nl.json';
import en from './messages/en.json';
import de from './messages/de.json';

type MessageKey = keyof typeof nl;
type Messages = Record<MessageKey, string>;

/**
 * All messages (all languages) — used server-side (Astro components).
 * Client-side islands import from '@/i18n/client' instead, which reads
 * from window.__MESSAGES__ (injected by BaseLayout) to avoid bundling
 * all 3 language files.
 */
const allMessages: Record<string, Messages> = { nl, en, de };

/**
 * Get a translated string for the given key and language.
 *
 * Supports simple interpolation: `t('items_other', 'nl', { count: 3 })` → "3 items"
 *
 * This is the server-side version used by Astro components.
 * For Preact islands (client-side), use '@/i18n/client' instead.
 */
export function t(key: MessageKey, lang: string, params?: Record<string, string | number>): string {
  const dict = allMessages[lang] ?? allMessages['nl'];
  let text = dict[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }

  return text;
}

/**
 * Get all messages for a language — used by BaseLayout to inject into the page.
 */
export function getMessages(lang: string): Messages {
  return allMessages[lang] ?? allMessages['nl'];
}

export function getAvailableLanguages(): string[] {
  return Object.keys(allMessages);
}

export type { MessageKey, Messages };
