import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end verification against the built site, not the dev server.
 *
 * The point is to look at what actually ships: the same bundle, the same lazy
 * chunks, the same CSS. A dev-server run would not tell us that.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    // Deterministic rendering: no animation mid-screenshot.
    launchOptions: { args: ['--force-prefers-reduced-motion'] },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: {
    command: 'npx vite preview --port 4173 --strictPort --host localhost',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
