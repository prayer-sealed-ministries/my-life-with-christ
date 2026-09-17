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

import type { Entry, NewEntry, Settings } from '../types';
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
} from './semantics';
import type { AnchorLookup, EntryQuery, StorageProvider } from './StorageProvider';

// Re-exported for the views and tests that already import them from here. The
// definitions moved to `semantics.ts` so the SQLite provider can share them
// without importing Dexie.
export { anchorKeys, searchableText, todayIso, EMPTY_ENTRY } from './semantics';

const SETTINGS_KEY = 'singleton';

interface SettingsRow extends Settings {
  key: string;
}

class JourneyDatabase extends Dexie {
  entries!: EntityTable<Entry, 'id'>;
  settings!: EntityTable<SettingsRow, 'key'>;

  constructor(name = 'journey') {
    super(name);
    // `anchorKeys` and `searchText` are derived on write (see toRow) purely so
    // IndexedDB can index them; they are stripped on read and never exported.
    this.version(1).stores({
      entries: 'id, date, kind, speaker, place, updatedAt, *tags, *anchorKeys',
      settings: 'key',
    });
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

  async updateEntry(id: string, patch: Partial<Entry>): Promise<Entry> {
    const existing = await this.getEntry(id);
    if (!existing) throw new Error(`No entry with id ${id}`);
    const updated = applyPatch(existing, patch);
    await this.db.entries.put(toRow(updated));
    return updated;
  }

  async deleteEntry(id: string): Promise<void> {
    await this.db.entries.delete(id);
  }

  async findEntriesForAnchor(anchor: AnchorLookup): Promise<Entry[]> {
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

  async clearEntries(): Promise<void> {
    await this.db.entries.clear();
  }

  async getSettings(): Promise<Settings> {
    const row = await this.db.settings.get(SETTINGS_KEY);
    if (!row) return {};
    const { key: _key, ...settings } = row;
    return settings;
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.getSettings();
    const next = { ...current, ...patch };
    await this.db.settings.put({ key: SETTINGS_KEY, ...next });
    return next;
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
