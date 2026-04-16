// Playwright configuration for the browser smoke test.
//
// This is a small, optional layer on top of the Vitest suite. It runs the
// built SPA inside a real browser (Chromium) against `npm run preview` so
// that at least one user-visible journey is exercised through real DOM,
// real audio + worker APIs, and real IndexedDB. See README for how to run.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/browser',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
