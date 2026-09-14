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

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareToBaseline,
  divisionNeedles,
  divisionProbes,
  measureProbes,
  proseProbes,
} from './lib/probes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts/probe-baseline.json');

function parseArgs(argv) {
  const args = {
    profile: process.env.DATA_PROFILE ?? 'refs-only',
    dist: 'dist',
    acceptSmaller: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--profile') args.profile = argv[i + 1];
    if (argv[i] === '--dist') args.dist = argv[i + 1];
    if (argv[i] === '--accept-smaller-probe-set') args.acceptSmaller = true;
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
  { test: (path) => /\.pdf$/i.test(path), why: 'the purchased source PDFs' },
  { test: (path) => /ingest-report\.md$/i.test(path), why: 'the ingest report quotes raw source lines' },
  { test: (path) => /coverage-report\.md$/i.test(path), why: 'the coverage report quotes outline titles' },
  { test: (path) => /(^|\/)data\/source\//.test(path), why: 'anything under data/source/' },
  { test: (path) => /outlines\.json$/i.test(path), why: 'the parsed compilation' },
];

async function main() {
  const { profile, dist, acceptSmaller } = parseArgs(process.argv.slice(2));
  const distDir = resolve(ROOT, dist);

  if (!existsSync(distDir)) {
    console.error(`No build found at ${distDir}. Run the build first.`);
    process.exitCode = 1;
    return;
  }

  const books = JSON.parse(await readFile(join(ROOT, 'src/data/outlines.json'), 'utf8'));
  const { topics } = JSON.parse(await readFile(join(ROOT, 'src/data/topics.json'), 'utf8'));

  const prose = proseProbes(books);
  const divisions = divisionProbes(books, topics);

  // ---- 0. The gate must not have weakened since it was last frozen. ----
  // Probes are derived from the outline data, so a shrunken dataset means a
  // shrunken gate. That has to fail loudly, not pass quietly.
  const measured = measureProbes(books, topics);
  const baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(await readFile(BASELINE_PATH, 'utf8'))
    : null;

  /** @type {Array<{assertion: string, detail: string}>} */
  const erosion = [];

  if (!baseline) {
    erosion.push({
      assertion: 'PROBE_SET_INTACT',
      detail: `no frozen baseline at ${relative(ROOT, BASELINE_PATH)} — the gate has nothing to be measured against`,
    });
  } else {
    const { shrunk, grown, digestsChanged } = compareToBaseline(measured, baseline);

    if (shrunk.length > 0 && !acceptSmaller) {
      for (const change of shrunk) {
        erosion.push({
          assertion: 'PROBE_SET_INTACT',
          detail:
            `${change.field}: ${change.was} -> ${change.now} (down ${change.was - change.now}). ` +
            `The gate is weaker than it was. Find out why the outline data shrank before accepting this.`,
        });
      }
    }

    for (const change of grown) {
      console.log(`  note: ${change.field} grew ${change.was} -> ${change.now} (gate is stronger)`);
    }
    for (const field of digestsChanged) {
      console.log(`  note: ${field} changed — probe content differs, size did not shrink`);
    }

    if (shrunk.length > 0 && acceptSmaller) {
      console.log('\n  --accept-smaller-probe-set given. Recording the smaller set:');
      for (const change of shrunk) {
        console.log(`      ${change.field}: ${change.was} -> ${change.now}`);
      }
    }

    if ((shrunk.length > 0 && acceptSmaller) || grown.length > 0 || digestsChanged.length > 0) {
      await writeFile(
        BASELINE_PATH,
        `${JSON.stringify({ ...baseline, ...measured }, null, 2)}\n`,
        'utf8',
      );
      console.log(`  baseline updated: ${relative(ROOT, BASELINE_PATH)}\n`);
    }
  }

  const files = await collectFiles(distDir);
  const relPaths = files.map((file) => relative(distDir, file));
  const textFiles = files.filter((file) => /\.(js|mjs|cjs|css|html|json|txt|md|map|svg|webmanifest)$/i.test(file));

  console.log(`Verifying DATA_PROFILE=${profile} against ${dist}/`);
  console.log(`  ${files.length} files (${textFiles.length} searchable)`);
  console.log(`  ${prose.size} prose probes (every title and intro in the compilation)`);
  console.log(`  ${divisions.size} division probes (every verse-span boundary, minus our own)\n`);

  /** @type {Array<{assertion: string, detail: string}>} */
  const failures = [...erosion];

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

  // ---- 3 and 4. Prose and divisions, across every searchable file. ----
  const proseHits = [];
  const divisionHits = [];
  const sentinelsFound = new Set();

  for (const file of textFiles) {
    const content = await readFile(file, 'utf8');
    const path = relative(distDir, file);

    for (const sentinel of SENTINELS) {
      if (content.includes(sentinel.needle)) sentinelsFound.add(sentinel.needle);
    }

    for (const [probe, kind] of prose) {
      if (content.includes(probe)) proseHits.push({ path, kind, probe });
    }
    for (const entry of divisions.values()) {
      for (const needle of divisionNeedles(entry)) {
        if (content.includes(needle)) {
          divisionHits.push({ path, id: entry.id, needle });
          break;
        }
      }
    }
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

  if (profile === 'refs-only') {
    for (const hit of proseHits) {
      failures.push({
        assertion: 'NO_OUTLINE_PROSE',
        detail: `${hit.path}: ${hit.kind} ${JSON.stringify(hit.probe.slice(0, 70))}`,
      });
    }
    for (const hit of divisionHits) {
      failures.push({
        assertion: 'NO_OUTLINE_DIVISIONS',
        detail: `${hit.path}: division ${hit.id} present as ${JSON.stringify(hit.needle.slice(0, 60))}`,
      });
    }
  }

  // ---- Report. ----
  if (profile === 'refs-only') {
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
    console.log(`  PROBE_SET_INTACT      gate is as strong as its frozen baseline`);
    console.log('  NO_SOURCE_FILES       no PDFs, reports, or outlines.json in the build');
    console.log('  NO_SOURCE_MAPS        no .map files that could carry the original modules');
    console.log(`  NO_OUTLINE_PROSE      none of ${prose.size} titles or intro passages present`);
    console.log(`  NO_OUTLINE_DIVISIONS  none of ${divisions.size} verse-span divisions present`);
    console.log('\nThis build is publishable.');
    return;
  }

  // Under `full` the compilation is supposed to be there. Assert that too, so a
  // silently empty dataset cannot masquerade as a clean refs-only build.
  // Erosion of the probe set is a defect regardless of which profile was built:
  // the gate's strength does not depend on what this particular run produced.
  if (erosion.length > 0) {
    console.error('FAILED — PROBE_SET_INTACT: the gate has weakened.\n');
    for (const failure of erosion) console.error(`      ${failure.detail}`);
    console.error('\nRe-run with --accept-smaller-probe-set only if the shrink is understood and intended.');
    process.exitCode = 1;
    return;
  }

  const unread = failures.filter((failure) => failure.assertion === 'BUNDLE_WAS_READ');
  if (unread.length > 0) {
    console.error('FAILED — BUNDLE_WAS_READ: this is not a real build.\n');
    for (const failure of unread) console.error(`      ${failure.detail}`);
    process.exitCode = 1;
    return;
  }

  const forbidden = failures.filter((failure) => failure.assertion === 'NO_SOURCE_FILES');
  if (forbidden.length > 0) {
    console.error('FAILED — NO_SOURCE_FILES: source material was copied into the build.\n');
    for (const failure of forbidden) console.error(`      ${failure.detail}`);
    process.exitCode = 1;
    return;
  }
  if (proseHits.length === 0 || divisionHits.length === 0) {
    console.error('FAILED — a full build contains none of the outline compilation. Is the data missing?');
    console.error(`  prose hits: ${proseHits.length}, division hits: ${divisionHits.length}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS — full build carries the compilation (${proseHits.length} prose, ${divisionHits.length} division hits).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
