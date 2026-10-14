#!/usr/bin/env node
/**
 * Prove that a built artefact is publishable.
 *
 * Both profiles are deployable, and every assertion here applies to both. The
 * `--profile` argument says which build is being verified and appears in the
 * output so an artefact can be matched to the profile that produced it; it does
 * not decide which checks run. One check used to be conditional on it while its
 * PASS line printed regardless — see scripts/lib/assertion-registry.mjs.
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
 *
 *   npm run build            # unset DATA_PROFILE resolves to public
 *   node scripts/verify-bundle.mjs --profile public
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAssertionRegistry } from './lib/assertion-registry.mjs';
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

/**
 * Every assertion that must run before this verifier may reach a verdict.
 *
 * The summary is generated from the registry, so a line can only be printed by
 * a check that executed, and any of these that did not run is itself a failure.
 * See scripts/lib/assertion-registry.mjs for what that replaces.
 */
const REQUIRED_ASSERTIONS = [
  'BUNDLE_WAS_READ',
  'NO_SOURCE_FILES',
  'NO_SOURCE_MAPS',
  'NO_LICENSED_CONTENT',
  'NO_DEBUG_TOOLS',
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

  // What each check is allowed to claim, recorded by the check itself.
  const registry = createAssertionRegistry(REQUIRED_ASSERTIONS);

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
  registry.ran(
    'NO_SOURCE_FILES',
    `no source documents or generated reports among ${relPaths.length} paths, against ${FORBIDDEN_PATTERNS.length} patterns`,
  );

  // ---- 2. Source maps. ----
  /*
   * A .map file can hold the original module in full, so a tree-shaken import
   * is still published intact — and so is anything the __DEBUG_TOOLS__ define
   * was meant to drop. Every profile this repository can build is publishable,
   * so none of them may carry one.
   *
   * This check used to run only for `refs-only` while its PASS line printed
   * unconditionally, so a `public` build with 112 maps — one carrying the whole
   * destructive debug cleanup component — was told it had none. The condition is
   * gone, and the claim is now issued by this block rather than by the summary.
   */
  const maps = relPaths.filter((path) => path.endsWith('.map'));
  for (const path of maps) {
    failures.push({
      assertion: 'NO_SOURCE_MAPS',
      detail: `${path} — a source map can contain the original module in full; no publishable profile may emit one (profile: ${profile})`,
    });
  }
  // Phrased as what was examined, not as what was concluded: the summary is
  // only ever printed on a clean pass, and a line that states its own scope
  // cannot quietly become false the way "no .map files" did.
  registry.ran('NO_SOURCE_MAPS', `no .map files among ${relPaths.length} paths examined, any profile`);

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
  registry.ran(
    'NO_LICENSED_CONTENT',
    `none of ${LICENSED_SENTINELS.length} licensed sentinels present in ${textFiles.length} searchable files`,
  );
  registry.ran(
    'NO_DEBUG_TOOLS',
    `none of ${FORBIDDEN_DEBUG_SENTINELS.length} debug sentinels present in ${textFiles.length} searchable files`,
  );

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
  registry.ran(
    'BUNDLE_WAS_READ',
    `${files.length} files, ${Math.round(totalBytes / 1024)}kB searched, ${sentinelsFound.size}/${SENTINELS.length} sentinels found`,
  );

  /*
   * A verdict is only worth as much as the checks behind it.
   *
   * Every assertion above records itself where it runs. If one is ever made
   * conditional — on a profile, on a flag, on an early return — this turns the
   * silence into a failure instead of letting the summary speak for a check
   * that never happened.
   */
  for (const assertion of registry.missing()) {
    failures.push({
      assertion: 'ASSERTIONS_COMPLETE',
      detail: `${assertion} never ran for profile ${profile}, so this artefact has not been verified`,
    });
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

    /*
     * Printed from the registry, so each line is the claim of a check that
     * actually ran. There are no literal summary strings here on purpose: the
     * five that used to live at this spot were printed unconditionally, and one
     * of them went on asserting "no .map files" for years of public builds
     * whose source-map check never executed.
     */
    const lines = registry.passLines();
    const width = Math.max(...lines.map((line) => line.assertion.length)) + 2;

    console.log('PASS');
    for (const { assertion, summary } of lines) {
      console.log(`  ${assertion.padEnd(width)}${summary}`);
    }
    console.log('\nThis build is publishable.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
