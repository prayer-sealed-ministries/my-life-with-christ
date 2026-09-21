/**
 * Before any spec runs: prove the server is serving this run's build.
 *
 * Playwright starts `webServer` before global setup, so by the time this runs
 * there is something listening — and "something is listening" was exactly the
 * readiness signal that let a stale preview server from an earlier session be
 * adopted, serving a bundle hours old. Every scripture-anchor assertion failed
 * and looked like a product defect in the feature under test.
 *
 * This is the check that would have caught it in the first second, with a
 * sentence naming the cause instead of five red tests naming a symptom.
 *
 * See scripts/lib/build-identity.mjs.
 */

import { resolve } from 'node:path';
import type { FullConfig } from '@playwright/test';

// Plain ESM, shared with the build plugin and the policy tests. One definition
// of what a build identity is; two would drift.
// @ts-expect-error - .mjs module without types, resolved at runtime by Node
import { verifyServedBuild } from '../../scripts/lib/build-identity.mjs';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) {
    throw new Error('No baseURL configured; cannot verify what the suite is testing.');
  }

  // When a run names a profile, hold the server to it. This is what stops a
  // `refs-only` leg of the sweep quietly passing against a `public` server:
  // the two build different segment lists, so a pass on one is not a pass on
  // the other and a mix-up is invisible in the results.
  const expectProfile = process.env.DATA_PROFILE;

  const served = await verifyServedBuild({
    distDir: resolve(process.cwd(), 'dist'),
    baseURL,
    expectProfile,
  });

  console.log(
    `e2e build identity: ${served.digest.slice(0, 12)} — ${served.files} files, ` +
      `profile ${served.profile}, served by ${baseURL}`,
  );
}
