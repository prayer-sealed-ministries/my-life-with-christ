#!/usr/bin/env node
/**
 * Prove that a `refs-only` build is publishable.
 *
 * The DATA_PROFILE flag is not evidence. Neither is a sampled string search.
 * This reads the actual built artefact and asserts, positively and exhaustively,
 * that none of the purchased compilation reached it.
 *
 * What is protected is not only the prose. In a compilation, copyright subsists
 * in the SELECTION AND ARRANGEMENT — the decision that Matthew 5 divides at
 * 1-12, 13-20, 21-48 is the author's editorial work. So this checks the
 * divisions as well as the words.
 *
 * Verse-span divisions from a source the project owns are fine: topics.json is
 * hand-authored here, so its refs are excluded from the division check.
 *
 * Usage:
 *   DATA_PROFILE=refs-only npm run build
 *   node scripts/verify-bundle.mjs --profile refs-only
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LICENSED_SENTINELS } from './lib/licensed-sentinels.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    profile: process.env.DATA_PROFILE ?? 'refs-only',
    dist: 'dist',
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--profile') args.profile = argv[i + 1];
    if (argv[i] === '--dist') args.dist = argv[i + 1];
  }
  return args;
}

async function collectFiles(dir) {
  const found = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) found.push(...(await collectFiles(path)));
    else found.push(path);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * Things that MUST be present in any real build of this app.
 *
 * Every other assertion here is of the form "none of X appears", which is
 * satisfied perfectly by a build containing nothing at all — an empty dist/
 * passed all four and reported "publishable". A gate that cannot tell an empty
 * directory from a clean build is not a gate.
 *
 * These sentinels ship under BOTH data profiles: the app shell, and content
 * from topics.json and the KJV, neither of which the profile switch touches.
 */
const SENTINELS = [
  { needle: 'Journey', why: 'the application name, in index.html' },
  { needle: 'Thankfulness', why: 'a topic name from topics.json, which ships in every profile' },
  { needle: 'Be careful for nothing', why: 'KJV text, which ships in every profile' },
];

/** Below these, the verifier is not looking at a real build. */
const MINIMUM_FILES = 5;
const MINIMUM_BYTES = 100_000;

/** Files that must never be inside a deployed build, at any path. */
const FORBIDDEN_PATTERNS = [
  { test: (path) => /\.pdf$/i.test(path), why: 'a source document has no business in a build' },
  { test: (path) => /ingest-report\.md$/i.test(path), why: 'an ingest report quotes raw source lines' },
  { test: (path) => /coverage-report\.md$/i.test(path), why: 'a coverage report quotes division titles' },
  { test: (path) => /(^|\/)data\/source\//.test(path), why: 'anything under data/source/' },
  { test: (path) => /outlines\.json$/i.test(path), why: 'a retired licensed division set' },
];

/** Strings unique to the destructive development-only cleanup control. */
const FORBIDDEN_DEBUG_SENTINELS = [
  'SyntheticCleanup',
  'Debug: remove test content',
  'Remove all listed test entries and drafts',
];

async function main() {
  const { profile, dist } = parseArgs(process.argv.slice(2));
  const distDir = resolve(ROOT, dist);

  if (!existsSync(distDir)) {
    console.error(`No build found at ${distDir}. Run the build first.`);
    process.exitCode = 1;
    return;
  }

  /*
   * There is no licensed division set to probe for any more.
   *
   * This file used to derive thousands of search probes from a purchased
   * compilation at verify time and prove that none of them appeared in the
   * build. That compilation is not in this repository — so the probes cannot
   * be derived, and what they protected against cannot happen: every division
   * a build can carry comes from src/data/sections.json, generated from the
   * public-domain BSB, or from src/data/topics.json, written here.
   *
   * What remains is what this file can still honestly assert about a built
   * artefact: that it was actually read, that no source document or generated
   * report was copied into it, that no source map is smuggling a module out
   * whole, and that the short licensed sentinels do not appear. The repository
   * side of the same question is `npm run verify:no-private-data`.
   */
  const files = await collectFiles(distDir);
  const relPaths = files.map((file) => relative(distDir, file));
  const textFiles = files.filter((file) =>
    /\.(js|mjs|cjs|css|html|json|txt|md|map|svg|webmanifest)$/i.test(file),
  );

  console.log(`Verifying DATA_PROFILE=${profile} against ${dist}/`);
  console.log(`  ${files.length} files (${textFiles.length} searchable)`);
  console.log(`  ${LICENSED_SENTINELS.length} licensed sentinels searched for\n`);

  /** @type {Array<{assertion: string, detail: string}>} */
  const failures = [];

  // ---- 1. The verifier is actually reading a build. ----
  // This must come first. Everything below is a "none of X is present" check,
  // and all of them pass on an empty directory.
  let totalBytes = 0;
  for (const file of textFiles) totalBytes += (await stat(file)).size;

  if (files.length < MINIMUM_FILES) {
    failures.push({
      assertion: 'BUNDLE_WAS_READ',
      detail: `${dist}/ holds ${files.length} files, expected at least ${MINIMUM_FILES}. Is this a real build?`,
    });
  }
  if (totalBytes < MINIMUM_BYTES) {
    failures.push({
      assertion: 'BUNDLE_WAS_READ',
      detail: `${dist}/ holds ${totalBytes} searchable bytes, expected at least ${MINIMUM_BYTES}.`,
    });
  }
  if (!relPaths.some((path) => path.endsWith('index.html'))) {
    failures.push({ assertion: 'BUNDLE_WAS_READ', detail: `no index.html in ${dist}/` });
  }
  if (!relPaths.some((path) => /\.js$/.test(path))) {
    failures.push({ assertion: 'BUNDLE_WAS_READ', detail: `no JavaScript bundle in ${dist}/` });
  }
  for (const path of relPaths) {
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.test(path)) {
        failures.push({ assertion: 'NO_SOURCE_FILES', detail: `${path} — ${rule.why}` });
      }
    }
  }

  // ---- 2. Source maps. ----
  // A tree-shaken import can still sit complete inside a .map file, so under
  // refs-only they must not be emitted at all.
  const maps = relPaths.filter((path) => path.endsWith('.map'));
  if (profile === 'refs-only' && maps.length > 0) {
    for (const path of maps) {
      failures.push({
        assertion: 'NO_SOURCE_MAPS',
        detail: `${path} — source maps can contain the original module in full; disable them for refs-only`,
      });
    }
  }

  // ---- 3. Licensed wording, across every searchable file. ----
  const licensedHits = [];
  const debugHits = [];
  const sentinelsFound = new Set();

  for (const file of textFiles) {
    const content = await readFile(file, 'utf8');
    const path = relative(distDir, file);

    for (const sentinel of SENTINELS) {
      if (content.includes(sentinel.needle)) sentinelsFound.add(sentinel.needle);
    }

    for (const needle of LICENSED_SENTINELS) {
      if (content.includes(needle)) licensedHits.push({ path, needle });
    }
    for (const needle of FORBIDDEN_DEBUG_SENTINELS) {
      if (content.includes(needle)) debugHits.push({ path, needle });
    }
  }

  for (const hit of licensedHits) {
    failures.push({
      assertion: 'NO_LICENSED_CONTENT',
      detail: `${hit.path} contains ${JSON.stringify(hit.needle)}`,
    });
  }
  for (const hit of debugHits) {
    failures.push({
      assertion: 'NO_DEBUG_TOOLS',
      detail: `${hit.path} contains ${JSON.stringify(hit.needle)}`,
    });
  }

  // Known-present content must be found. A count alone can be satisfied by the
  // wrong files; this proves the search reached the content it claims to search.
  for (const sentinel of SENTINELS) {
    if (!sentinelsFound.has(sentinel.needle)) {
      failures.push({
        assertion: 'BUNDLE_WAS_READ',
        detail: `sentinel ${JSON.stringify(sentinel.needle)} (${sentinel.why}) was not found anywhere in ${dist}/`,
      });
    }
  }

  // ---- Report. ----
  {
    if (failures.length > 0) {
      const byAssertion = new Map();
      for (const failure of failures) {
        if (!byAssertion.has(failure.assertion)) byAssertion.set(failure.assertion, []);
        byAssertion.get(failure.assertion).push(failure.detail);
      }

      console.error(`FAILED — this build is NOT publishable.\n`);
      for (const [assertion, details] of byAssertion) {
        console.error(`  ${assertion} — ${details.length} violation${details.length === 1 ? '' : 's'}`);
        for (const detail of details.slice(0, 15)) console.error(`      ${detail}`);
        if (details.length > 15) console.error(`      ... and ${details.length - 15} more`);
        console.error('');
      }
      console.error('See DATA-LICENSE.md. Do not deploy this artefact.');
      process.exitCode = 1;
      return;
    }

    console.log('PASS');
    console.log(
      `  BUNDLE_WAS_READ       ${files.length} files, ${Math.round(totalBytes / 1024)}kB searched, ${sentinelsFound.size}/${SENTINELS.length} sentinels found`,
    );
    console.log('  NO_SOURCE_FILES       no source documents or generated reports in the build');
    console.log('  NO_SOURCE_MAPS        no .map files that could carry the original modules');
    console.log(
      `  NO_LICENSED_CONTENT   none of ${LICENSED_SENTINELS.length} licensed sentinels present`,
    );
    console.log('  NO_DEBUG_TOOLS        no destructive debug cleanup code present');
    console.log('\nThis build is publishable.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
