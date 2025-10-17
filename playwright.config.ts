import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './web/tests',
  fullyParallel: false, // Run tests sequentially to avoid tmux conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid tmux session conflicts
  reporter: 'html',
  timeout: 60000, // 60 seconds per test

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: undefined, // We start the server manually in tests
});
