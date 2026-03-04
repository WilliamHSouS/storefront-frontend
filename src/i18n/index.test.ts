import { describe, it, expect } from 'vitest';
import { t, getAvailableLanguages } from '@/i18n';

describe('t (translation lookup)', () => {
  it('returns Dutch translation for nl', () => {
    expect(t('cart', 'nl')).toBe('Winkelwagen');
  });

  it('returns English translation for en', () => {
    expect(t('cart', 'en')).toBe('Cart');
  });

  it('returns German translation for de', () => {
    expect(t('cart', 'de')).toBe('Warenkorb');
  });

  it('falls back to nl for unknown language', () => {
    expect(t('cart', 'unknown-lang')).toBe('Winkelwagen');
  });

  it('returns the key itself for a missing key', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(t('nonexistent-key' as any, 'en')).toBe('nonexistent-key');
  });
});

describe('t (interpolation)', () => {
  it('replaces {count} placeholder', () => {
    expect(t('items_one', 'en', { count: 1 })).toBe('1 item');
  });

  it('replaces {count} in plural form', () => {
    expect(t('items_other', 'en', { count: 5 })).toBe('5 items');
  });

  it('replaces {count} in Dutch locale', () => {
    expect(t('items_other', 'nl', { count: 3 })).toBe('3 items');
  });
});

describe('getAvailableLanguages', () => {
  it('returns all supported languages', () => {
    const langs = getAvailableLanguages();
    expect(langs).toContain('nl');
    expect(langs).toContain('en');
    expect(langs).toContain('de');
    expect(langs).toHaveLength(3);
  });
});
