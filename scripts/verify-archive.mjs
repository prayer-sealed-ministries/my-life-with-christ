#!/usr/bin/env node
/**
 * Check an exported archive before trusting it with a journal.
 *
 * WHY THIS EXISTS
 *
 * The app reads `data/journey.json` and nothing else. It does not consult
 * MANIFEST.txt on import, so an archive whose contents were damaged after it
 * was written — a bad copy, a failing card, a sync that half-finished — still
 * parses, and still imports, without a word. Structural damage is caught
 * (the zip will not open); silent rot inside a readable zip is not.
 *
 * That is tolerable in ordinary use, where an export is written and read back
 * by the same app minutes apart. It is NOT tolerable when the archive is the
 * only copy — when a device is about to be wiped and this file is the entire
 * journal. MANIFEST.txt records a SHA-256 for every file precisely so damage
 * is detectable; this is the thing that checks it.
 *
 * Run it on the computer, against the copy you are about to rely on, BEFORE
 * anything is uninstalled. See docs/A17-MIGRATION.md.
 *
 *   node scripts/verify-archive.mjs <archive.zip>
 *
 * It prints counts and integrity only. It never prints what anyone wrote.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { unzipSync, strFromU8 } from 'fflate';

/** Paths every Journey export carries. Their absence is damage, not a variant. */
const REQUIRED = ['README.txt', 'MANIFEST.txt', 'data/journey.json', 'data/schema.json'];

/**
 * A floor. An archive with fewer hashed files than this is not a journal
 * export that lost a file — it is a different thing wearing the name, and a
 * checksum pass over three files must not read as a clean bill.
 */
export const MINIMUM_HASHED_FILES = 4;

const HASH_LINE = /^([0-9a-f]{64})\s+(\d+)\s+(.+)$/;

/**
 * Verify one archive. Returns named assertions rather than a boolean, so a
 * caller can say which thing failed and a reader can see what was examined.
 */
export function verifyArchive(bytes) {
  const problems = [];
  const fail = (assertion, detail) => problems.push({ assertion, detail });

  let files;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    return {
      ok: false,
      examined: 0,
      problems: [{ assertion: 'ARCHIVE_WAS_READ', detail: `not a readable zip: ${error.message}` }],
    };
  }

  const paths = Object.keys(files);
  for (const path of REQUIRED) {
    if (!paths.includes(path)) fail('STRUCTURE_INTACT', `missing ${path}`);
  }

  // MANIFEST.txt deliberately does not list itself — a file cannot contain its
  // own hash — so it is the one exemption when checking coverage below.
  const manifest = files['MANIFEST.txt'] ? strFromU8(files['MANIFEST.txt']) : '';
  const claimed = new Map();
  for (const line of manifest.split('\n')) {
    const match = HASH_LINE.exec(line.trim());
    if (match) claimed.set(match[3], { hash: match[1], size: Number(match[2]) });
  }

  if (claimed.size < MINIMUM_HASHED_FILES) {
    fail(
      'ARCHIVE_WAS_READ',
      `MANIFEST.txt lists ${claimed.size} hashed files, fewer than the ${MINIMUM_HASHED_FILES} every export carries`,
    );
  }

  let examined = 0;
  for (const [path, expected] of claimed) {
    const actual = files[path];
    if (!actual) {
      fail('MANIFEST_AGREES', `${path}: listed in MANIFEST.txt, absent from the archive`);
      continue;
    }
    examined += 1;
    if (actual.length !== expected.size) {
      fail('CHECKSUMS_MATCH', `${path}: size ${actual.length}, MANIFEST.txt says ${expected.size}`);
      continue;
    }
    const digest = createHash('sha256').update(actual).digest('hex');
    if (digest !== expected.hash) fail('CHECKSUMS_MATCH', `${path}: checksum does not match MANIFEST.txt`);
  }

  // A file added to the archive after the fact is damage too, and hashing only
  // what the manifest names would never see it.
  for (const path of paths) {
    if (path === 'MANIFEST.txt') continue;
    if (path.endsWith('/')) continue;
    if (!claimed.has(path)) fail('MANIFEST_AGREES', `${path}: present in the archive, not listed in MANIFEST.txt`);
  }

  let counts = null;
  if (files['data/journey.json']) {
    try {
      const record = JSON.parse(strFromU8(files['data/journey.json']));
      if (record.format !== 'journey-export') {
        fail('RECORD_READABLE', `format is ${JSON.stringify(record.format)}, not "journey-export"`);
      }
      counts = {
        format: record.format,
        version: record.version,
        entries: Array.isArray(record.entries) ? record.entries.length : 0,
        drafts: Array.isArray(record.drafts) ? record.drafts.length : 0,
      };
    } catch (error) {
      fail('RECORD_READABLE', `data/journey.json does not parse: ${error.message}`);
    }
  }

  return { ok: problems.length === 0, examined, files: paths.length, counts, problems };
}

const ASSERTIONS = [
  ['ARCHIVE_WAS_READ', 'the zip opened and MANIFEST.txt was parsed'],
  ['STRUCTURE_INTACT', 'every file a Journey export must carry is present'],
  ['MANIFEST_AGREES', 'the archive holds exactly the files MANIFEST.txt names'],
  ['CHECKSUMS_MATCH', 'every file hashes to what MANIFEST.txt recorded'],
  ['RECORD_READABLE', 'data/journey.json parses and declares the right format'],
];

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node scripts/verify-archive.mjs <archive.zip>');
    process.exit(2);
  }

  const result = verifyArchive(readFileSync(path));

  console.log(`\nVerifying ${path}`);
  if (result.counts) {
    console.log(
      `  ${result.files} files · ${result.counts.format} v${result.counts.version} · ` +
        `${result.counts.entries} entries · ${result.counts.drafts} drafts`,
    );
  }
  console.log(`  ${result.examined} files hashed and compared\n`);

  const failed = new Set(result.problems.map((problem) => problem.assertion));

  // When the zip would not open, nothing downstream ran. Printing "ok" for the
  // rest would report a clean result for checks that examined nothing, which
  // is the exact failure this whole script exists to prevent elsewhere.
  const unreached = failed.has('ARCHIVE_WAS_READ') && result.examined === 0;

  console.log(result.ok ? 'PASS' : 'FAIL');
  for (const [name, meaning] of ASSERTIONS) {
    const mark = failed.has(name) ? 'FAIL' : unreached ? '   -' : 'ok  ';
    console.log(`  ${mark}  ${name.padEnd(17)} ${unreached && !failed.has(name) ? 'not reached' : meaning}`);
  }

  if (!result.ok) {
    console.log('');
    for (const problem of result.problems) console.log(`  ${problem.assertion}: ${problem.detail}`);
    console.log('\nDo not rely on this archive as the only copy of a journal.\n');
    process.exit(1);
  }

  console.log('\nThis archive matches its own manifest.\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
