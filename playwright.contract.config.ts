/**
 * Playwright config for contract tests only.
 *
 * Used by the CI contract job to run e2e/contract.spec.ts without
 * the testIgnore pattern from the main playwright.config.ts.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /contract\.spec\.ts/,
  outputDir: './e2e/.results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4321',
  },

  webServer: {
    command: 'npx tsx e2e/helpers/mock-api.ts',
    port: 4322,
    timeout: 10_000,
    reuseExistingServer: true,
  },

  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
