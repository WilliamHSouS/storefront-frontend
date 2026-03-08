import { describe, it, expect } from 'vitest';
import { negotiateLanguage } from './negotiate-language';

describe('negotiateLanguage', () => {
  const supported = ['nl', 'en'];
  const defaultLang = 'nl';

  it('picks first supported language from Accept-Language', () => {
    expect(negotiateLanguage('en-US,en;q=0.9,nl;q=0.8', supported, defaultLang)).toBe('en');
  });

  it('picks Dutch when it appears first', () => {
    expect(negotiateLanguage('nl-NL,nl;q=0.9,en;q=0.8', supported, defaultLang)).toBe('nl');
  });

  it('falls back to default when no languages match', () => {
    expect(negotiateLanguage('fr-FR,fr;q=0.9,de;q=0.8', supported, defaultLang)).toBe('nl');
  });

  it('falls back to default for empty header', () => {
    expect(negotiateLanguage('', supported, defaultLang)).toBe('nl');
  });

  it('handles wildcard entries', () => {
    expect(negotiateLanguage('*', supported, defaultLang)).toBe('nl');
  });

  it('handles language-only codes without region', () => {
    expect(negotiateLanguage('en', supported, defaultLang)).toBe('en');
  });

  it('handles complex Accept-Language with many entries', () => {
    expect(negotiateLanguage('de-DE,de;q=0.9,en-GB;q=0.8,en;q=0.7', supported, defaultLang)).toBe(
      'en',
    );
  });

  it('is case-insensitive', () => {
    expect(negotiateLanguage('EN-US', supported, defaultLang)).toBe('en');
  });

  it('ignores whitespace', () => {
    expect(negotiateLanguage('  en-US , nl;q=0.5 ', supported, defaultLang)).toBe('en');
  });

  it('works with single-language merchant', () => {
    expect(negotiateLanguage('en-US,en;q=0.9', ['nl'], 'nl')).toBe('nl');
  });
});
