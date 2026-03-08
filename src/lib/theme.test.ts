import { describe, it, expect } from 'vitest';
import { themeToCSS } from './theme';

describe('themeToCSS', () => {
  it('converts camelCase keys to kebab-case CSS custom properties', () => {
    const css = themeToCSS({
      background: '0 0% 100%',
      cardForeground: '0 0% 3.9%',
      radius: '0.5rem',
      fontHeading: 'DM Sans',
      fontBody: 'Inter',
    });
    expect(css).toContain('--background: 0 0% 100%');
    expect(css).toContain('--card-foreground: 0 0% 3.9%');
    expect(css).toContain('--radius: 0.5rem');
    expect(css).toContain('--font-heading: DM Sans');
    expect(css).toContain('--font-body: Inter');
  });

  it('strips CSS injection characters from values', () => {
    const css = themeToCSS({
      background: '0 0% 100%; } body { display: none',
    });
    expect(css).not.toContain('{');
    expect(css).not.toContain('}');
    // Braces and semicolons stripped; colons are safe within CSS values
    expect(css).toContain('--background: 0 0% 100%  body  display: none;');
  });
});
