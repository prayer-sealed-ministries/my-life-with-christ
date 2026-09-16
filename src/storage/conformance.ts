/**
 * The persistence contract, as a suite any provider must pass.
 *
 * `StorageProvider` is an interface, and an interface only says what the method
 * names are. It cannot say that `listEntries` is newest-first while
 * `listEntriesChronological` is oldest-first, that `createEntry` defaults the
 * date to today but `putEntries` defaults nothing, or that `updateEntry`
 * refuses to change an id. Those are the behaviours every caller in the
 * application already depends on, and they are what a second implementation
 * would get subtly wrong.
 *
 * So the contract is written once, here, and run against every implementation.
 * Today that is Dexie. In Phase 2 it is SQLite as well, plugged into this exact
 * suite — which is the mechanism that keeps the editions from diverging, and
 * the reason two implementations of one interface is a seam rather than a
 * liability.
 *
 * Every expectation below was derived by reading `src/storage/db.ts`, not
 * invented. Where the current behaviour is arguably odd it is still written
 * down, because callers rely on what is, not on what would have been tidier.
 */

import { describe, expect, it } from 'vitest';

import { examinedAtLeast } from '../testing/floor';
import type { Entry, EntryKind } from '../types';
import type { StorageProvider } from './StorageProvider';

/**
 * How the suite gets a provider.
 *
 * `create` takes a store id rather than taking nothing, and that is load-bearing
 * in both directions. Each test needs a store of its own, or writes leak between
 * tests and the ordering assertions become nonsense — but the durability case
 * needs the OPPOSITE: two providers over the *same* store, which is the nearest
 * a test can get to relaunching the app. A factory that silently made a new
 * store on every call could not express the second, and would quietly pass a
 * test that proves nothing.
 *
 * So the suite chooses the ids and says which it wants.
 */
export interface ConformanceOptions {
  /** An unopened provider backed by the named store. Same name, same data. */
  create: (storeId: string) => StorageProvider;
}

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  kind: 'sermon',
  title: 'A sermon',
  date: '2025-06-15',
  anchors: [],
  scriptureRefs: [],
  notes: 'What was taught.',
  reflection: 'What it meant.',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2025-06-15T10:00:00.000Z',
  updatedAt: '2025-06-15T10:00:00.000Z',
  ...overrides,
});

/**
 * Run the persistence contract against one implementation.
 *
 * @param name what to call it in the test output
 */
export function runStorageConformance(name: string, options: ConformanceOptions): void {
  let stores = 0;
  /** A store nothing else is using. */
  const newStoreId = () => `conformance-${name}-${(stores += 1)}`;

  const fresh = async (): Promise<StorageProvider> => {
    const provider = options.create(newStoreId());
    await provider.open();
    return provider;
  };

  describe(`StorageProvider contract — ${name}`, () => {
    describe('an empty journal', () => {
      it('lists nothing rather than failing', async () => {
        const storage = await fresh();
        expect(await storage.listEntries()).toEqual([]);
        expect(await storage.listEntriesChronological()).toEqual([]);
      });

      it('returns undefined for an id that was never written', async () => {
        const storage = await fresh();
        expect(await storage.getEntry('never-existed')).toBeUndefined();
      });

      it('has empty settings, not missing ones', async () => {
        const storage = await fresh();
        expect(await storage.getSettings()).toEqual({});
      });

      it('lists no tags, speakers or places', async () => {
        const storage = await fresh();
        expect(await storage.listTags()).toEqual([]);
        expect(await storage.listSpeakers()).toEqual([]);
        expect(await storage.listPlaces()).toEqual([]);
      });

      it('can be opened more than once', async () => {
        // The interface says so, and the app's effects can run twice.
        const storage = options.create(newStoreId());
        await storage.open();
        await storage.open();
        expect(await storage.listEntries()).toEqual([]);
      });
    });

    describe('creating', () => {
      it('assigns an id, createdAt and updatedAt', async () => {
        const storage = await fresh();
        const created = await storage.createEntry({ notes: 'Written in a pew.' });

        expect(created.id).toBeTruthy();
        expect(created.createdAt).toBeTruthy();
        // Equal on creation: nothing has been changed yet.
        expect(created.updatedAt).toBe(created.createdAt);
      });

      it('gives every entry a distinct id', async () => {
        const storage = await fresh();
        const ids = new Set<string>();
        for (let i = 0; i < 25; i += 1) ids.add((await storage.createEntry({})).id);
        examinedAtLeast(ids.size, 25, 'distinct ids minted');
      });

      it('defaults the unset fields rather than leaving them undefined', async () => {
        const storage = await fresh();
        const created = await storage.createEntry({ notes: 'Only notes.' });

        expect(created.kind).toBe('sermon');
        expect(created.title).toBe('');
        expect(created.reflection).toBe('');
        expect(created.anchors).toEqual([]);
        expect(created.scriptureRefs).toEqual([]);
        expect(created.links).toEqual([]);
        expect(created.tags).toEqual([]);
        expect(created.forDescendants).toBe(false);
        expect(created.visibility).toBe('private');
        // A created entry is dated today; an imported one keeps what it had.
        expect(created.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('reads back exactly what was written', async () => {
        const storage = await fresh();
        const created = await storage.createEntry({
          kind: 'prayer',
          title: 'For the Millers',
          notes: 'What was taught.',
          reflection: 'What it meant.',
          prayer: 'Keep praying.',
          tags: ['grace', 'patience'],
          speaker: 'Pastor Ruiz',
          place: 'First Baptist',
          forDescendants: true,
        });

        expect(await storage.getEntry(created.id)).toEqual(created);
      });
    });

    describe('the two fields that must never merge', () => {
      it('keeps notes and reflection separate through a round trip', async () => {
        const storage = await fresh();
        const created = await storage.createEntry({
          notes: 'NOTES-ONLY-MARKER',
          reflection: 'REFLECTION-ONLY-MARKER',
        });
        const read = await storage.getEntry(created.id);

        expect(read?.notes).toBe('NOTES-ONLY-MARKER');
        expect(read?.reflection).toBe('REFLECTION-ONLY-MARKER');
        // Product rule 4: never concatenated, in either direction.
        expect(read?.notes).not.toContain('REFLECTION-ONLY-MARKER');
        expect(read?.reflection).not.toContain('NOTES-ONLY-MARKER');
      });

      it('stores a prayer without folding it into the notes', async () => {
        const storage = await fresh();
        const created = await storage.createEntry({
          notes: 'The sermon.',
          prayer: 'PRAYER-ONLY-MARKER',
        });
        const read = await storage.getEntry(created.id);

        expect(read?.prayer).toBe('PRAYER-ONLY-MARKER');
        expect(read?.notes).not.toContain('PRAYER-ONLY-MARKER');
      });
    });

    describe('optional fields', () => {
      it('round-trips the ones that are present', async () => {
        const storage = await fresh();
        const created = await storage.createEntry({
          place: 'back porch',
          speaker: 'Rev. Okonkwo',
          sermonSeries: 'Romans',
          prayer: 'Thanks.',
        });
        const read = await storage.getEntry(created.id);

        expect(read?.place).toBe('back porch');
        expect(read?.speaker).toBe('Rev. Okonkwo');
        expect(read?.sermonSeries).toBe('Romans');
        expect(read?.prayer).toBe('Thanks.');
      });

      it('round-trips import provenance', async () => {
        const storage = await fresh();
        const source = {
          importedAt: '2026-02-01T09:00:00.000Z',
          filename: 'Sunday Sermons.docx',
          format: 'docx' as const,
          itemIndex: 3,
          page: 2,
          parserVersion: 1,
        };
        await storage.putEntries([entry({ id: 'p1', source })]);
        expect((await storage.getEntry('p1'))?.source).toEqual(source);
      });

      it('round-trips unknown fields preserved from a newer version', async () => {
        const storage = await fresh();
        await storage.putEntries([entry({ id: 'u1', _unmigrated: { future: 'kept' } })]);
        expect((await storage.getEntry('u1'))?._unmigrated).toEqual({ future: 'kept' });
      });
    });

    describe('anchors and topics', () => {
      const scripture = entry({
        id: 'a1',
        anchors: [
          {
            kind: 'scripture',
            book: 'romans',
            chapterStart: 8,
            verseStart: 28,
            chapterEnd: 8,
            verseEnd: 28,
            outlineEntryId: 'romans-8-28',
          },
        ],
      });
      const topical = entry({ id: 'a2', anchors: [{ kind: 'topic', topicId: 'grief' }] });
      const bookwide = entry({ id: 'a3', anchors: [{ kind: 'book', book: 'john' }] });

      it('round-trips all three anchor kinds', async () => {
        const storage = await fresh();
        await storage.putEntries([scripture, topical, bookwide]);

        expect((await storage.getEntry('a1'))?.anchors).toEqual(scripture.anchors);
        expect((await storage.getEntry('a2'))?.anchors).toEqual(topical.anchors);
        expect((await storage.getEntry('a3'))?.anchors).toEqual(bookwide.anchors);
      });

      it('finds an entry by its scripture range', async () => {
        const storage = await fresh();
        await storage.putEntries([scripture, topical]);

        const found = await storage.findEntriesForAnchor({
          kind: 'scripture',
          book: 'romans',
          chapterStart: 8,
          verseStart: 28,
          chapterEnd: 8,
          verseEnd: 28,
        });
        expect(found.map((e) => e.id)).toEqual(['a1']);
      });

      it('finds an entry by outline id, topic, and book', async () => {
        const storage = await fresh();
        await storage.putEntries([scripture, topical, bookwide]);

        expect(
          (await storage.findEntriesForAnchor({ kind: 'outline', outlineEntryId: 'romans-8-28' }))
            .map((e) => e.id),
        ).toEqual(['a1']);
        expect(
          (await storage.findEntriesForAnchor({ kind: 'topic', topicId: 'grief' })).map((e) => e.id),
        ).toEqual(['a2']);
        expect(
          (await storage.findEntriesForAnchor({ kind: 'book', book: 'john' })).map((e) => e.id),
        ).toEqual(['a3']);
      });

      it('a scripture anchor also matches its book', async () => {
        // Derived behaviour: anchorKeys emits book: for scripture anchors too,
        // which is what makes "everything written about Romans" work.
        const storage = await fresh();
        await storage.putEntries([scripture]);
        expect(
          (await storage.findEntriesForAnchor({ kind: 'book', book: 'romans' })).map((e) => e.id),
        ).toEqual(['a1']);
      });

      it('returns nothing for an anchor no entry uses', async () => {
        const storage = await fresh();
        await storage.putEntries([scripture]);
        expect(await storage.findEntriesForAnchor({ kind: 'topic', topicId: 'nobody' })).toEqual([]);
      });
    });

    describe('updating', () => {
      it('changes the field and moves updatedAt forward', async () => {
        const storage = await fresh();
        const created = await storage.createEntry({ title: 'First' });
        await new Promise((resolve) => setTimeout(resolve, 2));

        const updated = await storage.updateEntry(created.id, { title: 'Second' });
        expect(updated.title).toBe('Second');
        expect(updated.updatedAt >= created.updatedAt).toBe(true);
        expect(await storage.getEntry(created.id)).toEqual(updated);
      });

      it('refuses to change identity', async () => {
        // id and createdAt are identity, not content. A provider that let a
        // patch move them would let an edit orphan an entry.
        const storage = await fresh();
        const created = await storage.createEntry({ title: 'Mine' });

        const updated = await storage.updateEntry(created.id, {
          id: 'somewhere-else',
          createdAt: '1999-01-01T00:00:00.000Z',
          title: 'Renamed',
        } as Partial<Entry>);

        expect(updated.id).toBe(created.id);
        expect(updated.createdAt).toBe(created.createdAt);
        expect(updated.title).toBe('Renamed');
        expect(await storage.getEntry('somewhere-else')).toBeUndefined();
      });

      it('leaves unmentioned fields alone', async () => {
        const storage = await fresh();
        const created = await storage.createEntry({ notes: 'Kept.', reflection: 'Also kept.' });
        const updated = await storage.updateEntry(created.id, { title: 'New title' });

        expect(updated.notes).toBe('Kept.');
        expect(updated.reflection).toBe('Also kept.');
      });

      it('throws for an id that does not exist', async () => {
        const storage = await fresh();
        await expect(storage.updateEntry('no-such-entry', { title: 'x' })).rejects.toThrow();
      });
    });

    describe('deleting', () => {
      it('removes the entry and leaves the rest', async () => {
        const storage = await fresh();
        const a = await storage.createEntry({ title: 'A' });
        const b = await storage.createEntry({ title: 'B' });

        await storage.deleteEntry(a.id);
        expect(await storage.getEntry(a.id)).toBeUndefined();
        expect(await storage.getEntry(b.id)).toBeDefined();
        expect(await storage.listEntries()).toHaveLength(1);
      });

      it('is silent about an id that is not there', async () => {
        // Callers treat delete as idempotent; a throw here would surface as an
        // error on a second tap.
        const storage = await fresh();
        await expect(storage.deleteEntry('never-existed')).resolves.toBeUndefined();
      });
    });

    describe('ordering', () => {
      const dated = [
        entry({ id: 'mid', date: '2025-06-15', createdAt: '2025-06-15T00:00:00.000Z' }),
        entry({ id: 'old', date: '2024-01-01', createdAt: '2024-01-01T00:00:00.000Z' }),
        entry({ id: 'new', date: '2026-02-02', createdAt: '2026-02-02T00:00:00.000Z' }),
      ];

      it('lists chronologically oldest first', async () => {
        const storage = await fresh();
        await storage.putEntries(dated);
        expect((await storage.listEntriesChronological()).map((e) => e.id)).toEqual([
          'old',
          'mid',
          'new',
        ]);
      });

      it('lists newest first by default', async () => {
        const storage = await fresh();
        await storage.putEntries(dated);
        expect((await storage.listEntries()).map((e) => e.id)).toEqual(['new', 'mid', 'old']);
      });

      it('breaks a tie on the same date by creation order', async () => {
        const storage = await fresh();
        await storage.putEntries([
          entry({ id: 'second', date: '2025-01-01', createdAt: '2025-01-01T12:00:00.000Z' }),
          entry({ id: 'first', date: '2025-01-01', createdAt: '2025-01-01T09:00:00.000Z' }),
        ]);
        expect((await storage.listEntriesChronological()).map((e) => e.id)).toEqual([
          'first',
          'second',
        ]);
      });
    });

    describe('querying', () => {
      const corpus = [
        entry({ id: 'q1', date: '2024-03-01', kind: 'sermon', title: 'Grace abounding', speaker: 'Ruiz', place: 'First Baptist', tags: ['grace'] }),
        entry({ id: 'q2', date: '2025-03-01', kind: 'prayer', title: 'Evening', speaker: 'Okonkwo', place: 'home', tags: ['quiet'], forDescendants: true }),
        entry({ id: 'q3', date: '2026-03-01', kind: 'reading', title: 'Romans again', notes: 'On grace.', tags: ['grace', 'study'] }),
      ];

      const ids = async (storage: StorageProvider, query: Parameters<StorageProvider['listEntries']>[0]) =>
        (await storage.listEntries(query)).map((e) => e.id).sort();

      it('narrows by free text across the searchable fields', async () => {
        const storage = await fresh();
        await storage.putEntries(corpus);
        expect(await ids(storage, { text: 'grace' })).toEqual(['q1', 'q3']);
        expect(await ids(storage, { text: 'Okonkwo' })).toEqual(['q2']);
      });

      it('narrows by kind', async () => {
        const storage = await fresh();
        await storage.putEntries(corpus);
        expect(await ids(storage, { kinds: ['prayer', 'reading'] as EntryKind[] })).toEqual(['q2', 'q3']);
      });

      it('narrows by tag', async () => {
        const storage = await fresh();
        await storage.putEntries(corpus);
        expect(await ids(storage, { tags: ['grace'] })).toEqual(['q1', 'q3']);
      });

      it('narrows by inclusive date bounds', async () => {
        const storage = await fresh();
        await storage.putEntries(corpus);
        expect(await ids(storage, { from: '2025-03-01', to: '2026-03-01' })).toEqual(['q2', 'q3']);
        // Inclusive at both ends.
        expect(await ids(storage, { from: '2025-03-01', to: '2025-03-01' })).toEqual(['q2']);
      });

      it('narrows to what is marked for descendants', async () => {
        const storage = await fresh();
        await storage.putEntries(corpus);
        expect(await ids(storage, { forDescendantsOnly: true })).toEqual(['q2']);
      });

      it('applies the same narrowing chronologically', async () => {
        const storage = await fresh();
        await storage.putEntries(corpus);
        const found = await storage.listEntriesChronological({ tags: ['grace'] });
        expect(found.map((e) => e.id)).toEqual(['q1', 'q3']);
      });
    });

    describe('bulk writes', () => {
      it('writes every entry it is given', async () => {
        const storage = await fresh();
        await storage.putEntries([entry({ id: 'b1' }), entry({ id: 'b2' })]);
        expect(await storage.listEntries()).toHaveLength(2);
      });

      it('writes verbatim, defaulting nothing', async () => {
        // Unlike createEntry. Import depends on this: an imported entry keeps
        // its own dates and ids, or a restored journal is not the journal.
        const storage = await fresh();
        const original = entry({ id: 'verbatim', date: '2019-01-02', createdAt: '2019-01-02T08:00:00.000Z', updatedAt: '2019-01-03T08:00:00.000Z' });
        await storage.putEntries([original]);
        expect(await storage.getEntry('verbatim')).toEqual(original);
      });

      it('replaces on id collision rather than duplicating', async () => {
        const storage = await fresh();
        await storage.putEntries([entry({ id: 'same', title: 'Before' })]);
        await storage.putEntries([entry({ id: 'same', title: 'After' })]);

        expect(await storage.listEntries()).toHaveLength(1);
        expect((await storage.getEntry('same'))?.title).toBe('After');
      });

      it('accepts an empty list without complaint', async () => {
        const storage = await fresh();
        await expect(storage.putEntries([])).resolves.toBeUndefined();
      });

      it('is atomic: a whole batch lands, or the caller sees a failure', async () => {
        // Import writes one batch precisely so a journal cannot end up half
        // restored. A provider that wrote entry-by-entry would break that.
        const storage = await fresh();
        const batch = Array.from({ length: 50 }, (_, i) =>
          entry({ id: `batch-${i}`, date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}` }),
        );
        await storage.putEntries(batch);
        expect(await storage.listEntries()).toHaveLength(50);
      });
    });

    describe('clearing', () => {
      it('removes every entry', async () => {
        const storage = await fresh();
        await storage.putEntries([entry({ id: 'c1' }), entry({ id: 'c2' })]);
        await storage.clearEntries();
        expect(await storage.listEntries()).toEqual([]);
      });

      it('leaves settings alone', async () => {
        // Replace-mode import clears entries; it must not forget when the user
        // last exported, or the reminder silently resets.
        const storage = await fresh();
        await storage.updateSettings({ lastExportAt: '2026-01-01T00:00:00.000Z' });
        await storage.putEntries([entry({ id: 'c1' })]);
        await storage.clearEntries();

        expect((await storage.getSettings()).lastExportAt).toBe('2026-01-01T00:00:00.000Z');
      });
    });

    describe('settings', () => {
      it('merges a patch rather than replacing the whole record', async () => {
        const storage = await fresh();
        await storage.updateSettings({ lastExportAt: '2026-01-01T00:00:00.000Z' });
        await storage.updateSettings({ theme: 'dark' });

        const settings = await storage.getSettings();
        expect(settings.lastExportAt).toBe('2026-01-01T00:00:00.000Z');
        expect(settings.theme).toBe('dark');
      });

      it('returns the merged result from the call that wrote it', async () => {
        const storage = await fresh();
        const returned = await storage.updateSettings({ theme: 'light' });
        expect(returned).toEqual(await storage.getSettings());
      });

      it('clears a field when it is patched to undefined', async () => {
        // The export reminder depends on this: recording an export must be able
        // to un-dismiss the warning.
        const storage = await fresh();
        await storage.updateSettings({ reminderDismissedAt: '2026-01-01T00:00:00.000Z' });
        await storage.updateSettings({ reminderDismissedAt: undefined });
        expect((await storage.getSettings()).reminderDismissedAt).toBeUndefined();
      });
    });

    describe('distinct value lists', () => {
      it('lists tags, speakers and places, sorted and deduplicated', async () => {
        const storage = await fresh();
        await storage.putEntries([
          entry({ id: 'd1', tags: ['zeal', 'grace'], speaker: 'Ruiz', place: 'First Baptist' }),
          entry({ id: 'd2', tags: ['grace'], speaker: 'Okonkwo', place: 'home' }),
          entry({ id: 'd3', tags: [], speaker: 'Ruiz', place: 'home' }),
        ]);

        expect(await storage.listTags()).toEqual(['grace', 'zeal']);
        expect(await storage.listSpeakers()).toEqual(['Okonkwo', 'Ruiz']);
        expect(await storage.listPlaces()).toEqual(['First Baptist', 'home']);
      });

      it('omits entries that have none', async () => {
        const storage = await fresh();
        await storage.putEntries([entry({ id: 'd4', tags: [] })]);
        expect(await storage.listTags()).toEqual([]);
        expect(await storage.listSpeakers()).toEqual([]);
      });
    });

    describe('durability across a reopen', () => {
      it('a second provider over the same store sees what the first wrote', async () => {
        // The nearest thing a test can get to relaunching the app. For a native
        // provider this is the assertion that matters most.
        const store = newStoreId();
        const first = options.create(store);
        await first.open();
        const created = await first.createEntry({ title: 'Survives', notes: 'Written once.' });

        // The same store, opened again. Same id on purpose.
        const second = options.create(store);
        await second.open();

        const read = await second.getEntry(created.id);
        expect(read, 'the entry did not survive a reopen').toBeDefined();
        expect(read?.notes).toBe('Written once.');
      });
    });
  });
}
