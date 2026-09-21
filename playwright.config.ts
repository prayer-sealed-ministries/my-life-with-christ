import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end verification against the built site, not the dev server.
 *
 * The point is to look at what actually ships: the same bundle, the same lazy
 * chunks, the same CSS. A dev-server run would not tell us that.
 *
 * Which makes "which build is it actually looking at" the load-bearing
 * question, and it was once answered wrongly. `reuseExistingServer` was true
 * off CI, so Playwright probed 4173, found a preview server left over from an
 * earlier session, and adopted it. The suite ran against hours-old bytes and
 * reported a clean pass; a later run against the same stale server failed
 * every scripture-anchor assertion and read exactly like a product defect.
 *
 * Two changes, and both are needed:
 *
 *   1. Playwright owns the server, always. A process already on the port is
 *      now a hard error naming the port, not a silent adoption. Nothing here
 *      kills anything it did not start — a developer's own preview server is
 *      theirs, and a harness that reaches for `pkill` is a harness that will
 *      one day kill the wrong thing.
 *   2. `globalSetup` refuses to run a single spec until the server hands back
 *      the content digest of the build in `dist/`. Owning the lifecycle makes
 *      a stale server unlikely; only the digest makes it detectable.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  // Runs after webServer is up and before any spec. See tests/e2e/global-setup.ts.
  globalSetup: './tests/e2e/global-setup.ts',

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
    // Never. Not even locally, which is where the stale-server failure
    // happened — CI was the one environment that had always been safe.
    // Playwright stops what it starts, so consecutive runs are fine; an
    // unrelated process on the port is meant to be loud.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
