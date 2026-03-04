export function langToLocale(lang: string): string {
  if (lang === 'nl') return 'nl-NL';
  if (lang === 'de') return 'de-DE';
  return 'en-GB';
}

const formatters = new Map<string, Intl.NumberFormat>();

export function formatPrice(amount: string, currency: string, locale: string): string {
  const key = `${locale}:${currency}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
    formatters.set(key, fmt);
  }
  return fmt.format(Number(amount));
}
