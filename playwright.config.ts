import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'e2e/.report' }],
        ['json', { outputFile: 'e2e/.report/results.json' }],
      ]
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
          // CI: pre-build with Node adapter then serve via `astro preview`.
          // Eliminates 15+ min on-demand compilation bottleneck from `astro dev`.
          // Local: use `astro dev` for HMR and fast iteration.
          command: process.env.CI
            ? 'E2E_BUILD=1 astro build && E2E_BUILD=1 astro preview --port 4321 --host 0.0.0.0'
            : 'astro dev --port 4321',
          port: 4321,
          timeout: process.env.CI ? 120_000 : 30_000,
          reuseExistingServer: !process.env.CI,
        },
      ],

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
