import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_500 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: {
    command: 'node --enable-source-maps dist/server/index.js',
    env: {
      PORT: '4173',
      APP_ORIGIN: 'http://127.0.0.1:4173',
      DATA_DIR: '.playwright-data',
      DATABASE_PATH: '.playwright-data/job.sqlite',
      NODE_ENV: 'test'
    },
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  }
});
