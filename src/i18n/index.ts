import nl from './messages/nl.json';
import en from './messages/en.json';
import de from './messages/de.json';

type MessageKey = keyof typeof nl;
type Messages = Record<MessageKey, string>;

const messages: Record<string, Messages> = { nl, en, de };

/**
 * Get a translated string for the given key and language.
 *
 * Supports simple interpolation: `t('items_other', 'nl', { count: 3 })` → "3 items"
 *
 * This is a lightweight helper for use in Astro components and Preact islands.
 * When Paraglide.js is fully integrated, this will be replaced by its
 * compiler-generated message functions.
 */
export function t(
  key: MessageKey,
  lang: string,
  params?: Record<string, string | number>,
): string {
  const dict = messages[lang] ?? messages['nl'];
  let text = dict[key] ?? key;

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }

  return text;
}

export function getAvailableLanguages(): string[] {
  return Object.keys(messages);
}

export type { MessageKey };
