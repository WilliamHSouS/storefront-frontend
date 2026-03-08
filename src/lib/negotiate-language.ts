/**
 * Picks the best language from an Accept-Language header value.
 *
 * Parses the header, extracts 2-letter language codes, and returns the
 * first one supported by the merchant. Falls back to `defaultLanguage`
 * when no match is found or the header is empty.
 */
export function negotiateLanguage(
  acceptLanguage: string,
  supportedLanguages: string[],
  defaultLanguage: string,
): string {
  const preferred = acceptLanguage
    .split(',')
    .map((part) => part.split(';')[0].trim().slice(0, 2).toLowerCase())
    .filter(Boolean)
    .find((l) => supportedLanguages.includes(l));

  return preferred ?? defaultLanguage;
}
