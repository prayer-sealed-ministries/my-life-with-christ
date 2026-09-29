import { createHash } from 'node:crypto';

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { MINIMUM_HASHED_FILES, verifyArchive } from '../verify-archive.mjs';
import { buildArchive } from '../../src/export/archive';
import { ALL_ENTRIES } from '../../src/export/fixtures';
import outlines from '../../src/data/sections.json';
import topicsFile from '../../src/data/topics.json';

/**
 * Proof that the archive checker can fail.
 *
 * The app does not verify MANIFEST.txt on import, so this script is the only
 * thing standing between a damaged archive and a journal restored from it. A
 * checker that cannot distinguish a damaged archive from a sound one would be
 * worse than none, because the procedure in docs/A17-MIGRATION.md tells a
 * person to wipe a phone once it passes.
 *
 * So every assertion is proved twice: sound archive passes, damaged archive
 * fails on that named assertion.
 */

const NOW = new Date('2026-09-13T12:00:00.000Z');

async function soundArchive() {
  const built = await buildArchive({
    entries: ALL_ENTRIES,
    drafts: [
      {
        id: 'draft-1',
        entryId: null,
        createdAt: '2026-09-13T11:00:00.000Z',
        updatedAt: '2026-09-13T11:30:00.000Z',
        entry: { kind: 'sermon', notes: 'unfinished' },
      },
    ],
    outlineBooks: outlines,
    topics: topicsFile.topics,
    profile: 'public',
    now: NOW,
  });
  return built.bytes;
}

/** Re-zip an archive after `mutate` has had a go at its files. */
function rebuild(bytes, mutate) {
  const files = unzipSync(bytes);
  mutate(files);
  return zipSync(files);
}

const failedAssertions = (result) => new Set(result.problems.map((problem) => problem.assertion));

describe('verify-archive', () => {
  it('passes a sound archive, and says what it examined', async () => {
    const result = verifyArchive(await soundArchive());

    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    // The floor: a pass is only meaningful if it hashed the whole archive.
    expect(result.examined).toBeGreaterThanOrEqual(MINIMUM_HASHED_FILES);
    expect(result.examined).toBe(result.files - 1); // every file but MANIFEST.txt
    expect(result.counts).toMatchObject({
      format: 'journey-export',
      entries: ALL_ENTRIES.length,
      drafts: 1,
    });
  });

  it('fails CHECKSUMS_MATCH when bytes change but the size does not', async () => {
    // Two things this mutation must avoid, or it proves nothing about hashing:
    // changing the length (the size comparison would catch it first), and
    // touching a file something else parses (RECORD_READABLE would fire
    // instead). An earlier version of this test did both.
    let before;
    let after;
    const damaged = rebuild(await soundArchive(), (files) => {
      const text = strFromU8(files['README.txt']);
      const at = text.indexOf('journal');
      expect(at, 'README.txt must carry the word this mutation flips').toBeGreaterThan(-1);
      before = files['README.txt'].length;
      const replacement = strToU8(`${text.slice(0, at)}JOURNAL${text.slice(at + 7)}`);
      after = replacement.length;
      files['README.txt'] = replacement;
    });

    expect(after, 'the mutation must preserve length').toBe(before);

    const result = verifyArchive(damaged);

    expect(result.ok).toBe(false);
    // Nothing but the hash can see this: same length, and no other check reads
    // README.txt at all.
    expect(failedAssertions(result)).toEqual(new Set(['CHECKSUMS_MATCH']));
    // The damage this exists to catch: still a valid zip, still valid JSON,
    // still imports into the app without a word.
    expect(result.counts.format).toBe('journey-export');
  });

  it('fails CHECKSUMS_MATCH when a file has grown or shrunk', async () => {
    const damaged = rebuild(await soundArchive(), (files) => {
      files['data/entries.csv'] = strToU8(`${strFromU8(files['data/entries.csv'])}\nextra,row\n`);
    });

    const result = verifyArchive(damaged);

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('CHECKSUMS_MATCH');
  });

  it('fails ARCHIVE_WAS_READ when the file is truncated', async () => {
    const bytes = await soundArchive();
    const result = verifyArchive(bytes.slice(0, Math.floor(bytes.length / 2)));

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('ARCHIVE_WAS_READ');
    expect(result.examined).toBe(0);
  });

  it('fails STRUCTURE_INTACT when a required file is gone', async () => {
    const damaged = rebuild(await soundArchive(), (files) => {
      delete files['data/schema.json'];
    });

    const result = verifyArchive(damaged);

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('STRUCTURE_INTACT');
  });

  it('fails MANIFEST_AGREES when a file is added after the manifest was written', async () => {
    const damaged = rebuild(await soundArchive(), (files) => {
      files['notes/planted.md'] = strToU8('# not written by the export\n');
    });

    const result = verifyArchive(damaged);

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('MANIFEST_AGREES');
  });

  it('fails MANIFEST_AGREES when a listed file has been removed', async () => {
    const damaged = rebuild(await soundArchive(), (files) => {
      delete files['data/entries.csv'];
    });

    const result = verifyArchive(damaged);

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('MANIFEST_AGREES');
  });

  it('fails RECORD_READABLE when the canonical record is not a Journey export', async () => {
    const damaged = rebuild(await soundArchive(), (files) => {
      const replacement = strToU8(JSON.stringify({ format: 'something-else', entries: [] }));
      files['data/journey.json'] = replacement;

      // Keep MANIFEST.txt honest about this file, so RECORD_READABLE is what
      // fails and not merely the checksum riding along with it.
      const digest = createHash('sha256').update(replacement).digest('hex');
      const rewritten = strFromU8(files['MANIFEST.txt'])
        .split('\n')
        .map((line) =>
          line.endsWith('  data/journey.json')
            ? `${digest}  ${String(replacement.length).padStart(9)}  data/journey.json`
            : line,
        );
      files['MANIFEST.txt'] = strToU8(rewritten.join('\n'));
    });

    const result = verifyArchive(damaged);

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('RECORD_READABLE');
  });

  it('fails ARCHIVE_WAS_READ when the manifest hashes almost nothing', async () => {
    const damaged = rebuild(await soundArchive(), (files) => {
      // A manifest stripped to a couple of lines would otherwise "pass" every
      // checksum it claims, having checked next to nothing.
      const lines = strFromU8(files['MANIFEST.txt']).split('\n');
      const hashes = lines.filter((line) => /^[0-9a-f]{64}\s/.test(line));
      const prose = lines.filter((line) => !/^[0-9a-f]{64}\s/.test(line));
      files['MANIFEST.txt'] = strToU8([...prose, hashes[0]].join('\n'));
    });

    const result = verifyArchive(damaged);

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('ARCHIVE_WAS_READ');
  });
});
