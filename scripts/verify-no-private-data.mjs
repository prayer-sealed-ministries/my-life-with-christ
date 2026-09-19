#!/usr/bin/env node
/**
 * Fail closed if licensed or private source material is tracked in this repo.
 *
 * This repository is intended to be publishable. The one irreversible mistake
 * available here is committing third-party material that was licensed to one
 * purchaser for private use — see DATA-LICENSE.md. `.gitignore` makes that
 * hard; this makes it loud, and it runs before anything is built, published or
 * uploaded.
 *
 * WHY IT LOOKS AT CONTENT AND NOT ONLY AT PATHS
 *
 * The audit that produced this script found licensed titles in four tracked
 * files, and only two of them were the obvious ones. The rest were TEST
 * FIXTURES — a parser test and a view test that had quoted real titles as
 * sample data years earlier. A path-only guard would have reported a clean
 * repository with the material still in it, which is the failure mode this
 * whole file exists to prevent.
 *
 * WHY THE SENTINELS ARE SO SHORT
 *
 * A guard that embedded a large excerpt of the licensed work in order to
 * detect the licensed work would be republishing it to detect it. The list
 * below is the minimum distinctive wording needed to recognise an accidental
 * re-import, and no more.
 *
 * AND WHY IT ALSO READS COMMIT MESSAGES
 *
 * The first version checked tracked content only. It was clean while thirty-one
 * commit messages still carried an agent session URL, three named a physical
 * test phone by serial, one held a developer's home directory, and one
 * described ingesting the licensed source by name — none of which is a file.
 * Sanitizing blobs and paths does not touch commit metadata, and metadata is
 * just as visible the moment a repository goes public.
 *
 * FLOORS
 *
 * Every check here is shaped as "collect problems, assert the list is empty",
 * which passes trivially when the collection step yields nothing. So it also
 * asserts what it looked at: a run that examined no files, no commits, or no
 * sentinels fails as loudly as a run that found material.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

import { LICENSED_SENTINELS } from './lib/licensed-sentinels.mjs';

/** Paths that must never be tracked again. Matched exactly, or as a prefix. */
const FORBIDDEN_PATHS = [
  'src/data/outlines.json',
  'src/data/title-overrides.json',
  'src/data/reference-overrides.json',
  'data/ingest-report.md',
  'data/coverage-report.md',
  'data/coverage-comparison.md',
  'scripts/probe-baseline.json',
  'scripts/ingest-outlines.mjs',
  'scripts/lib/parse-outlines.mjs',
  'scripts/compare-coverage.mjs',
  'scripts/build-coverage-report.mjs',
];

/** Prefixes under which nothing licensed may appear. */
const FORBIDDEN_PREFIXES = ['data/source/Purchased_', 'private/', 'data/private/'];

/**
 * A tracked PDF under data/source/ is licensed material by construction: the
 * only source documents this project reads from there are the BSB's USFM
 * files, which are plain text.
 */
const FORBIDDEN_PATTERNS = [/^data\/source\/.*\.pdf$/i];

/** Distinctive wording from the licensed compilation. One shared list. */
const SENTINELS = LICENSED_SENTINELS;

/** Files that may legitimately name the licensed work in order to exclude it. */
const ALLOWED_TO_MENTION = new Set([
  'DATA-LICENSE.md',
  'CLAUDE.md',
  'README.md',
  '.gitignore',
  'scripts/verify-no-private-data.mjs',
  'scripts/lib/licensed-sentinels.mjs',
  'scripts/__tests__/no-private-data.test.mjs',
]);

/**
 * Patterns that must never appear in a commit message.
 *
 * Deliberately narrower than the file scan. A commit message is prose about
 * the work, so it may legitimately discuss licensing policy; what it may not
 * do is name the licensed source, quote a local path, identify a physical
 * device, or carry an agent session URL.
 */
const MESSAGE_PATTERNS = [
  { pattern: /Claude-Session:/i, why: 'an agent session trailer' },
  { pattern: /claude\.ai\/code\/session/i, why: 'an agent session URL' },
  { pattern: /\/Users\//, why: 'a home-directory path' },
  { pattern: /\/private\/tmp\//, why: 'a local temporary path' },
  { pattern: /\bpurchased\b/i, why: 'wording that identifies a licensed source' },
  { pattern: /R5GL[A-Z0-9]{6,}/, why: 'a physical device serial' },
];

/** Binary-ish files are read as bytes; searching them for text is still valid. */
const MAX_SCAN_BYTES = 8 * 1024 * 1024;

/**
 * Commit messages to examine.
 *
 * Every commit reachable from a LOCAL branch or tag — the history this
 * repository would publish. Deliberately not `--all`: that also walks
 * remote-tracking refs, which are a cache of what a remote currently holds.
 * Those are exactly the commits a sanitizing force-push exists to replace, and
 * scanning them makes the guard refuse the push that would fix them.
 *
 * A caller may pass an explicit range instead.
 */
function commitMessages(range) {
  const args = ['log', '--format=%H%x00%B%x01'];
  if (range && range !== 'all') args.push(range);
  else args.push('--branches', '--tags');
  let out;
  try {
    out = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  } catch {
    return [];
  }
  return out
    .split('\u0001')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha, ...rest] = entry.split('\u0000');
      return { sha: sha.trim().slice(0, 9), body: rest.join('') };
    });
}

function tracked() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return out.split('\0').filter(Boolean);
}

function main() {
  const files = tracked();
  const problems = [];

  // 1. Paths -----------------------------------------------------------------
  let pathsChecked = 0;
  for (const file of files) {
    pathsChecked += 1;
    if (FORBIDDEN_PATHS.includes(file)) {
      problems.push(`TRACKED FORBIDDEN PATH: ${file}`);
    }
    if (FORBIDDEN_PREFIXES.some((prefix) => file.startsWith(prefix))) {
      problems.push(`TRACKED PRIVATE LOCATION: ${file}`);
    }
    if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(file))) {
      problems.push(`TRACKED LICENSED DOCUMENT: ${file}`);
    }
  }

  // 2. Content ---------------------------------------------------------------
  let filesScanned = 0;
  let bytesScanned = 0;
  const sentinelsSeen = new Set();

  for (const file of files) {
    if (ALLOWED_TO_MENTION.has(file)) continue;
    let size;
    try {
      size = statSync(file).size;
    } catch {
      continue; // staged-but-absent; the path checks above still covered it
    }
    if (size > MAX_SCAN_BYTES) continue;

    let text;
    try {
      text = readFileSync(file, 'latin1');
    } catch {
      continue;
    }
    filesScanned += 1;
    bytesScanned += size;

    for (const sentinel of SENTINELS) {
      if (text.includes(sentinel)) {
        sentinelsSeen.add(sentinel);
        problems.push(`LICENSED CONTENT in ${file}: "${sentinel}"`);
      }
    }
  }

  // 3. Commit messages -------------------------------------------------------
  const range = process.argv[2];
  const commits = commitMessages(range);
  for (const commit of commits) {
    for (const { pattern, why } of MESSAGE_PATTERNS) {
      if (pattern.test(commit.body)) {
        problems.push(`COMMIT MESSAGE ${commit.sha} contains ${why}`);
      }
    }
  }

  // 4. Floors ----------------------------------------------------------------
  //
  // Without these the whole script passes when `git ls-files` returns nothing,
  // when every file is skipped, or when the sentinel list is emptied by an
  // edit — three ways to get a green result having looked at nothing.
  const floors = [];
  if (pathsChecked < 100) floors.push(`only ${pathsChecked} tracked paths examined (expected >= 100)`);
  if (filesScanned < 100) floors.push(`only ${filesScanned} files scanned (expected >= 100)`);
  if (bytesScanned < 1_000_000) floors.push(`only ${bytesScanned} bytes scanned (expected >= 1,000,000)`);
  if (SENTINELS.length < 3) floors.push(`only ${SENTINELS.length} sentinels defined (expected >= 3)`);
  if (FORBIDDEN_PATHS.length < 5) floors.push(`only ${FORBIDDEN_PATHS.length} forbidden paths defined`);
  if (MESSAGE_PATTERNS.length < 4) floors.push(`only ${MESSAGE_PATTERNS.length} message patterns defined`);
  // A range that selects nothing is a scan that read no messages. On a push of
  // already-pushed commits that is legitimate; with no range at all it means
  // `git log` returned nothing, and the whole message check examined zero.
  if (!range && commits.length < 10) {
    floors.push(`only ${commits.length} commit messages read (expected >= 10 with no range given)`);
  }

  // 4. Report ----------------------------------------------------------------
  console.log('Checking that no licensed or private source data is tracked.');
  console.log(`  ${pathsChecked} tracked paths, ${filesScanned} files, ${(bytesScanned / 1024 / 1024).toFixed(1)}MB scanned`);
  console.log(`  ${commits.length} commit message(s) read${range ? ` (range: ${range})` : ''}`);
  console.log(`  ${FORBIDDEN_PATHS.length} forbidden paths, ${FORBIDDEN_PREFIXES.length} private prefixes, ${SENTINELS.length} content sentinels`);

  if (floors.length > 0) {
    console.error('\nNULL MEASUREMENT — this check examined too little to mean anything:');
    for (const floor of floors) console.error(`  ${floor}`);
    process.exit(2);
  }

  if (problems.length > 0) {
    console.error(`\nFAIL — licensed or private material is tracked (${problems.length}):\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('\nThis repository must not be published in this state.');
    console.error('See DATA-LICENSE.md. Remove the material and the history that carries it.');
    process.exit(1);
  }

  console.log('\nPASS');
  console.log('  NO_FORBIDDEN_PATHS      no licensed path or private location is tracked');
  console.log('  NO_LICENSED_CONTENT     no sentinel appears in any tracked file');
  console.log('  NO_PRIVATE_IN_MESSAGES  no commit message names a source, path, device or session');
  console.log('  EXAMINED_ENOUGH         the scan covered the repository, not a corner of it');
  console.log('\nNo licensed or private source data is tracked.');
}

main();
