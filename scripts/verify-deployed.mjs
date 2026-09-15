#!/usr/bin/env node
/**
 * Run the data gate against what GitHub Pages is actually serving.
 *
 * CI gates the artefact it just built, which is the right place to stop a bad
 * deploy. It is not proof about the site. A stale artefact, a partial upload,
 * a manual publish, or a workflow edited after the fact would all leave CI
 * green and the live site wrong — and purchased material reaching the open web
 * is the one mistake here that cannot be taken back.
 *
 * So this mirrors the live site by crawling it, and points verify-bundle at
 * the mirror. It is deliberately run by hand rather than on a schedule; a
 * scheduled check that nobody reads is not a check.
 *
 * Usage: npm run verify:deployed [-- --url https://... --profile public]
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const url = arg('url', 'https://systemslibrarian.github.io/lifewithchrist/');
const profile = arg('profile', 'public');

const dir = mkdtempSync(join(tmpdir(), 'journey-deployed-'));
try {
  const mirror = spawnSync('node', ['scripts/mirror-deployed.mjs', url, dir], {
    stdio: 'inherit',
  });
  if (mirror.status !== 0) process.exit(mirror.status ?? 1);

  const verify = spawnSync(
    'node',
    ['scripts/verify-bundle.mjs', '--profile', profile, '--dist', dir],
    { stdio: 'inherit' },
  );
  process.exit(verify.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
