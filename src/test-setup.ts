/** Vitest global setup — runs before each test file. */

// Suppress log.warn() noise in test output (log.error() still prints).
(globalThis as Record<string, unknown>).__TESTING__ = true;

// Inject English i18n messages so the client-side t() function resolves keys.
// In production, BaseLayout injects these via window.__MESSAGES__.
import en from './i18n/messages/en.json';
(globalThis as Record<string, unknown>).__MESSAGES__ = en;
