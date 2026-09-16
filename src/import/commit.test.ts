/**
 * What reaches the journal, and what happens when it cannot.
 *
 * The promise being tested is a narrow one and worth stating exactly: choosing
 * a file, parsing it, editing a candidate and cancelling must leave the journal
 * byte-for-byte as it was, and a commit must be all-or-nothing. A half-written
 * import is worse than a failed one, because nobody can tell which half.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DexieStorageProvider } from '../storage/db';
import { examinedAtLeast } from '../testing/floor';
import type { Entry } from '../types';
import { parseDocument, type ParsedDocument } from './candidates';
import { commitImport, findDuplicates } from './commit';

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

let counter = 0;
const freshStorage = () => new DexieStorageProvider(`import-test-${(counter += 1)}`);

let storage: DexieStorageProvider;

beforeEach(async () => {
  storage = freshStorage();
  await storage.open();
});

const twoNotes = () =>
  parseDocument(bytes('# First\n\nOn Romans 8:28.\n\n# Second\n\nOn Psalm 23.'), 'sermons.md');

describe('nothing is written before the commit', () => {
  it('parses a document without touching storage', async () => {
    const parsed = await twoNotes();
    expect(parsed.candidates).toHaveLength(2);
    // The whole point of the review step.
    expect(await storage.listEntries()).toHaveLength(0);
  });

  it('leaves the journal untouched when the import is abandoned', async () => {
    const before = await storage.listEntries();
    const parsed = await twoNotes();
    // Edit candidates, look at duplicates, then simply walk away.
    parsed.candidates[0].title = 'Edited';
    await findDuplicates(parsed, parsed.candidates, before);
    expect(await storage.listEntries()).toEqual(before);
  });

  it('writes nothing when every candidate is deselected', async () => {
    const parsed = await twoNotes();
    const none = parsed.candidates.map((candidate) => ({ ...candidate, include: false }));
    const result = await commitImport(parsed, none, storage);

    expect(result.imported).toBe(0);
    expect(await storage.listEntries()).toHaveLength(0);
  });
});

describe('committing', () => {
  it('writes exactly the selected notes, and says how many', async () => {
    const parsed = await twoNotes();
    const result = await commitImport(parsed, parsed.candidates, storage);

    expect(result).toEqual({ imported: 2, failures: [] });
    const entries = await storage.listEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.title).sort()).toEqual(['First', 'Second']);
  });

  it('writes only what was ticked', async () => {
    const parsed = await twoNotes();
    const one = parsed.candidates.map((candidate, index) => ({
      ...candidate,
      include: index === 0,
    }));
    const result = await commitImport(parsed, one, storage);

    expect(result.imported).toBe(1);
    expect((await storage.listEntries())[0].title).toBe('First');
  });

  it('carries the reviewer’s edits, not the parser’s guesses', async () => {
    const parsed = await twoNotes();
    const edited = [
      {
        ...parsed.candidates[0],
        title: 'A better title',
        date: '2024-09-14',
        kind: 'prayer' as const,
        body: 'Rewritten **body**.',
        include: true,
      },
      { ...parsed.candidates[1], include: false },
    ];

    await commitImport(parsed, edited, storage);
    const entry = (await storage.listEntries())[0];

    expect(entry.title).toBe('A better title');
    expect(entry.date).toBe('2024-09-14');
    expect(entry.kind).toBe('prayer');
    expect(entry.notes).toBe('Rewritten **body**.');
  });

  it('stamps provenance on every imported entry', async () => {
    const parsed = await twoNotes();
    await commitImport(parsed, parsed.candidates, storage);

    const entries = await storage.listEntries();
    examinedAtLeast(entries.length, 2, 'entries written');
    for (const entry of entries) {
      expect(entry.source?.filename).toBe('sermons.md');
      expect(entry.source?.format).toBe('markdown');
      expect(entry.source?.parserVersion).toBe(1);
    }
    // Both from one import, so one timestamp across the batch.
    expect(new Set(entries.map((entry) => entry.source?.importedAt)).size).toBe(1);
  });

  it('never overwrites an entry that is already there', async () => {
    const mine = await storage.createEntry({ title: 'Mine', notes: 'Written by hand.' });
    const parsed = await twoNotes();
    await commitImport(parsed, parsed.candidates, storage);

    const entries = await storage.listEntries();
    expect(entries).toHaveLength(3);
    // Untouched, and still findable by the id it had.
    expect(await storage.getEntry(mine.id)).toMatchObject({ title: 'Mine' });
  });

  it('mints ids that do not collide with what exists', async () => {
    const parsed = await twoNotes();
    await commitImport(parsed, parsed.candidates, storage);
    const ids = (await storage.listEntries()).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('a failed write leaves nothing behind', () => {
  it('imports nothing at all when storage refuses the batch', async () => {
    const parsed = await twoNotes();
    const failing = {
      ...storage,
      listEntries: () => storage.listEntries(),
      putEntries: vi.fn(async () => {
        throw new Error('disk is on fire');
      }),
    } as unknown as DexieStorageProvider;

    const result = await commitImport(parsed, parsed.candidates, failing);

    expect(result.imported).toBe(0);
    expect(result.failures).toHaveLength(1);
    // The message is for a person; it names no cause and no path.
    expect(result.failures[0]).toMatch(/unchanged/i);
    expect(result.failures[0]).not.toMatch(/disk is on fire/);
    expect(await storage.listEntries()).toHaveLength(0);
  });

  it('says so plainly when the browser has run out of room', async () => {
    const parsed = await twoNotes();
    const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    const failing = {
      listEntries: () => storage.listEntries(),
      putEntries: vi.fn(async () => {
        throw quota;
      }),
    } as unknown as DexieStorageProvider;

    const result = await commitImport(parsed, parsed.candidates, failing);
    expect(result.failures[0]).toMatch(/not enough room/i);
    expect(result.imported).toBe(0);
  });

  it('writes the whole batch through a single call, so it cannot half-succeed', async () => {
    const parsed = await twoNotes();
    const putEntries = vi.fn(async (entries: Entry[]) => storage.putEntries(entries));
    const watched = {
      listEntries: () => storage.listEntries(),
      putEntries,
    } as unknown as DexieStorageProvider;

    await commitImport(parsed, parsed.candidates, watched);

    // One call. Dexie's bulkPut on a single table is one IndexedDB
    // transaction, so all of it lands or none of it does; looping per entry
    // would be exactly the half-written journal this avoids.
    expect(putEntries).toHaveBeenCalledTimes(1);
    expect(putEntries.mock.calls[0][0]).toHaveLength(2);
  });
});

describe('duplicates are reported, never resolved', () => {
  const importedAlready = async (document_: ParsedDocument) => {
    await commitImport(document_, document_.candidates, storage);
    return storage.listEntries();
  };

  it('notices the same file arriving a second time', async () => {
    const first = await twoNotes();
    const existing = await importedAlready(first);

    const second = await twoNotes();
    const report = await findDuplicates(second, second.candidates, existing);

    expect(report.fileSeenBefore).toBe(true);
    examinedAtLeast(report.findings.length, 1, 'duplicate findings');
  });

  it('notices identical content from a differently named file', async () => {
    const first = await twoNotes();
    const existing = await importedAlready(first);

    const renamed = await parseDocument(
      bytes('# First\n\nOn Romans 8:28.\n\n# Second\n\nOn Psalm 23.'),
      'copy-of-sermons.md',
    );
    const report = await findDuplicates(renamed, renamed.candidates, existing);

    expect(report.fileSeenBefore).toBe(false);
    expect(report.findings.every((finding) => finding.kind === 'same-content')).toBe(true);
    expect(report.findings).toHaveLength(2);
  });

  it('reports without changing anything', async () => {
    const first = await twoNotes();
    const existing = await importedAlready(first);

    const again = await twoNotes();
    await findDuplicates(again, again.candidates, existing);

    // Nothing merged, nothing deleted, nothing deduplicated behind the user.
    expect(await storage.listEntries()).toHaveLength(2);
    // And every candidate is still on offer: the choice is the reader's.
    expect(again.candidates.every((candidate) => candidate.include)).toBe(true);
  });

  it('finds nothing to report for genuinely new material', async () => {
    const first = await twoNotes();
    const existing = await importedAlready(first);

    const different = await parseDocument(bytes('# Third\n\nSomething else entirely.'), 'new.md');
    const report = await findDuplicates(different, different.candidates, existing);

    expect(report.fileSeenBefore).toBe(false);
    expect(report.findings).toEqual([]);
  });
});
