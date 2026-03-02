/**
 * Analytics context — provides core properties and session management.
 *
 * Core properties are merged into every event automatically.
 * UTM parameters are captured once from the landing URL and persisted
 * for the session via sessionStorage.
 */

import type { CoreProperties, UTMProperties } from './types';

let sessionId: string | null = null;

function getSessionId(): string {
  if (sessionId) return sessionId;

  if (typeof sessionStorage !== 'undefined') {
    sessionId = sessionStorage.getItem('analytics_session_id');
    if (sessionId) return sessionId;
  }

  sessionId = crypto.randomUUID();

  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('analytics_session_id', sessionId);
  }

  return sessionId;
}

export function getCoreProperties(): CoreProperties {
  const merchant = typeof window !== 'undefined'
    ? (window as any).__MERCHANT__
    : null;

  return {
    merchant_id: merchant?.merchantId ?? '',
    merchant_slug: merchant?.slug ?? '',
    language: typeof document !== 'undefined'
      ? document.documentElement.lang || 'nl'
      : 'nl',
    session_id: getSessionId(),
    environment: import.meta.env.PUBLIC_ENVIRONMENT ?? 'production',
  };
}

export function getUTMProperties(): UTMProperties {
  if (typeof window === 'undefined') return {};

  const stored = sessionStorage.getItem('analytics_utm');
  if (stored) {
    try { return JSON.parse(stored); } catch { /* ignore */ }
  }

  const params = new URLSearchParams(window.location.search);
  const utm: UTMProperties = {};
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

  for (const key of keys) {
    const value = params.get(key);
    if (value) utm[key] = value;
  }

  if (Object.keys(utm).length > 0) {
    sessionStorage.setItem('analytics_utm', JSON.stringify(utm));
  }

  return utm;
}
