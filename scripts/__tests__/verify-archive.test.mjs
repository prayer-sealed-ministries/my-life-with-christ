import { createHash } from 'node:crypto';

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { MINIMUM_HASHED_FILES, verifyArchive } from '../verify-archive.mjs';
import { buildArchive } from '../../src/export/archive';
import { parseImport } from '../../src/export/importer';
import { ALL_ENTRIES } from '../../src/export/fixtures';
import outlines from '../../src/data/sections.json';
import topicsFile from '../../src/data/topics.json';

/**
 * Proof that the archive checker can fail.
 *
 * The app verifies an archive against its manifest before restoring it. This
 * script asks the same question from outside the app, which is what the A17
 * migration procedure relies on: before a phone is wiped, "the file is sound"
 * should be an observation someone can make without the app's word for it.
 *
 * A checker that cannot distinguish a damaged archive from a sound one would
 * be worse than none, because docs/A17-MIGRATION.md tells a person to go ahead
 * and uninstall once it passes. So every assertion is proved twice: a sound
 * archive passes, and a damaged one fails on that named assertion.
 */

const NOW = new Date('2026-09-13T12:00:00.000Z');

async function soundArchive() {
  const built = await buildArchive({
    entries: ALL_ENTRIES,
    drafts: [
      {
        id: 'draft-1',
        createdAt: '2026-09-13T11:00:00.000Z',
        updatedAt: '2026-09-13T11:30:00.000Z',
        form: {
          kind: 'sermon',
          title: '',
          date: '2026-09-13',
          place: '',
          speaker: '',
          sermonSeries: '',
          notes: 'unfinished',
          reflection: '',
          prayer: '',
          tagsText: '',
          links: [],
          anchors: [],
          forDescendants: false,
          scriptureRefs: [],
          sourceMaterial: null,
        },
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
    const result = await verifyArchive(await soundArchive());

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

    const result = await verifyArchive(damaged);

    expect(result.ok).toBe(false);
    // Nothing but the hash can see this: same length, and no other check reads
    // README.txt at all.
    expect(failedAssertions(result)).toEqual(new Set(['CHECKSUMS_MATCH']));

    // The damage this exists to catch: the zip still opened and every file is
    // still there. Before the manifest was consulted, this imported silently.
    expect(result.files).toBeGreaterThanOrEqual(MINIMUM_HASHED_FILES);
    // And nothing was read out of it — counts come only from a verified
    // archive, so an unverified one reports none.
    expect(result.counts).toBeNull();
  });

  it('fails CHECKSUMS_MATCH when a file has grown or shrunk', async () => {
    const damaged = rebuild(await soundArchive(), (files) => {
      files['data/entries.csv'] = strToU8(`${strFromU8(files['data/entries.csv'])}\nextra,row\n`);
    });

    const result = await verifyArchive(damaged);

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('CHECKSUMS_MATCH');
  });

  it('fails ARCHIVE_WAS_READ when the file is truncated', async () => {
    const bytes = await soundArchive();
    const result = await verifyArchive(bytes.slice(0, Math.floor(bytes.length / 2)));

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('ARCHIVE_WAS_READ');
    expect(result.examined).toBe(0);
  });

  it('fails STRUCTURE_INTACT when a required file is gone', async () => {
    const damaged = rebuild(await soundArchive(), (files) => {
      delete files['data/schema.json'];
    });

    const result = await verifyArchive(damaged);

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('STRUCTURE_INTACT');
  });

  it('fails MANIFEST_AGREES when a file is added after the manifest was written', async () => {
    const damaged = rebuild(await soundArchive(), (files) => {
      files['notes/planted.md'] = strToU8('# not written by the export\n');
    });

    const result = await verifyArchive(damaged);

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('MANIFEST_AGREES');
  });

  it('fails MANIFEST_AGREES when a listed file has been removed', async () => {
    const damaged = rebuild(await soundArchive(), (files) => {
      delete files['data/entries.csv'];
    });

    const result = await verifyArchive(damaged);

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

    const result = await verifyArchive(damaged);

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

    const result = await verifyArchive(damaged);

    expect(result.ok).toBe(false);
    expect(failedAssertions(result)).toContain('ARCHIVE_WAS_READ');
  });
});

/**
 * Parity with the product's own restore check.
 *
 * The two share the manifest grammar and the hashing — that is the whole
 * reason src/export/manifest.mjs is plain JavaScript — but they use different
 * ZIP readers on purpose, so that a bug in either decoder cannot hide from
 * both. Different readers are only useful if their verdicts still agree, which
 * is what this asserts.
 *
 * It is also the check that would catch the two drifting apart later: the CLI
 * is what the A17 migration procedure tells a person to run before wiping a
 * phone, and "the CLI passed it" has to mean "the app will accept it".
 */
describe('parity between the CLI and the product', () => {
  /** @type {{ name: string, damage: (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array> }[]} */
  const cases = [
    { name: 'a sound archive', damage: (bytes) => bytes },
    {
      name: 'a wrong hash at the right size',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          const text = strFromU8(files['README.txt']);
          const at = text.indexOf('journal');
          files['README.txt'] = strToU8(`${text.slice(0, at)}JOURNAL${text.slice(at + 7)}`);
        }),
    },
    {
      name: 'a wrong size',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          files['data/entries.csv'] = strToU8(`${strFromU8(files['data/entries.csv'])}\nextra,row\n`);
        }),
    },
    {
      name: 'a missing listed file',
      damage: (bytes) => rebuild(bytes, (files) => void delete files['data/entries.csv']),
    },
    {
      name: 'a missing required file',
      damage: (bytes) => rebuild(bytes, (files) => void delete files['data/schema.json']),
    },
    {
      name: 'a manifest listing a path twice',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          const lines = strFromU8(files['MANIFEST.txt']).split('\n');
          const line = lines.find((one) => one.endsWith('  data/schema.json'));
          files['MANIFEST.txt'] = strToU8([...lines, line].join('\n'));
        }),
    },
    {
      name: 'a malformed manifest that hashes almost nothing',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          const lines = strFromU8(files['MANIFEST.txt']).split('\n');
          const hashes = lines.filter((line) => /^[0-9a-f]{64}\s/.test(line));
          const prose = lines.filter((line) => !/^[0-9a-f]{64}\s/.test(line));
          files['MANIFEST.txt'] = strToU8([...prose, hashes[0]].join('\n'));
        }),
    },
    {
      name: 'a corrupted draft',
      damage: (bytes) =>
        rebuild(bytes, (files) => {
          const text = strFromU8(files['data/journey.json']);
          expect(text).toContain('unfinished');
          files['data/journey.json'] = strToU8(text.replace('unfinished', 'REWRITTEN!'));
        }),
    },
    {
      name: 'a truncated zip',
      damage: (bytes) => bytes.slice(0, Math.floor(bytes.length / 2)),
    },
  ];

  // A floor: an emptied or filtered list would let this suite pass having
  // compared nothing.
  it('compares enough cases to mean something', () => {
    expect(cases.length).toBeGreaterThanOrEqual(9);
  });

  for (const { name, damage } of cases) {
    it(`agrees on ${name}`, async () => {
      const bytes = await damage(await soundArchive());

      const cli = await verifyArchive(bytes);
      const productAccepted = await parseImport(bytes).then(
        () => true,
        () => false,
      );

      expect(
        cli.ok,
        `CLI said ${cli.ok ? 'PASS' : 'FAIL'}, product said ${productAccepted ? 'accept' : 'refuse'}`,
      ).toBe(productAccepted);
    });
  }
});
