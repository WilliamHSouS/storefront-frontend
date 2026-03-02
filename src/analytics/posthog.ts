/**
 * PostHog client — async SDK loading with queue-based stub.
 *
 * The inline stub in BaseLayout creates window.posthog as an array.
 * This module initializes the real SDK which drains that queue.
 * All calls before SDK load are preserved automatically.
 */

let initialized = false;

export async function initPostHog(): Promise<void> {
  if (initialized) return;
  if (typeof window === 'undefined') return;

  const key = import.meta.env.PUBLIC_POSTHOG_KEY;
  const host = import.meta.env.PUBLIC_POSTHOG_HOST;

  if (!key || !host) return;

  initialized = true;

  const { default: posthog } = await import('posthog-js');

  posthog.init(key, {
    api_host: host,
    capture_pageview: false, // We handle this manually
    capture_pageleave: true,
    persistence: 'localStorage+cookie',
    autocapture: false, // Explicit events only
    disable_session_recording: true,
    loaded: () => {
      // Disable in development
      if (import.meta.env.PUBLIC_ENVIRONMENT === 'development') {
        posthog.opt_out_capturing();
      }
    },
  });
}

export function getPostHog() {
  if (typeof window === 'undefined') return null;
  return (window as any).posthog ?? null;
}
