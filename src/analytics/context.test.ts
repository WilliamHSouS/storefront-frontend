import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCoreProperties, getUTMProperties } from './context';

describe('getCoreProperties', () => {
  beforeEach(() => {
    // Clear any cached session ID between tests by resetting the module
    vi.resetModules();
  });

  it('returns core properties with a session_id', () => {
    const props = getCoreProperties();
    expect(props.session_id).toBeTruthy();
    expect(typeof props.session_id).toBe('string');
    expect(props.session_id.length).toBeGreaterThan(0);
  });

  it('returns consistent session_id across calls', () => {
    const first = getCoreProperties();
    const second = getCoreProperties();
    expect(first.session_id).toBe(second.session_id);
  });

  it('returns language from document.documentElement.lang', () => {
    document.documentElement.lang = 'en';
    const props = getCoreProperties();
    expect(props.language).toBe('en');
    document.documentElement.lang = ''; // reset
  });

  it('defaults language to nl when not set', () => {
    document.documentElement.lang = '';
    const props = getCoreProperties();
    expect(props.language).toBe('nl');
  });
});

describe('getUTMProperties', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns empty object when no UTM params present', () => {
    const utm = getUTMProperties();
    expect(utm).toEqual({});
  });

  it('reads UTM params from sessionStorage if cached', () => {
    const cached = { utm_source: 'google', utm_medium: 'cpc' };
    sessionStorage.setItem('analytics_utm', JSON.stringify(cached));
    const utm = getUTMProperties();
    expect(utm).toEqual(cached);
  });

  it('handles corrupt sessionStorage data gracefully', () => {
    sessionStorage.setItem('analytics_utm', 'not-json');
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const utm = getUTMProperties();
    // Should not throw, returns empty (no URL params in test env)
    expect(utm).toEqual({});
    expect(consoleSpy).toHaveBeenCalledWith(
      '[analytics]',
      expect.stringContaining('Corrupt UTM data'),
      expect.anything(),
    );
    // Should have cleaned up the corrupt entry
    expect(sessionStorage.getItem('analytics_utm')).toBeNull();
  });
});
