/** Vitest global setup — runs before each test file. */

// Suppress log.warn() noise in test output (log.error() still prints).
(globalThis as Record<string, unknown>).__TESTING__ = true;
