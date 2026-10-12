/**
 * The persistence contract, as cases any runner can execute.
 *
 * `StorageProvider` is an interface, and an interface only says what the method
 * names are. It cannot say that `listEntries` is newest-first while
 * `listEntriesChronological` is oldest-first, that `createEntry` defaults the
 * date to today but `putEntries` defaults nothing, or that `updateEntry` refuses
 * to change an id. Those are the behaviours every caller in the application
 * already depends on, and they are what a second implementation would get subtly
 * wrong.
 *
 * WHY THESE ARE PLAIN OBJECTS AND NOT `it()` BLOCKS
 *
 * There are two implementations and they cannot be tested in the same place.
 * Dexie runs under Vitest on a laptop. SQLite only exists inside a real iOS or
 * Android application — a Node SQLite library is a different engine reached
 * through a different bridge, and proving that works proves nothing about the
 * plugin, the file location, or the device.
 *
 * So the contract is data. `conformance.ts` runs it under Vitest against Dexie;
 * the native harness runs the identical array inside the app against SQLite.
 * Neither owns it, and there is exactly one description of what persistence
 * means in this product.
 *
 * Every expectation below was derived by reading `src/storage/db.ts`, not
 * invented. Where the current behaviour is arguably odd it is still written
 * down, because callers rely on what is, not on what would have been tidier.
 */

import type { DraftForm, Entry, EntryDraft, EntryKind } from '../types';
import { assert, assertDefined } from './contract-assert';
import type { StorageProvider } from './StorageProvider';

/**
 * How a case gets a provider.
 *
 * `create` takes a store id rather than taking nothing, and that is load-bearing
 * in both directions. Each case needs a store of its own, or writes leak between
 * cases and the ordering assertions become nonsense — but the durability case
 * needs the OPPOSITE: two providers over the *same* store, which is the nearest
 * a test can get to relaunching the app. A factory that silently made a new
 * store on every call could not express the second, and would quietly pass a
 * case that proves nothing.
 */
export interface ContractEnv {
  /** An unopened provider backed by the named store. Same name, same data. */
  create: (storeId: string) => StorageProvider;
  /** A store nothing else is using. */
  newStoreId: () => string;
  /** A fresh, opened provider over a store of its own. */
  fresh: () => Promise<StorageProvider>;
}

export interface ContractCase {
  group: string;
  name: string;
  run: (env: ContractEnv) => Promise<void>;
}

/** Build an env from a bare factory. Used by both runners. */
export function contractEnv(
  label: string,
  create: (storeId: string) => StorageProvider,
): ContractEnv {
  let stores = 0;
  const newStoreId = () => `conformance-${label}-${(stores += 1)}`;
  return {
    create,
    newStoreId,
    fresh: async () => {
      const provider = create(newStoreId());
      await provider.open();
      return provider;
    },
  };
}

const draftForm = (overrides: Partial<DraftForm> = {}): DraftForm => ({
  kind: 'sermon',
  title: '',
  date: '2026-03-01',
  place: '',
  speaker: '',
  sermonSeries: '',
  notes: '',
  reflection: '',
  prayer: '',
  tagsText: '',
  links: [],
  anchors: [],
  forDescendants: false,
  scriptureRefs: [],
  sourceMaterial: null,
  ...overrides,
});

const draft = (overrides: Partial<EntryDraft> = {}): EntryDraft => ({
  id: 'd1',
  form: draftForm(),
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z',
  ...overrides,
});

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

const scriptureEntry = entry({
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
const topicalEntry = entry({ id: 'a2', anchors: [{ kind: 'topic', topicId: 'grief' }] });
const bookwideEntry = entry({ id: 'a3', anchors: [{ kind: 'book', book: 'john' }] });

const datedEntries = [
  entry({ id: 'mid', date: '2025-06-15', createdAt: '2025-06-15T00:00:00.000Z' }),
  entry({ id: 'old', date: '2024-01-01', createdAt: '2024-01-01T00:00:00.000Z' }),
  entry({ id: 'new', date: '2026-02-02', createdAt: '2026-02-02T00:00:00.000Z' }),
];

const corpus = [
  entry({ id: 'q1', date: '2024-03-01', kind: 'sermon', title: 'Grace abounding', speaker: 'Ruiz', place: 'First Baptist', tags: ['grace'] }),
  entry({ id: 'q2', date: '2025-03-01', kind: 'prayer', title: 'Evening', speaker: 'Okonkwo', place: 'home', tags: ['quiet'], forDescendants: true }),
  entry({ id: 'q3', date: '2026-03-01', kind: 'reading', title: 'Romans again', notes: 'On grace.', tags: ['grace', 'study'] }),
];

const idsFor = async (
  storage: StorageProvider,
  query: Parameters<StorageProvider['listEntries']>[0],
): Promise<string[]> => (await storage.listEntries(query)).map((e) => e.id).sort();

export const CONTRACT_CASES: ContractCase[] = [
  // -------------------------------------------------------------------------
  {
    group: 'an empty journal',
    name: 'lists nothing rather than failing',
    run: async (env) => {
      const storage = await env.fresh();
      assert.equal(await storage.listEntries(), [], 'listEntries on an empty journal');
      assert.equal(await storage.listEntriesChronological(), [], 'listEntriesChronological on an empty journal');
    },
  },
  {
    group: 'an empty journal',
    name: 'returns undefined for an id that was never written',
    run: async (env) => {
      const storage = await env.fresh();
      assert.undefined(await storage.getEntry('never-existed'), 'getEntry for an unknown id');
    },
  },
  {
    group: 'an empty journal',
    name: 'has empty settings, not missing ones',
    run: async (env) => {
      const storage = await env.fresh();
      assert.equal(await storage.getSettings(), {}, 'settings on an empty journal');
    },
  },
  {
    group: 'an empty journal',
    name: 'lists no tags, speakers or places',
    run: async (env) => {
      const storage = await env.fresh();
      assert.equal(await storage.listTags(), [], 'tags on an empty journal');
      assert.equal(await storage.listSpeakers(), [], 'speakers on an empty journal');
      assert.equal(await storage.listPlaces(), [], 'places on an empty journal');
    },
  },
  {
    group: 'an empty journal',
    name: 'can be opened more than once',
    run: async (env) => {
      // The interface says so, and the app's effects can run twice.
      const storage = env.create(env.newStoreId());
      await storage.open();
      await storage.open();
      assert.equal(await storage.listEntries(), [], 'listEntries after a second open');
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'creating',
    name: 'assigns an id, createdAt and updatedAt',
    run: async (env) => {
      const storage = await env.fresh();
      const created = await storage.createEntry({ notes: 'Written in a pew.' });

      assert.true(Boolean(created.id), 'created entry has an id');
      assert.true(Boolean(created.createdAt), 'created entry has createdAt');
      // Equal on creation: nothing has been changed yet.
      assert.is(created.updatedAt, created.createdAt, 'updatedAt equals createdAt on creation');
    },
  },
  {
    group: 'creating',
    name: 'gives every entry a distinct id',
    run: async (env) => {
      const storage = await env.fresh();
      const ids = new Set<string>();
      for (let i = 0; i < 25; i += 1) ids.add((await storage.createEntry({})).id);
      assert.atLeast(ids.size, 25, 'distinct ids minted');
    },
  },
  {
    group: 'creating',
    name: 'defaults the unset fields rather than leaving them undefined',
    run: async (env) => {
      const storage = await env.fresh();
      const created = await storage.createEntry({ notes: 'Only notes.' });

      assert.is(created.kind, 'sermon', 'default kind');
      assert.is(created.title, '', 'default title');
      assert.is(created.reflection, '', 'default reflection');
      assert.equal(created.anchors, [], 'default anchors');
      assert.equal(created.scriptureRefs, [], 'default scriptureRefs');
      assert.equal(created.links, [], 'default links');
      assert.equal(created.tags, [], 'default tags');
      assert.is(created.forDescendants, false, 'default forDescendants');
      assert.is(created.visibility, 'private', 'default visibility');
      // A created entry is dated today; an imported one keeps what it had.
      assert.matches(created.date, /^\d{4}-\d{2}-\d{2}$/, 'default date');
    },
  },
  {
    group: 'creating',
    name: 'reads back exactly what was written',
    run: async (env) => {
      const storage = await env.fresh();
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

      assert.equal(await storage.getEntry(created.id), created, 'round trip of a created entry');
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'the two fields that must never merge',
    name: 'keeps notes and reflection separate through a round trip',
    run: async (env) => {
      const storage = await env.fresh();
      const created = await storage.createEntry({
        notes: 'NOTES-ONLY-MARKER',
        reflection: 'REFLECTION-ONLY-MARKER',
      });
      const read = await storage.getEntry(created.id);
      assertDefined(read, 'the entry was stored');

      assert.is(read.notes, 'NOTES-ONLY-MARKER', 'notes survive');
      assert.is(read.reflection, 'REFLECTION-ONLY-MARKER', 'reflection survives');
      // Product rule 4: never concatenated, in either direction.
      assert.omits(read.notes, 'REFLECTION-ONLY-MARKER', 'notes did not absorb the reflection');
      assert.omits(read.reflection, 'NOTES-ONLY-MARKER', 'reflection did not absorb the notes');
    },
  },
  {
    group: 'the two fields that must never merge',
    name: 'stores a prayer without folding it into the notes',
    run: async (env) => {
      const storage = await env.fresh();
      const created = await storage.createEntry({
        notes: 'The sermon.',
        prayer: 'PRAYER-ONLY-MARKER',
      });
      const read = await storage.getEntry(created.id);
      assertDefined(read, 'the entry was stored');

      assert.is(read.prayer, 'PRAYER-ONLY-MARKER', 'prayer survives');
      assert.omits(read.notes, 'PRAYER-ONLY-MARKER', 'notes did not absorb the prayer');
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'optional fields',
    name: 'round-trips the ones that are present',
    run: async (env) => {
      const storage = await env.fresh();
      const created = await storage.createEntry({
        place: 'back porch',
        speaker: 'Rev. Okonkwo',
        sermonSeries: 'Romans',
        prayer: 'Thanks.',
      });
      const read = await storage.getEntry(created.id);
      assertDefined(read, 'the entry was stored');

      assert.is(read.place, 'back porch', 'place');
      assert.is(read.speaker, 'Rev. Okonkwo', 'speaker');
      assert.is(read.sermonSeries, 'Romans', 'sermonSeries');
      assert.is(read.prayer, 'Thanks.', 'prayer');
    },
  },
  {
    group: 'optional fields',
    name: 'round-trips import provenance',
    run: async (env) => {
      const storage = await env.fresh();
      const source = {
        importedAt: '2026-02-01T09:00:00.000Z',
        filename: 'Sunday Sermons.docx',
        format: 'docx' as const,
        itemIndex: 3,
        page: 2,
        parserVersion: 1,
      };
      await storage.putEntries([entry({ id: 'p1', source })]);
      assert.equal((await storage.getEntry('p1'))?.source, source, 'import provenance');
    },
  },
  {
    group: 'optional fields',
    name: 'round-trips unknown fields preserved from a newer version',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([entry({ id: 'u1', _unmigrated: { future: 'kept' } })]);
      assert.equal((await storage.getEntry('u1'))?._unmigrated, { future: 'kept' }, '_unmigrated');
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'anchors and topics',
    name: 'round-trips all three anchor kinds',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([scriptureEntry, topicalEntry, bookwideEntry]);

      assert.equal((await storage.getEntry('a1'))?.anchors, scriptureEntry.anchors, 'scripture anchor');
      assert.equal((await storage.getEntry('a2'))?.anchors, topicalEntry.anchors, 'topic anchor');
      assert.equal((await storage.getEntry('a3'))?.anchors, bookwideEntry.anchors, 'book anchor');
    },
  },
  {
    group: 'anchors and topics',
    name: 'finds an entry by its scripture range',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([scriptureEntry, topicalEntry]);

      const found = await storage.findEntriesForExactAnchor({
        kind: 'scripture',
        book: 'romans',
        chapterStart: 8,
        verseStart: 28,
        chapterEnd: 8,
        verseEnd: 28,
      });
      assert.equal(found.map((e) => e.id), ['a1'], 'lookup by scripture range');
    },
  },
  {
    group: 'anchors and topics',
    name: 'finds an entry by outline id, topic, and book',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([scriptureEntry, topicalEntry, bookwideEntry]);

      assert.equal(
        (await storage.findEntriesForExactAnchor({ kind: 'outline', outlineEntryId: 'romans-8-28' })).map((e) => e.id),
        ['a1'],
        'lookup by outline id',
      );
      assert.equal(
        (await storage.findEntriesForExactAnchor({ kind: 'topic', topicId: 'grief' })).map((e) => e.id),
        ['a2'],
        'lookup by topic',
      );
      assert.equal(
        (await storage.findEntriesForExactAnchor({ kind: 'book', book: 'john' })).map((e) => e.id),
        ['a3'],
        'lookup by book',
      );
    },
  },
  {
    group: 'anchors and topics',
    name: 'a scripture anchor also matches its book',
    run: async (env) => {
      // Derived behaviour: anchorKeys emits book: for scripture anchors too,
      // which is what makes "everything written about Romans" work.
      const storage = await env.fresh();
      await storage.putEntries([scriptureEntry]);
      assert.equal(
        (await storage.findEntriesForExactAnchor({ kind: 'book', book: 'romans' })).map((e) => e.id),
        ['a1'],
        'a scripture anchor is found by its book',
      );
    },
  },
  {
    group: 'anchors and topics',
    name: 'returns nothing for an anchor no entry uses',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([scriptureEntry]);
      assert.equal(
        await storage.findEntriesForExactAnchor({ kind: 'topic', topicId: 'nobody' }),
        [],
        'lookup for an unused anchor',
      );
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'updating',
    name: 'changes the field and moves updatedAt forward',
    run: async (env) => {
      const storage = await env.fresh();
      const created = await storage.createEntry({ title: 'First' });
      await new Promise((resolve) => setTimeout(resolve, 2));

      const updated = await storage.updateEntry(created.id, { title: 'Second' });
      assert.is(updated.title, 'Second', 'the field changed');
      assert.true(updated.updatedAt >= created.updatedAt, 'updatedAt moved forward');
      assert.equal(await storage.getEntry(created.id), updated, 'the stored entry matches what was returned');
    },
  },
  {
    group: 'updating',
    name: 'refuses to change identity',
    run: async (env) => {
      // id and createdAt are identity, not content. A provider that let a
      // patch move them would let an edit orphan an entry.
      const storage = await env.fresh();
      const created = await storage.createEntry({ title: 'Mine' });

      const updated = await storage.updateEntry(created.id, {
        id: 'somewhere-else',
        createdAt: '1999-01-01T00:00:00.000Z',
        title: 'Renamed',
      } as Partial<Entry>);

      assert.is(updated.id, created.id, 'id is not patchable');
      assert.is(updated.createdAt, created.createdAt, 'createdAt is not patchable');
      assert.is(updated.title, 'Renamed', 'content is patchable');
      assert.undefined(await storage.getEntry('somewhere-else'), 'no entry was created at the patched id');
    },
  },
  {
    group: 'updating',
    name: 'leaves unmentioned fields alone',
    run: async (env) => {
      const storage = await env.fresh();
      const created = await storage.createEntry({ notes: 'Kept.', reflection: 'Also kept.' });
      const updated = await storage.updateEntry(created.id, { title: 'New title' });

      assert.is(updated.notes, 'Kept.', 'notes untouched');
      assert.is(updated.reflection, 'Also kept.', 'reflection untouched');
    },
  },
  {
    group: 'updating',
    name: 'throws for an id that does not exist',
    run: async (env) => {
      const storage = await env.fresh();
      await assert.rejects(
        () => storage.updateEntry('no-such-entry', { title: 'x' }),
        'updating a missing entry',
      );
    },
  },
  {
    group: 'updating',
    name: 'serializes concurrent non-overlapping patches without losing either',
    run: async (env) => {
      const storage = await env.fresh();
      const created = await storage.createEntry({ title: 'Before', notes: 'Before notes' });

      await Promise.all([
        storage.updateEntry(created.id, { title: 'After title' }),
        storage.updateEntry(created.id, { notes: 'After notes' }),
      ]);

      const after = await storage.getEntry(created.id);
      assertDefined(after, 'the concurrently updated entry still exists');
      assert.is(after.title, 'After title', 'the title patch survived');
      assert.is(after.notes, 'After notes', 'the notes patch survived');
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'deleting',
    name: 'removes the entry and leaves the rest',
    run: async (env) => {
      const storage = await env.fresh();
      const a = await storage.createEntry({ title: 'A' });
      const b = await storage.createEntry({ title: 'B' });

      await storage.deleteEntry(a.id);
      assert.undefined(await storage.getEntry(a.id), 'the deleted entry is gone');
      assertDefined(await storage.getEntry(b.id), 'the other entry survived');
      assert.length(await storage.listEntries(), 1, 'one entry remains');
    },
  },
  {
    group: 'deleting',
    name: 'is silent about an id that is not there',
    run: async (env) => {
      // Callers treat delete as idempotent; a throw here would surface as an
      // error on a second tap.
      const storage = await env.fresh();
      await assert.resolvesUndefined(
        () => storage.deleteEntry('never-existed'),
        'deleting a missing entry',
      );
    },
  },
  {
    group: 'deleting',
    name: 'removes recovery drafts belonging to the deleted entry',
    run: async (env) => {
      const storage = await env.fresh();
      const saved = await storage.createEntry({ title: 'Parent' });
      await storage.putDraft(draft({ id: 'owned-draft', entryId: saved.id }));
      await storage.putDraft(draft({ id: 'other-draft' }));

      await storage.deleteEntry(saved.id);

      assert.is(await storage.getDraft('owned-draft'), undefined, 'the parented draft was deleted');
      assertDefined(await storage.getDraft('other-draft'), 'an unrelated draft survived');
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'ordering',
    name: 'lists chronologically oldest first',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries(datedEntries);
      assert.equal(
        (await storage.listEntriesChronological()).map((e) => e.id),
        ['old', 'mid', 'new'],
        'chronological order',
      );
    },
  },
  {
    group: 'ordering',
    name: 'lists newest first by default',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries(datedEntries);
      assert.equal(
        (await storage.listEntries()).map((e) => e.id),
        ['new', 'mid', 'old'],
        'default order',
      );
    },
  },
  {
    group: 'ordering',
    name: 'breaks a tie on the same date by creation order',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([
        entry({ id: 'second', date: '2025-01-01', createdAt: '2025-01-01T12:00:00.000Z' }),
        entry({ id: 'first', date: '2025-01-01', createdAt: '2025-01-01T09:00:00.000Z' }),
      ]);
      assert.equal(
        (await storage.listEntriesChronological()).map((e) => e.id),
        ['first', 'second'],
        'tie broken by creation order',
      );
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'querying',
    name: 'narrows by free text across the searchable fields',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries(corpus);
      assert.equal(await idsFor(storage, { text: 'grace' }), ['q1', 'q3'], 'free text across fields');
      assert.equal(await idsFor(storage, { text: 'Okonkwo' }), ['q2'], 'free text matches a speaker');
    },
  },
  {
    group: 'querying',
    name: 'narrows by kind',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries(corpus);
      assert.equal(
        await idsFor(storage, { kinds: ['prayer', 'reading'] as EntryKind[] }),
        ['q2', 'q3'],
        'narrowing by kind',
      );
    },
  },
  {
    group: 'querying',
    name: 'narrows by tag',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries(corpus);
      assert.equal(await idsFor(storage, { tags: ['grace'] }), ['q1', 'q3'], 'narrowing by tag');
    },
  },
  {
    group: 'querying',
    name: 'narrows by inclusive date bounds',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries(corpus);
      assert.equal(
        await idsFor(storage, { from: '2025-03-01', to: '2026-03-01' }),
        ['q2', 'q3'],
        'date range',
      );
      // Inclusive at both ends.
      assert.equal(
        await idsFor(storage, { from: '2025-03-01', to: '2025-03-01' }),
        ['q2'],
        'a single-day range is inclusive',
      );
    },
  },
  {
    group: 'querying',
    name: 'narrows to what is marked for descendants',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries(corpus);
      assert.equal(await idsFor(storage, { forDescendantsOnly: true }), ['q2'], 'forDescendantsOnly');
    },
  },
  {
    group: 'querying',
    name: 'applies the same narrowing chronologically',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries(corpus);
      const found = await storage.listEntriesChronological({ tags: ['grace'] });
      assert.equal(found.map((e) => e.id), ['q1', 'q3'], 'narrowing applies to the chronological list');
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'bulk writes',
    name: 'writes every entry it is given',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([entry({ id: 'b1' }), entry({ id: 'b2' })]);
      assert.length(await storage.listEntries(), 2, 'both entries written');
    },
  },
  {
    group: 'bulk writes',
    name: 'writes verbatim, defaulting nothing',
    run: async (env) => {
      // Unlike createEntry. Import depends on this: an imported entry keeps
      // its own dates and ids, or a restored journal is not the journal.
      const storage = await env.fresh();
      const original = entry({
        id: 'verbatim',
        date: '2019-01-02',
        createdAt: '2019-01-02T08:00:00.000Z',
        updatedAt: '2019-01-03T08:00:00.000Z',
      });
      await storage.putEntries([original]);
      assert.equal(await storage.getEntry('verbatim'), original, 'a bulk-written entry is verbatim');
    },
  },
  {
    group: 'bulk writes',
    name: 'replaces on id collision rather than duplicating',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([entry({ id: 'same', title: 'Before' })]);
      await storage.putEntries([entry({ id: 'same', title: 'After' })]);

      assert.length(await storage.listEntries(), 1, 'no duplicate row');
      assert.is((await storage.getEntry('same'))?.title, 'After', 'the later write won');
    },
  },
  {
    group: 'bulk writes',
    name: 'accepts an empty list without complaint',
    run: async (env) => {
      const storage = await env.fresh();
      await assert.resolvesUndefined(() => storage.putEntries([]), 'an empty bulk write');
    },
  },
  {
    group: 'bulk writes',
    name: 'is atomic: a whole batch lands, or the caller sees a failure',
    run: async (env) => {
      // Import writes one batch precisely so a journal cannot end up half
      // restored. A provider that wrote entry-by-entry would break that.
      const storage = await env.fresh();
      const batch = Array.from({ length: 50 }, (_, i) =>
        entry({ id: `batch-${i}`, date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}` }),
      );
      await storage.putEntries(batch);
      assert.length(await storage.listEntries(), 50, 'the whole batch landed');
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'replacing the whole journal',
    name: 'swaps the journal for the incoming one',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([entry({ id: 'old-1' }), entry({ id: 'old-2' })]);

      await storage.replaceEntries([entry({ id: 'new-1', title: 'Restored' })]);

      const ids = (await storage.listEntries()).map((e) => e.id);
      assert.equal(ids, ['new-1'], 'the journal is exactly what was given');
      assert.undefined(await storage.getEntry('old-1'), 'an old entry survived the replace');
    },
  },
  {
    group: 'replacing the whole journal',
    name: 'writes the incoming entries verbatim, defaulting nothing',
    run: async (env) => {
      // Restore is not authoring. An entry coming back from an archive keeps
      // its own dates and ids, or the journal that returns is not the journal
      // that left.
      const storage = await env.fresh();
      const original = entry({
        id: 'verbatim-replace',
        date: '2018-05-06',
        createdAt: '2018-05-06T07:00:00.000Z',
        updatedAt: '2018-05-07T07:00:00.000Z',
      });
      await storage.replaceEntries([original]);
      assert.equal(await storage.getEntry('verbatim-replace'), original, 'replace wrote verbatim');
    },
  },
  {
    group: 'replacing the whole journal',
    name: 'leaves settings alone, exactly as clearing does',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.updateSettings({ lastExportAt: '2026-01-01T00:00:00.000Z' });
      await storage.replaceEntries([entry({ id: 'r1' })]);

      assert.is(
        (await storage.getSettings()).lastExportAt,
        '2026-01-01T00:00:00.000Z',
        'settings survived a replace',
      );
    },
  },
  {
    group: 'replacing the whole journal',
    name: 'replacing with nothing empties the journal',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([entry({ id: 'doomed' })]);
      await storage.replaceEntries([]);
      assert.equal(await storage.listEntries(), [], 'an empty replace empties the journal');
    },
  },
  {
    group: 'replacing the whole journal',
    name: 'is atomic: a failure leaves the journal that was already there',
    run: async (env) => {
      // The reason this method exists. `clearEntries()` then `putEntries()` is
      // two transactions, and a failure between them leaves a person with
      // neither journal — the old one deleted, the new one never written. That
      // is reachable from an ordinary "restore from my archive" tap.
      const storage = await env.fresh();
      await storage.putEntries([entry({ id: 'mine', notes: 'Years of this.' })]);

      // An entry with no id: neither store can write it, and neither can be
      // talked into inventing one. Chosen deliberately over a circular object,
      // which fails `JSON.stringify` but not structured clone — a poison that
      // only one engine rejects would make this case pass for the wrong reason
      // on the other.
      const unwritable = { ...entry({ id: 'incoming-2' }), id: undefined } as unknown as Entry;

      await assert.rejects(
        () => storage.replaceEntries([entry({ id: 'incoming' }), unwritable]),
        'a replace containing unwritable data',
      );

      const survivors = (await storage.listEntries()).map((e) => e.id);
      assert.equal(survivors, ['mine'], 'the original journal did not survive a failed replace');
      assert.is(
        (await storage.getEntry('mine'))?.notes,
        'Years of this.',
        'the original entry was altered by a failed replace',
      );
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'clearing',
    name: 'removes every entry',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([entry({ id: 'c1' }), entry({ id: 'c2' })]);
      await storage.clearEntries();
      assert.equal(await storage.listEntries(), [], 'every entry removed');
    },
  },
  {
    group: 'clearing',
    name: 'leaves settings alone',
    run: async (env) => {
      // Replace-mode import clears entries; it must not forget when the user
      // last exported, or the reminder silently resets.
      const storage = await env.fresh();
      await storage.updateSettings({ lastExportAt: '2026-01-01T00:00:00.000Z' });
      await storage.putEntries([entry({ id: 'c1' })]);
      await storage.clearEntries();

      assert.is(
        (await storage.getSettings()).lastExportAt,
        '2026-01-01T00:00:00.000Z',
        'settings survived a clear',
      );
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'settings',
    name: 'merges a patch rather than replacing the whole record',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.updateSettings({ lastExportAt: '2026-01-01T00:00:00.000Z' });
      await storage.updateSettings({ theme: 'dark' });

      const settings = await storage.getSettings();
      assert.is(settings.lastExportAt, '2026-01-01T00:00:00.000Z', 'the earlier field survived');
      assert.is(settings.theme, 'dark', 'the later field was applied');
    },
  },
  {
    group: 'settings',
    name: 'returns the merged result from the call that wrote it',
    run: async (env) => {
      const storage = await env.fresh();
      const returned = await storage.updateSettings({ theme: 'light' });
      assert.equal(returned, await storage.getSettings(), 'the returned settings match the stored ones');
    },
  },
  {
    group: 'settings',
    name: 'clears a field when it is patched to undefined',
    run: async (env) => {
      // The export reminder depends on this: recording an export must be able
      // to un-dismiss the warning.
      const storage = await env.fresh();
      await storage.updateSettings({ reminderDismissedAt: '2026-01-01T00:00:00.000Z' });
      await storage.updateSettings({ reminderDismissedAt: undefined });
      assert.undefined(
        (await storage.getSettings()).reminderDismissedAt,
        'the field was cleared',
      );
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'distinct value lists',
    name: 'lists tags, speakers and places, sorted and deduplicated',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([
        entry({ id: 'd1', tags: ['zeal', 'grace'], speaker: 'Ruiz', place: 'First Baptist' }),
        entry({ id: 'd2', tags: ['grace'], speaker: 'Okonkwo', place: 'home' }),
        entry({ id: 'd3', tags: [], speaker: 'Ruiz', place: 'home' }),
      ]);

      assert.equal(await storage.listTags(), ['grace', 'zeal'], 'tags');
      assert.equal(await storage.listSpeakers(), ['Okonkwo', 'Ruiz'], 'speakers');
      assert.equal(await storage.listPlaces(), ['First Baptist', 'home'], 'places');
    },
  },
  {
    group: 'distinct value lists',
    name: 'omits entries that have none',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([entry({ id: 'd4', tags: [] })]);
      assert.equal(await storage.listTags(), [], 'no tags');
      assert.equal(await storage.listSpeakers(), [], 'no speakers');
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'durability across a reopen',
    name: 'a second provider over the same store sees what the first wrote',
    run: async (env) => {
      // The nearest thing a test can get to relaunching the app. For a native
      // provider this is the assertion that matters most.
      const store = env.newStoreId();
      const first = env.create(store);
      await first.open();
      const created = await first.createEntry({ title: 'Survives', notes: 'Written once.' });

      // The same store, opened again. Same id on purpose.
      const second = env.create(store);
      await second.open();

      const read = await second.getEntry(created.id);
      assertDefined(read, 'the entry did not survive a reopen');
      assert.is(read.notes, 'Written once.', 'the notes survived a reopen');
    },
  },
  {
    group: 'recovery drafts',
    name: 'stores a draft and gives it back exactly',
    run: async (env) => {
      const storage = await env.fresh();
      // Deliberately ragged: trailing spaces, a half-typed link row, raw tag
      // text. A recovery snapshot has to give back what was on the screen, not
      // a tidied version of it.
      const messy = draft({
        id: 'd-messy',
        form: draftForm({
          title: '  Grace at the door  ',
          notes: 'He read the whole letter aloud.\n\nStill thinking about it. ',
          tagsText: ' grace , patience ,,',
          links: [{ url: '', label: 'the audio', capturedTitle: '' }],
        }),
      });

      await storage.putDraft(messy);
      const read = await storage.getDraft('d-messy');

      assertDefined(read, 'the draft was stored');
      assert.equal(read, messy, 'the draft came back byte for byte');
    },
  },
  {
    group: 'recovery drafts',
    name: 'a draft survives a reopen, which is the whole point of it',
    run: async (env) => {
      const store = env.newStoreId();
      const first = env.create(store);
      await first.open();
      await first.putDraft(
        draft({ id: 'd-survives', form: draftForm({ notes: 'Typed and never saved.' }) }),
      );

      // The nearest a test gets to the process being killed and relaunched.
      const second = env.create(store);
      await second.open();

      const read = await second.getDraft('d-survives');
      assertDefined(read, 'the draft did not survive a reopen');
      assert.is(read.form.notes, 'Typed and never saved.', 'the exact text survived');
    },
  },
  {
    group: 'recovery drafts',
    name: 'writing the same draft again replaces it rather than duplicating it',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putDraft(draft({ id: 'd1', form: draftForm({ notes: 'first' }) }));
      await storage.putDraft(
        draft({ id: 'd1', form: draftForm({ notes: 'second' }), updatedAt: '2026-03-01T09:05:00.000Z' }),
      );

      const all = await storage.listDrafts();
      assert.is(all.length, 1, 'one draft, not two');
      assert.is(all[0].form.notes, 'second', 'the newer snapshot won');
    },
  },
  {
    group: 'recovery drafts',
    name: 'two unfinished pieces of work do not overwrite each other',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putDraft(draft({ id: 'd-sermon', form: draftForm({ notes: 'the sermon' }) }));
      await storage.putDraft(
        draft({ id: 'd-prayer', form: draftForm({ kind: 'prayer', notes: 'the prayer' }) }),
      );

      assert.is((await storage.listDrafts()).length, 2, 'both drafts are there');
      assert.is((await storage.getDraft('d-sermon'))?.form.notes, 'the sermon', 'the first survived');
      assert.is((await storage.getDraft('d-prayer'))?.form.notes, 'the prayer', 'the second survived');
    },
  },
  {
    group: 'recovery drafts',
    name: 'lists newest first',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putDraft(draft({ id: 'older', updatedAt: '2026-03-01T09:00:00.000Z' }));
      await storage.putDraft(draft({ id: 'newer', updatedAt: '2026-03-02T09:00:00.000Z' }));

      assert.equal(
        (await storage.listDrafts()).map((d) => d.id),
        ['newer', 'older'],
        'continue-where-you-left-off needs the newest first',
      );
    },
  },
  {
    group: 'recovery drafts',
    name: 'finds the unsaved edits belonging to one entry',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putDraft(draft({ id: 'd-for-a', entryId: 'entry-a', form: draftForm({ notes: 'edits to A' }) }));
      await storage.putDraft(draft({ id: 'd-for-b', entryId: 'entry-b', form: draftForm({ notes: 'edits to B' }) }));
      await storage.putDraft(draft({ id: 'd-loose', form: draftForm({ notes: 'never saved' }) }));

      assert.is((await storage.getDraftForEntry('entry-a'))?.form.notes, 'edits to A', 'found A');
      assert.is((await storage.getDraftForEntry('entry-b'))?.form.notes, 'edits to B', 'found B');
      assert.is(await storage.getDraftForEntry('entry-missing'), undefined, 'none for an entry with no draft');
    },
  },
  {
    group: 'recovery drafts',
    name: 'discarding one draft leaves the others alone',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putDraft(draft({ id: 'keep' }));
      await storage.putDraft(draft({ id: 'discard' }));

      await storage.deleteDraft('discard');

      assert.is(await storage.getDraft('discard'), undefined, 'the discarded one is gone');
      assertDefined(await storage.getDraft('keep'), 'the other one survived');
    },
  },
  {
    group: 'recovery drafts',
    name: 'discarding something already gone is not an error',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.deleteDraft('never-existed');
      assert.is((await storage.listDrafts()).length, 0, 'still empty, still fine');
    },
  },
  {
    group: 'recovery drafts',
    name: 'drafts and entries are separate collections',
    run: async (env) => {
      const storage = await env.fresh();
      const saved = await storage.createEntry({ title: 'Finished', notes: 'A real entry.' });
      await storage.putDraft(draft({ id: 'd-unfinished', form: draftForm({ notes: 'half a sentence' }) }));

      // The safety property the whole design rests on: nothing that reads
      // entries can see a draft, so the timeline, search and the book cannot
      // show unfinished work by forgetting to filter.
      const entries = await storage.listEntries();
      assert.is(entries.length, 1, 'the draft did not become an entry');
      assert.is(entries[0].id, saved.id, 'the one entry is the saved one');
      assert.is((await storage.listDrafts()).length, 1, 'the draft is still a draft');
    },
  },
  {
    group: 'recovery drafts',
    name: 'clearing entries leaves drafts alone',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.createEntry({ title: 'Finished' });
      await storage.putDraft(draft({ id: 'd-keep' }));

      await storage.clearEntries();

      assert.is((await storage.listEntries()).length, 0, 'the journal was cleared');
      assertDefined(await storage.getDraft('d-keep'), 'unfinished work is not part of a journal wipe');
    },
  },

  // -------------------------------------------------------------------------
  {
    group: 'atomic journal snapshots',
    name: 'captures entries and drafts together and replaces them together',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([entry({ id: 'old-entry' })]);
      await storage.putDraft(draft({ id: 'old-draft' }));
      const before = await storage.readJournalSnapshot();

      await storage.replaceJournal(
        [entry({ id: 'new-entry', title: 'Restored' })],
        [draft({ id: 'new-draft', form: draftForm({ notes: 'Restored draft' }) })],
        before.token,
      );

      assert.equal((await storage.listEntries()).map((item) => item.id), ['new-entry'], 'entries swapped');
      assert.equal((await storage.listDrafts()).map((item) => item.id), ['new-draft'], 'drafts swapped');
    },
  },
  {
    group: 'atomic journal snapshots',
    name: 'refuses a stale replacement without altering the current journal',
    run: async (env) => {
      const storage = await env.fresh();
      await storage.putEntries([entry({ id: 'kept' })]);
      const before = await storage.readJournalSnapshot();
      await storage.putDraft(draft({ id: 'arrived-later' }));

      await assert.rejects(
        () => storage.replaceJournal([entry({ id: 'incoming' })], [], before.token),
        'a replacement based on a stale snapshot',
      );

      assertDefined(await storage.getEntry('kept'), 'the prior entry survived');
      assertDefined(await storage.getDraft('arrived-later'), 'the concurrent draft survived');
      assert.undefined(await storage.getEntry('incoming'), 'the stale replacement wrote nothing');
    },
  },
];

/**
 * A floor for every runner.
 *
 * A harness that silently ran zero cases would otherwise report a clean pass,
 * which is the exact failure this repository keeps rediscovering. Both the
 * Vitest adapter and the native harness assert against this number.
 */
export const CONTRACT_CASE_COUNT = CONTRACT_CASES.length;
