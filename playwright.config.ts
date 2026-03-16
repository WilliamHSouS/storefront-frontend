import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]]
    : [['list'], ['html', { open: 'on-failure', outputFolder: 'e2e/.report' }]],

  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  webServer: process.env.BASE_URL
    ? undefined
    : [
        {
          command: 'npx tsx e2e/helpers/mock-api.ts',
          port: 4322,
          timeout: 10_000,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: 'astro dev --port 4321',
          // Use url instead of port so Playwright waits for Astro to actually
          // serve a page (not just bind the port). On CI, Astro's on-demand
          // compilation can take a while on first request.
          url: 'http://localhost:4321/nl/',
          timeout: process.env.CI ? 120_000 : 30_000,
          reuseExistingServer: !process.env.CI,
        },
      ],

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
