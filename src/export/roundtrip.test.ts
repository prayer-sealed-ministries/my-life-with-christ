import { beforeEach, describe, expect, it } from 'vitest';

import { DexieStorageProvider } from '../storage/db';
import { buildArchive, buildContext, buildJourneyJson, matchesFilter } from './archive';
import { applyImport, parseImport, previewImport } from './importer';
import { readZip, zipEntryText } from './zip';
import { ALL_ENTRIES, AWKWARD, COLLIDER_A, COLLIDER_B, READING, SERMON } from './fixtures';
import { examinedAtLeast } from '../testing/floor';
import outlines from '../data/outlines.json';
import topicsFile from '../data/topics.json';
import type { Entry, OutlineBook, Topic } from '../types';

const outlineBooks = outlines as unknown as OutlineBook[];
const topics = topicsFile.topics as Topic[];
const NOW = new Date('2026-09-13T12:00:00.000Z');

const archiveOptions = (entries: Entry[], overrides = {}) => ({
  entries,
  outlineBooks,
  topics,
  profile: 'full' as const,
  now: NOW,
  ...overrides,
});

const byId = (entries: Entry[]) => [...entries].sort((a, b) => a.id.localeCompare(b.id));

let db: DexieStorageProvider;
let counter = 0;

beforeEach(async () => {
  // A fresh database per test, so wiping one cannot affect another.
  counter += 1;
  db = new DexieStorageProvider(`journey-test-${counter}`);
  await db.open();
});

describe('round trip', () => {
  // The acceptance test the whole export exists to satisfy.
  it('export -> wipe the database -> import reproduces every entry exactly', async () => {
    await db.putEntries(ALL_ENTRIES);
    const before = byId(await db.listEntries());
    expect(before).toHaveLength(5);

    const archive = await buildArchive(archiveOptions(before));

    await db.clearEntries();
    expect(await db.listEntries()).toHaveLength(0);

    const parsed = await parseImport(archive.bytes);
    await applyImport(parsed, db, 'merge');

    const after = byId(await db.listEntries());
    // toEqual([], []) is a pass. Assert something came back before comparing.
    examinedAtLeast(after.length, ALL_ENTRIES.length, 'entries restored from the archive');
    expect(after).toEqual(before);
  });

  it('round-trips a bare journey.json too, not only the archive', async () => {
    const ctx = await buildContext(archiveOptions(ALL_ENTRIES));
    const json = JSON.stringify(buildJourneyJson(ctx));

    const parsed = await parseImport(json);
    await applyImport(parsed, db, 'merge');

    const restored = byId(await db.listEntries());
    examinedAtLeast(restored.length, ALL_ENTRIES.length, 'entries restored from journey.json');
    expect(restored).toEqual(byId(ALL_ENTRIES));
  });

  it('preserves unicode, markdown and newlines verbatim', async () => {
    await db.putEntries([AWKWARD]);
    const archive = await buildArchive(archiveOptions([AWKWARD]));
    await db.clearEntries();

    const parsed = await parseImport(archive.bytes);
    await applyImport(parsed, db, 'merge');

    const [restored] = await db.listEntries();
    expect(restored.reflection).toBe(AWKWARD.reflection);
    expect(restored.title).toBe('??? — !!!');
  });

  it('keeps notes and reflection separate through the whole trip', async () => {
    await db.putEntries([SERMON]);
    const archive = await buildArchive(archiveOptions([SERMON]));
    await db.clearEntries();
    await applyImport(await parseImport(archive.bytes), db, 'merge');

    const [restored] = await db.listEntries();
    expect(restored.notes).toBe(SERMON.notes);
    expect(restored.reflection).toBe(SERMON.reflection);
    expect(restored.notes).not.toContain(SERMON.reflection);
  });
});

describe('the archive itself', () => {
  it('contains every file the spec calls for', async () => {
    const archive = await buildArchive(archiveOptions(ALL_ENTRIES));
    const paths = archive.paths;
    examinedAtLeast(paths.length, 12, 'files in the archive');
    examinedAtLeast(archive.bytes.length, 5_000, 'bytes in the archive');

    for (const required of [
      'README.txt',
      'MANIFEST.txt',
      'data/journey.json',
      'data/schema.json',
      'data/entries.csv',
      'book/my-journey-with-God.html',
      'indexes/by-date.md',
      'indexes/by-book.md',
      'indexes/by-topic.md',
      'indexes/by-speaker.md',
      'indexes/by-place.md',
      'indexes/for-descendants.md',
    ]) {
      expect(paths, required).toContain(required);
    }

    expect(paths.filter((path) => path.startsWith('notes/'))).toHaveLength(5);
  });

  it('is a real zip that reads back byte-identically', async () => {
    const archive = await buildArchive(archiveOptions(ALL_ENTRIES));
    const files = await readZip(archive.bytes);
    expect(files.map((file) => file.path).sort()).toEqual([...archive.paths].sort());

    const journey = files.find((file) => file.path === 'data/journey.json')!;
    const parsed = JSON.parse(zipEntryText(journey));
    expect(parsed.format).toBe('journey-export');
    expect(parsed.entries).toHaveLength(5);
  });

  it('names note files by event date, sortably, and breaks collisions', async () => {
    const ctx = await buildContext(archiveOptions([COLLIDER_A, COLLIDER_B]));
    const names = [...ctx.noteFilenames.values()];
    expect(names).toEqual(['notes/2026-05-05--reading--morning.md', 'notes/2026-05-05--reading--morning-2.md']);
  });

  it('gives an unnamed entry an ASCII-safe filename', async () => {
    const ctx = await buildContext(archiveOptions([AWKWARD]));
    const name = ctx.noteFilenames.get(AWKWARD.id)!;
    expect(name).toBe('notes/2026-01-01--prayer--untitled.md');
    expect(name).toMatch(/^[\x20-\x7e]+$/);
  });

  it('hashes every file in the manifest except itself', async () => {
    const archive = await buildArchive(archiveOptions(ALL_ENTRIES));
    const files = await readZip(archive.bytes);
    const manifest = zipEntryText(files.find((file) => file.path === 'MANIFEST.txt')!);

    for (const path of archive.paths) {
      if (path === 'MANIFEST.txt') {
        expect(manifest.split('\n').filter((line) => line.endsWith('  MANIFEST.txt'))).toHaveLength(0);
        continue;
      }
      expect(manifest, path).toContain(path);
    }
    expect(manifest).toMatch(/[0-9a-f]{64}/);
  });
});

describe('selective export', () => {
  it('writes EXPORT-NOTE.txt saying what was left out', async () => {
    const filter = { forDescendantsOnly: true };
    const kept = ALL_ENTRIES.filter((entry) => matchesFilter(entry, filter));
    expect(kept).toHaveLength(1);

    const archive = await buildArchive(
      archiveOptions(kept, { filter, allEntries: ALL_ENTRIES }),
    );
    expect(archive.paths).toContain('EXPORT-NOTE.txt');
    expect(archive.excludedCount).toBe(4);

    const files = await readZip(archive.bytes);
    const note = zipEntryText(files.find((file) => file.path === 'EXPORT-NOTE.txt')!);
    expect(note).toMatch(/4/);
  });

  it('omits EXPORT-NOTE.txt from a complete export', async () => {
    const archive = await buildArchive(archiveOptions(ALL_ENTRIES));
    expect(archive.paths).not.toContain('EXPORT-NOTE.txt');
  });

  it('filters by date range, book, topic and kind', () => {
    expect(matchesFilter(SERMON, { from: '2026-03-01', to: '2026-03-31' })).toBe(true);
    expect(matchesFilter(READING, { from: '2026-03-01', to: '2026-03-31' })).toBe(false);
    expect(matchesFilter(SERMON, { books: ['matthew'] })).toBe(true);
    expect(matchesFilter(SERMON, { books: ['genesis'] })).toBe(false);
    expect(matchesFilter(SERMON, { topics: ['humility'] })).toBe(true);
    expect(matchesFilter(SERMON, { kinds: ['reading'] })).toBe(false);
  });
});

describe('import safety', () => {
  it('previews counts and conflicts before writing anything', async () => {
    await db.putEntries([SERMON]);
    const archive = await buildArchive(archiveOptions([{ ...SERMON, title: 'Edited', updatedAt: '2026-09-01T00:00:00.000Z' }, READING]));
    const parsed = await parseImport(archive.bytes);

    const preview = previewImport(parsed, await db.listEntries(), 'merge');
    expect(preview.incoming).toBe(2);
    expect(preview.newEntries).toBe(1);
    expect(preview.updated).toBe(1);
    expect(preview.conflicts).toHaveLength(1);

    // Nothing written yet.
    expect(await db.listEntries()).toHaveLength(1);
  });

  it('merges with the newest updatedAt winning', async () => {
    await db.putEntries([{ ...SERMON, title: 'Mine', updatedAt: '2026-09-10T00:00:00.000Z' }]);
    const archive = await buildArchive(archiveOptions([{ ...SERMON, title: 'Theirs', updatedAt: '2026-09-11T00:00:00.000Z' }]));
    await applyImport(await parseImport(archive.bytes), db, 'merge');

    const [entry] = await db.listEntries();
    expect(entry.title).toBe('Theirs');
  });

  it('keeps the local copy when it is newer', async () => {
    await db.putEntries([{ ...SERMON, title: 'Mine', updatedAt: '2026-09-12T00:00:00.000Z' }]);
    const archive = await buildArchive(archiveOptions([{ ...SERMON, title: 'Theirs', updatedAt: '2026-09-11T00:00:00.000Z' }]));
    await applyImport(await parseImport(archive.bytes), db, 'merge');

    const [entry] = await db.listEntries();
    expect(entry.title).toBe('Mine');
  });

  it('replace mode clears first, and warns that it will', async () => {
    await db.putEntries([SERMON, READING]);
    const archive = await buildArchive(archiveOptions([AWKWARD]));
    const parsed = await parseImport(archive.bytes);

    const preview = previewImport(parsed, await db.listEntries(), 'replace');
    expect(preview.warnings.join(' ')).toMatch(/delete all 2/);

    await applyImport(parsed, db, 'replace');
    const after = await db.listEntries();
    expect(after.map((entry) => entry.id)).toEqual([AWKWARD.id]);
  });

  it('refuses a file that is not a journal, with a readable message', async () => {
    await expect(parseImport('{"nope":true}')).rejects.toThrow(/does not contain a journal/);
    await expect(parseImport('not json at all')).rejects.toThrow(/not valid JSON/);
  });
});
