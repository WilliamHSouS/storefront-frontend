import type { MerchantTheme } from '@/types/merchant';

/** Allowlist-based sanitizer for CSS custom property values.
 *  Permits: alphanumeric, spaces, dots, commas, colons, #, %, hyphens, single quotes (font names). */
function sanitizeCSSValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9\s.,:#%'\-]/g, '');
}

export function themeToCSS(theme: Partial<MerchantTheme>): string {
  return Object.entries(theme)
    .map(([key, value]) => {
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `--${cssKey}: ${sanitizeCSSValue(String(value))};`;
    })
    .join('\n  ');
}
