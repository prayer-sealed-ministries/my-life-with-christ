import { beforeEach, describe, expect, it } from 'vitest';

import { DexieStorageProvider } from '../storage/db';
import { buildArchive, buildContext, buildJourneyJson, matchesFilter } from './archive';
import { applyImport, parseImport, previewImport } from './importer';
import { readZip, zipEntryText } from './zip';
import { ALL_ENTRIES, AWKWARD, COLLIDER_A, COLLIDER_B, READING, SERMON } from './fixtures';
import { examinedAtLeast } from '../testing/floor';
import outlines from '../data/sections.json';
import topicsFile from '../data/topics.json';
import type { Entry, OutlineBook, Topic } from '../types';

const outlineBooks = outlines as unknown as OutlineBook[];
const topics = topicsFile.topics as Topic[];
const NOW = new Date('2026-09-13T12:00:00.000Z');

const archiveOptions = (entries: Entry[], overrides = {}) => ({
  entries,
  outlineBooks,
  topics,
  profile: 'public' as const,
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

describe('a verse, a range and a passage survive the journey unchanged', () => {
  /*
   * The three things the picker can produce, through export, a wiped database
   * and an import.
   *
   * They are one shape — a ScriptureRef with a start and an end — so this is
   * really asking whether the ends survive. An exact verse whose end were
   * dropped would come back as a whole chapter and point at the wrong forty
   * verses; a range whose end were dropped would come back as its first verse
   * alone. Both would read as plausible references, which is why the assertion
   * is on the numbers and not on whether the import succeeded.
   */
  const anchored = (id: string, book: string, cs: number, vs: number, ce: number, ve: number): Entry => ({
    ...SERMON,
    id,
    title: id,
    anchors: [{ kind: 'scripture', book, chapterStart: cs, verseStart: vs, chapterEnd: ce, verseEnd: ve }],
    scriptureRefs: [],
  });

  const CASES: Entry[] = [
    // John 3:16 — one verse.
    anchored('rt-verse', 'john', 3, 16, 3, 16),
    // John 3:16-18 — a range inside a chapter.
    anchored('rt-range', 'john', 3, 16, 3, 18),
    // Romans 8:31-39 — the range from the brief, in another book.
    anchored('rt-romans', 'romans', 8, 31, 8, 39),
    // A whole chapter, which is what an existing passage selection looks like.
    anchored('rt-passage', 'john', 3, 1, 3, 36),
    // A range that crosses a chapter break, which the model has always allowed.
    anchored('rt-cross', 'john', 3, 16, 4, 2),
  ];

  it('comes back with the same start and end verses', async () => {
    await db.putEntries(CASES);
    const before = byId(await db.listEntries());

    const archive = await buildArchive(archiveOptions(before));
    await db.clearEntries();
    const parsed = await parseImport(archive.bytes);
    await applyImport(parsed, db, 'merge');

    const after = byId(await db.listEntries());
    examinedAtLeast(after.length, CASES.length, 'references restored from the archive');
    expect(after).toEqual(before);

    // Spelled out as well as compared, so a failure says which end moved rather
    // than printing two large objects side by side.
    const ends = (entries: Entry[]) =>
      entries.map((each) => {
        const anchor = each.anchors[0];
        if (anchor.kind !== 'scripture') throw new Error(`${each.id} lost its scripture anchor`);
        return `${each.id} ${anchor.book} ${anchor.chapterStart}:${anchor.verseStart}-${anchor.chapterEnd}:${anchor.verseEnd}`;
      });
    expect(ends(after)).toEqual([
      'rt-cross john 3:16-4:2',
      'rt-passage john 3:1-3:36',
      'rt-range john 3:16-3:18',
      'rt-romans romans 8:31-8:39',
      'rt-verse john 3:16-3:16',
    ]);
  });

  it('writes them into the archive the way a person reads them', async () => {
    await db.putEntries(CASES);
    const archive = await buildArchive(archiveOptions(byId(await db.listEntries())));
    const files = await readZip(archive.bytes);

    const noteFor = (id: string) => {
      const file = files.find((each) => each.path.startsWith('notes/') && zipEntryText(each).includes(`title: ${id}`));
      if (!file) throw new Error(`no note written for ${id}`);
      return zipEntryText(file);
    };

    // "John 3:16", not "John 3:16-16" and not a start/end object. The formatter
    // collapses a range whose ends meet, which is the only place that decision
    // is made.
    expect(noteFor('rt-verse')).toContain('John 3:16');
    expect(noteFor('rt-verse')).not.toContain('3:16-16');
    expect(noteFor('rt-range')).toContain('John 3:16-18');
    expect(noteFor('rt-romans')).toContain('Romans 8:31-39');
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
      'book/my-journey-with-christ.html',
      'indexes/by-date.md',
      'indexes/by-book.md',
      'indexes/by-topic.md',
      'indexes/by-speaker.md',
      'indexes/by-place.md',
      'indexes/for-descendants.md',
    ]) {
      expect(paths, required).toContain(required);
    }

    // The retired filename, asserted absent from a REAL archive rather than
    // merely absent from the source. No journal was ever exported under it, so
    // nothing reads it and nothing should write it.
    expect(paths).not.toContain('book/my-journey-with-God.html');
    expect(
      paths.filter((path) => /my-journey-with-god/i.test(path)),
      'an archive still carries the retired book filename',
    ).toEqual([]);

    // And the book it did write says the current name, in both the places a
    // person sees it.
    const entries = await readZip(archive.bytes);
    const book = zipEntryText(
      entries.find((file) => file.path === 'book/my-journey-with-christ.html')!,
    );
    expect(book).toContain('<title>My Journey With Christ</title>');
    expect(book).toContain('<h1>My Journey With Christ</h1>');
    expect(book).not.toMatch(/My Journey with God/i);

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

  it('keeps both differing same-id versions even when the archive timestamp is newer', async () => {
    await db.putEntries([{ ...SERMON, title: 'Mine', updatedAt: '2026-09-10T00:00:00.000Z' }]);
    const archive = await buildArchive(archiveOptions([{ ...SERMON, title: 'Theirs', updatedAt: '2026-09-11T00:00:00.000Z' }]));
    await applyImport(await parseImport(archive.bytes), db, 'merge');

    const entries = await db.listEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.title).sort()).toEqual(['Mine', 'Theirs']);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(2);
  });

  it('keeps both differing same-id versions when a clock makes the local one look newer', async () => {
    await db.putEntries([{ ...SERMON, title: 'Mine', updatedAt: '2026-09-12T00:00:00.000Z' }]);
    const archive = await buildArchive(archiveOptions([{ ...SERMON, title: 'Theirs', updatedAt: '2026-09-11T00:00:00.000Z' }]));
    await applyImport(await parseImport(archive.bytes), db, 'merge');

    const entries = await db.listEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.title).sort()).toEqual(['Mine', 'Theirs']);
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

  it('refuses a stale replace preview before deleting newer local writing', async () => {
    await db.putEntries([SERMON]);
    const beforePreview = await db.readJournalSnapshot();
    const archive = await buildArchive(archiveOptions([AWKWARD]));
    const parsed = await parseImport(archive.bytes);

    await db.putEntries([READING]);

    await expect(applyImport(parsed, db, 'replace', beforePreview.token)).rejects.toThrow(
      /journal changed.*nothing was replaced/i,
    );
    expect((await db.listEntries()).map((entry) => entry.id).sort()).toEqual(
      [SERMON.id, READING.id].sort(),
    );
  });

  it('refuses a file that is not a journal, with a readable message', async () => {
    await expect(parseImport('{"nope":true}')).rejects.toThrow(/does not contain a journal/);
    await expect(parseImport('not json at all')).rejects.toThrow(/not valid JSON/);
  });
});
