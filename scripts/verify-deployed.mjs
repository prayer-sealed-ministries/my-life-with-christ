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
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BOOKS } from './lib/books.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const url = arg('url', 'https://systemslibrarian.github.io/lifewithchrist/');
const profile = arg('profile', 'public');

/**
 * The mirror has to be complete, and `BUNDLE_WAS_READ` cannot tell us that.
 *
 * Its floor is "at least five files", which a crawl that found the entry
 * chunk and stopped would clear easily — and all three sentinels live in that
 * one chunk, so it would find those too and report a clean pass over a small
 * fraction of the site. That very nearly happened: the first working crawl
 * returned 16 of 86 files, and it was caught by eye against a local build
 * rather than by any assertion.
 *
 * So the floor is derived from the content instead of from a constant. Vite
 * emits one lazily-loaded chunk per book of the canon, named after the book,
 * and those chunks are exactly what a crawl that misses relative imports fails
 * to reach. Every book must be present, or the mirror is not the site.
 */
function assertMirrorIsComplete(dir) {
  const files = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push({ name: entry.name, bytes: statSync(path).size });
    }
  };
  walk(dir);

  const bytes = files.reduce((total, file) => total + file.bytes, 0);
  const names = files.map((file) => file.name);

  // Hashes are base64url and routinely contain `-`: `1-timothy--7hg5bWl.js`,
  // `lamentations-CMRvHo4-.js`. A `[^-]+` hash pattern reported six books
  // missing from a mirror that had them, which is the same class of mistake
  // this floor exists to catch — so the floor was made to prove itself too.
  // Longest id first: `1-john-HASH.js` must not be claimed by `john`.
  const ids = BOOKS.map((book) => book.id).sort((a, b) => b.length - a.length);
  const unclaimed = new Set(names.filter((name) => name.endsWith('.js')));
  const missing = [];
  for (const id of ids) {
    const chunk = [...unclaimed].find((name) => new RegExp(`^${id}-[A-Za-z0-9_-]+\\.js$`).test(name));
    if (chunk) unclaimed.delete(chunk);
    else missing.push(id);
  }

  console.log(
    `\nmirror: ${files.length} files, ${Math.round(bytes / 1024)}kB, ` +
      `${ids.length - missing.length}/${ids.length} book chunks present`,
  );

  if (missing.length > 0) {
    console.error(
      `\nThe mirror is missing ${missing.length} book chunk(s): ${missing.join(', ')}.`,
    );
    console.error(
      'The crawl did not reach the whole site, so any PASS below would be a pass over a fraction of it.',
    );
    process.exit(1);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'journey-deployed-'));
try {
  const mirror = spawnSync('node', ['scripts/mirror-deployed.mjs', url, dir], {
    stdio: 'inherit',
  });
  if (mirror.status !== 0) process.exit(mirror.status ?? 1);

  assertMirrorIsComplete(dir);

  const verify = spawnSync(
    'node',
    ['scripts/verify-bundle.mjs', '--profile', profile, '--dist', dir],
    { stdio: 'inherit' },
  );
  process.exit(verify.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
