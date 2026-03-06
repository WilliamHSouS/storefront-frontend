import type { MerchantTheme } from '@/types/merchant';

/** Strip characters that could escape the CSS custom property value context. */
function sanitizeCSSValue(value: string): string {
  return value.replace(/[{}<>;]/g, '');
}

export function themeToCSS(theme: Partial<MerchantTheme>): string {
  return Object.entries(theme)
    .map(([key, value]) => {
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `--${cssKey}: ${sanitizeCSSValue(String(value))};`;
    })
    .join('\n  ');
}
