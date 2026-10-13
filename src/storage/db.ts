/**
 * IndexedDB persistence, via Dexie.
 *
 * Everything stays on the device. There is no network call anywhere in this
 * file, and there is not meant to be one.
 *
 * A caution that shapes the design: browser storage is not a backup. A cleared
 * cache, a reinstalled browser, or a full disk can take all of it. The export
 * is the durable artefact; this is the working copy. `lastExportAt` lives here
 * so the app can say so out loud when it has been too long.
 */

import Dexie, { type EntityTable } from 'dexie';

import type { Entry, EntryDraft, NewEntry, Settings } from '../types';
import {
  PLACES,
  SPEAKERS,
  TAGS,
  anchorLookupKey,
  applyPatch,
  byDateDescending,
  chronologically,
  distinctValues,
  entryToCreate,
  indexed,
  matches,
  DraftConflictError,
  assertEntryPatchCurrent,
} from './semantics';
import { mergeEnvelopeMetadata, type JournalEnvelopeMetadata } from './envelope-metadata';
import { promotedDraftMetadata } from '../lib/entry-draft';
import { byRecency } from '../lib/drafts';
import type { AnchorLookup, EntryQuery, StorageProvider, UpdateEntryOptions } from './StorageProvider';
import { JournalChangedError, journalToken, sameRecord, type JournalSnapshot } from './journal';

// Re-exported for the views and tests that already import them from here. The
// definitions moved to `semantics.ts` so the SQLite provider can share them
// without importing Dexie.
export { anchorKeys, searchableText, todayIso, EMPTY_ENTRY } from './semantics';

const SETTINGS_KEY = 'singleton';

interface SettingsRow extends Settings {
  key: string;
}

interface EnvelopeRow { key: string; sources: JournalEnvelopeMetadata }

class JourneyDatabase extends Dexie {
  entries!: EntityTable<Entry, 'id'>;
  settings!: EntityTable<SettingsRow, 'key'>;
  drafts!: EntityTable<EntryDraft, 'id'>;
  envelopeMetadata!: EntityTable<EnvelopeRow, 'key'>;

  constructor(name = 'journey') {
    super(name);
    // `anchorKeys` and `searchText` are derived on write (see toRow) purely so
    // IndexedDB can index them; they are stripped on read and never exported.
    this.version(1).stores({
      entries: 'id, date, kind, speaker, place, updatedAt, *tags, *anchorKeys',
      settings: 'key',
    });
    // v2 adds recovery drafts. Purely additive: Dexie carries the existing
    // stores forward untouched, so an upgrade cannot disturb a journal.
    // `entryId` is indexed because "has this entry got unsaved edits?" is asked
    // every time an entry is opened, and scanning for it would get slower as
    // someone's unfinished work accumulated.
    this.version(2).stores({
      drafts: 'id, entryId, updatedAt',
    });
    // Independent singleton data survives even a journal with zero records.
    this.version(3).stores({ envelopeMetadata: 'key' });
  }
}

type EntryRow = Entry & { anchorKeys: string[]; searchText: string };

const toRow = (entry: Entry): EntryRow => {
  const { anchorKeys: keys, searchText } = indexed(entry);
  return { ...entry, anchorKeys: keys, searchText };
};

/** Strip the derived index columns so what comes out is exactly what went in. */
const fromRow = (row: EntryRow | Entry): Entry => {
  const { anchorKeys: _a, searchText: _s, ...entry } = row as EntryRow;
  return entry as Entry;
};

export class DexieStorageProvider implements StorageProvider {
  /** Counterpart to the SQLite tag, so a substitution is visible, not inferred. */
  readonly engine = 'indexeddb' as const;

  private db: JourneyDatabase;

  constructor(name = 'journey') {
    this.db = new JourneyDatabase(name);
  }

  async open(): Promise<void> {
    if (!this.db.isOpen()) await this.db.open();
  }

  async getEntry(id: string): Promise<Entry | undefined> {
    const row = await this.db.entries.get(id);
    return row ? fromRow(row) : undefined;
  }

  async listEntries(query: EntryQuery = {}): Promise<Entry[]> {
    const entries = await this.listEntriesChronological(query);
    return entries.reverse();
  }

  async listEntriesChronological(query: EntryQuery = {}): Promise<Entry[]> {
    const rows = (await this.db.entries.toArray()) as EntryRow[];
    return rows
      .map((row) => ({ entry: fromRow(row), anchorKeys: row.anchorKeys, searchText: row.searchText }))
      .filter((row) => matches(row, query))
      .map((row) => row.entry)
      .sort(chronologically);
  }

  async createEntry(input: NewEntry): Promise<Entry> {
    const entry = entryToCreate(input);
    await this.db.entries.put(toRow(entry));
    return entry;
  }

  async updateEntry(id: string, patch: Partial<Entry>, options?: UpdateEntryOptions): Promise<Entry> {
    return this.db.transaction('rw', this.db.entries, async () => {
      const row = (await this.db.entries.get(id)) as EntryRow | undefined;
      if (!row) throw new Error(`No entry with id ${id}`);
      const existing = fromRow(row);
      assertEntryPatchCurrent(existing, patch, options?.expectedEntry);
      const updated = applyPatch(existing, patch);
      if (options?.preserveDraft) updated._unmigrated = promotedDraftMetadata(existing._unmigrated, options.preserveDraft);
      await this.db.entries.put(toRow(updated));
      return updated;
    });
  }

  async deleteEntry(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.entries, this.db.drafts, async () => {
      await this.db.entries.delete(id);
      await this.db.drafts.where('entryId').equals(id).delete();
    });
  }

  async findEntriesForExactAnchor(anchor: AnchorLookup): Promise<Entry[]> {
    const key = anchorLookupKey(anchor);
    const rows = (await this.db.entries.where('anchorKeys').equals(key).toArray()) as EntryRow[];
    return rows.map(fromRow).sort(byDateDescending);
  }

  async putEntries(entries: Entry[]): Promise<void> {
    await this.db.entries.bulkPut(entries.map(toRow));
  }

  async replaceEntries(entries: Entry[]): Promise<void> {
    // Dexie's transaction covers both operations, matching SQLite: either the
    // incoming journal replaces the old one or the old one is still there.
    await this.db.transaction('rw', this.db.entries, async () => {
      await this.db.entries.clear();
      await this.db.entries.bulkPut(entries.map(toRow));
    });
  }

  async readJournalSnapshot(): Promise<JournalSnapshot> {
    return this.db.transaction('r', this.db.entries, this.db.drafts, this.db.envelopeMetadata, async () => {
      const entries = ((await this.db.entries.toArray()) as EntryRow[])
        .map(fromRow)
        .sort(chronologically);
      const drafts = (await this.db.drafts.toArray()).sort(byRecency);
      const envelopeMetadata = (await this.db.envelopeMetadata.get(SETTINGS_KEY))?.sources ?? [];
      return {
        entries,
        drafts,
        envelopeMetadata,
        token: journalToken(entries, drafts, envelopeMetadata),
        capturedAt: new Date().toISOString(),
      };
    });
  }

  async journalMatches(token: string): Promise<boolean> {
    const snapshot = await this.readJournalSnapshot();
    return snapshot.token === token;
  }

  async replaceJournal(
    entries: Entry[],
    drafts: EntryDraft[],
    expectedToken?: string,
    envelopeMetadata: JournalEnvelopeMetadata = [],
  ): Promise<void> {
    await this.db.transaction('rw', this.db.entries, this.db.drafts, this.db.envelopeMetadata, async () => {
      if (expectedToken !== undefined) {
        const currentEntries = ((await this.db.entries.toArray()) as EntryRow[]).map(fromRow);
        const currentDrafts = await this.db.drafts.toArray();
        if (journalToken(currentEntries, currentDrafts,
          (await this.db.envelopeMetadata.get(SETTINGS_KEY))?.sources ?? []) !== expectedToken) {
          throw new JournalChangedError();
        }
      }
      await this.db.entries.clear();
      await this.db.drafts.clear();
      if (entries.length > 0) await this.db.entries.bulkPut(entries.map(toRow));
      if (drafts.length > 0) await this.db.drafts.bulkPut(drafts);
      await this.db.envelopeMetadata.put({ key: SETTINGS_KEY, sources: mergeEnvelopeMetadata(envelopeMetadata) });
    });
  }

  async clearEntries(): Promise<void> {
    await this.db.entries.clear();
  }

  // --- recovery drafts ---------------------------------------------------
  //
  // One row, one snapshot. Dexie's put is a single transaction, so a draft is
  // never half-written: either the whole snapshot is there or the previous one
  // still is.

  async putDraft(draft: EntryDraft, expected?: EntryDraft | null): Promise<void> {
    await this.db.transaction('rw', this.db.drafts, async () => {
      if (expected !== undefined) {
        const current = await this.db.drafts.get(draft.id);
        if ((expected === null && current) || (expected !== null && (!current || !sameRecord(current, expected)))) {
          throw new DraftConflictError(draft.id);
        }
      }
      await this.db.drafts.put(draft);
    });
  }

  async getDraft(id: string): Promise<EntryDraft | undefined> {
    return this.db.drafts.get(id);
  }

  async getDraftForEntry(entryId: string): Promise<EntryDraft | undefined> {
    const found = await this.db.drafts.where('entryId').equals(entryId).toArray();
    // A conflict keeps both versions. Resume the newest; every separately
    // preserved draft remains in storage and full archives.
    return found.sort(byRecency)[0];
  }

  async listDrafts(): Promise<EntryDraft[]> {
    return (await this.db.drafts.toArray()).sort(byRecency);
  }

  async deleteDraft(id: string, expected?: EntryDraft): Promise<void> {
    await this.db.transaction('rw', this.db.drafts, async () => {
      const current = await this.db.drafts.get(id);
      if (expected && current && !sameRecord(current, expected)) throw new DraftConflictError(id);
      await this.db.drafts.delete(id);
    });
  }

  async getSettings(): Promise<Settings> {
    const row = await this.db.settings.get(SETTINGS_KEY);
    if (!row) return {};
    const { key: _key, ...settings } = row;
    return settings;
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.db.transaction('rw', this.db.settings, async () => {
      const row = await this.db.settings.get(SETTINGS_KEY);
      const current = row ? (({ key: _key, ...value }) => value)(row) : {};
      const next = { ...current, ...patch };
      await this.db.settings.put({ key: SETTINGS_KEY, ...next });
      return next;
    });
  }

  async listTags(): Promise<string[]> {
    return distinctValues(await this.allEntries(), TAGS);
  }

  async listSpeakers(): Promise<string[]> {
    return distinctValues(await this.allEntries(), SPEAKERS);
  }

  async listPlaces(): Promise<string[]> {
    return distinctValues(await this.allEntries(), PLACES);
  }

  private async allEntries(): Promise<Entry[]> {
    return (await this.db.entries.toArray()).map(fromRow);
  }
}
