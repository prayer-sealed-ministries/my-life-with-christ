#!/usr/bin/env node
/**
 * Check an exported archive before trusting it with a journal.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE APP
 *
 * The app verifies an archive against its own MANIFEST.txt before restoring
 * it — `src/export/importer.ts` refuses anything that does not match. This
 * script answers the same question from outside the app, on a computer, which
 * is what you want before a device is wiped and the archive becomes the only
 * copy. If the phone is about to be erased, "the app said it was fine" and
 * "the file is fine" should be two separate observations.
 *
 * So the check is deliberately not a second IMPLEMENTATION. The manifest
 * grammar, the rules and the hashing come from src/export/manifest.mjs — the
 * same module the product uses, which is why that module is plain JavaScript.
 * What differs here is only the ZIP reader: this one uses fflate rather than
 * the app's own, so a bug in either decoder cannot hide from both.
 *
 *   npm run verify:archive -- <archive.zip>
 *
 * It prints counts and integrity only. It never prints what anyone wrote.
 */

import { readFileSync } from 'node:fs';

import { unzipSync } from 'fflate';

import {
  CANONICAL_PATH,
  MINIMUM_HASHED_FILES,
  verifyArchiveManifest,
} from '../src/export/manifest.mjs';

export { MINIMUM_HASHED_FILES };

/**
 * Verify one archive's bytes.
 *
 * @param {Uint8Array} bytes
 */
export async function verifyArchive(bytes) {
  /** @type {{ path: string, bytes: Uint8Array }[]} */
  let files;
  try {
    const unzipped = unzipSync(bytes);
    files = Object.entries(unzipped).map(([path, content]) => ({ path, bytes: content }));
  } catch (error) {
    return {
      ok: false,
      examined: 0,
      files: 0,
      counts: null,
      problems: [
        {
          assertion: 'ARCHIVE_WAS_READ',
          detail: `not a readable zip: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const result = await verifyArchiveManifest(files);
  const problems = [...result.problems];

  // Reported for the operator's benefit, and only once the manifest has
  // vouched for these bytes. Before that they are not a record, and counting
  // entries out of an unverified file would be reading the furniture.
  let counts = null;
  const canonical = files.find((file) => file.path === CANONICAL_PATH);
  if (result.ok && canonical) {
    try {
      const record = JSON.parse(new TextDecoder().decode(canonical.bytes));
      if (record.format !== 'journey-export') {
        problems.push({
          assertion: 'RECORD_READABLE',
          detail: `format is ${JSON.stringify(record.format)}, not "journey-export"`,
        });
      }
      counts = {
        format: record.format,
        version: record.version,
        entries: Array.isArray(record.entries) ? record.entries.length : 0,
        drafts: Array.isArray(record.drafts) ? record.drafts.length : 0,
      };
    } catch (error) {
      problems.push({
        assertion: 'RECORD_READABLE',
        detail: `${CANONICAL_PATH} does not parse: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return {
    ok: problems.length === 0,
    examined: result.examined,
    files: files.length,
    counts,
    problems,
  };
}

const ASSERTIONS = [
  ['ARCHIVE_WAS_READ', 'the zip opened and MANIFEST.txt was parsed'],
  ['STRUCTURE_INTACT', 'every file a Journey export must carry is present'],
  ['MANIFEST_AGREES', 'the archive holds exactly the files MANIFEST.txt names'],
  ['CHECKSUMS_MATCH', 'every file hashes to what MANIFEST.txt recorded'],
  ['RECORD_READABLE', 'data/journey.json parses and declares the right format'],
];

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: npm run verify:archive -- <archive.zip>');
    process.exit(2);
  }

  const result = await verifyArchive(readFileSync(path));

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

if (import.meta.url === `file://${process.argv[1]}`) await main();
