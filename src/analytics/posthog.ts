/**
 * PostHog client — CDN-loaded SDK with queue-based stub.
 *
 * The inline stub in BaseLayout creates window.posthog as an array.
 * This module loads the real PostHog SDK from their CDN (not bundled)
 * which drains that queue on init. All calls before SDK load are
 * preserved automatically.
 *
 * Loading from CDN saves ~59 kB gzipped from the client JS bundle.
 */

/** Minimal contract for the PostHog client methods we actually use. */
export interface PostHogLike {
  capture(event: string, properties?: Record<string, unknown>): void;
  identify(id: string): void;
  reset(): void;
}

/** Extended type for the CDN-loaded PostHog instance (includes init/opt_out). */
interface PostHogCDN extends PostHogLike {
  init(key: string, config: Record<string, unknown>): void;
  opt_out_capturing(): void;
}

let initialized = false;

/**
 * Load the PostHog SDK from CDN by injecting a script tag.
 * Returns a promise that resolves when the script is loaded.
 */
function loadPostHogFromCDN(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Already loaded (e.g. by a previous call)
    if (
      typeof window !== 'undefined' &&
      window.posthog &&
      typeof window.posthog === 'object' &&
      '__loaded' in window.posthog
    ) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://us-assets.i.posthog.com/static/array.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PostHog SDK from CDN'));
    document.head.appendChild(script);
  });
}

export async function initPostHog(): Promise<void> {
  if (initialized) return;
  if (typeof window === 'undefined') return;

  const key = import.meta.env.PUBLIC_POSTHOG_KEY;
  const host = import.meta.env.PUBLIC_POSTHOG_HOST;

  if (!key || !host) return;

  initialized = true;

  await loadPostHogFromCDN();

  // After CDN load, window.posthog is the real PostHog instance.
  // The CDN script exposes init/opt_out_capturing beyond our minimal PostHogLike contract.
  const posthog = window.posthog as unknown as PostHogCDN | undefined;
  if (!posthog) return;

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

export function getPostHog(): PostHogLike | null {
  if (typeof window === 'undefined') return null;
  return (window as Window & { posthog?: PostHogLike }).posthog ?? null;
}
