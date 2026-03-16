/**
 * Lightweight logger that wraps console.warn / console.error.
 *
 * - Consistent `[tag]` prefix on every message.
 * - `warn` is suppressed when `globalThis.__TESTING__` is true, reducing
 *   noise in unit/E2E test output while keeping errors visible.
 * - Zero dependencies, tree-shakeable.
 */

function isTestEnv(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    (globalThis as Record<string, unknown>).__TESTING__ === true
  );
}

export function warn(tag: string, ...args: unknown[]): void {
  if (isTestEnv()) return;
  console.warn(`[${tag}]`, ...args);
}

export function error(tag: string, ...args: unknown[]): void {
  console.error(`[${tag}]`, ...args);
}
