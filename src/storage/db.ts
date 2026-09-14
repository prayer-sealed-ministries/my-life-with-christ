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

import type { Entry, EntryKind, NewEntry, Settings } from '../types';
import type { AnchorLookup, EntryQuery, StorageProvider } from './StorageProvider';

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

/** Flatten an entry's anchors into indexable strings. */
export function anchorKeys(entry: Pick<Entry, 'anchors'>): string[] {
  const keys = new Set<string>();
  for (const anchor of entry.anchors) {
    if (anchor.kind === 'topic') {
      keys.add(`topic:${anchor.topicId}`);
    } else if (anchor.kind === 'book') {
      keys.add(`book:${anchor.book}`);
    } else {
      keys.add(`book:${anchor.book}`);
      keys.add(
        `ref:${anchor.book}:${anchor.chapterStart}:${anchor.verseStart}:${anchor.chapterEnd}:${anchor.verseEnd}`,
      );
      if (anchor.outlineEntryId) keys.add(`outline:${anchor.outlineEntryId}`);
    }
  }
  return [...keys];
}

/** The text that free-text search runs over. */
export function searchableText(entry: Entry): string {
  return [
    entry.title,
    entry.notes,
    entry.reflection,
    entry.prayer ?? '',
    entry.speaker ?? '',
    entry.place ?? '',
    entry.sermonSeries ?? '',
    entry.tags.join(' '),
    entry.scriptureRefs.join(' '),
    ...entry.links.map((link) => `${link.label ?? ''} ${link.capturedTitle ?? ''}`),
  ]
    .join('\n')
    .toLowerCase();
}

type EntryRow = Entry & { anchorKeys: string[]; searchText: string };

const toRow = (entry: Entry): EntryRow => ({
  ...entry,
  anchorKeys: anchorKeys(entry),
  searchText: searchableText(entry),
});

/** Strip the derived index columns so what comes out is exactly what went in. */
const fromRow = (row: EntryRow | Entry): Entry => {
  const { anchorKeys: _a, searchText: _s, ...entry } = row as EntryRow;
  return entry as Entry;
};

/** Stable id. Uses crypto.randomUUID where available. */
function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Today, as a local ISO date — the default for a fast capture. */
export function todayIso(now = new Date()): string {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export const EMPTY_ENTRY: Omit<Entry, 'id' | 'createdAt' | 'updatedAt'> = {
  kind: 'sermon',
  title: '',
  date: '',
  anchors: [],
  scriptureRefs: [],
  notes: '',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
};

export class DexieStorageProvider implements StorageProvider {
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
      .filter((row) => matches(row, query))
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
      .map(fromRow);
  }

  async createEntry(input: NewEntry): Promise<Entry> {
    const now = new Date().toISOString();
    const entry: Entry = {
      ...EMPTY_ENTRY,
      date: todayIso(),
      ...input,
      id: newId(),
      createdAt: now,
      updatedAt: now,
    };
    await this.db.entries.put(toRow(entry));
    return entry;
  }

  async updateEntry(id: string, patch: Partial<Entry>): Promise<Entry> {
    const existing = await this.getEntry(id);
    if (!existing) throw new Error(`No entry with id ${id}`);
    // id, createdAt are not patchable: they are identity, not content.
    const { id: _id, createdAt: _createdAt, ...safe } = patch;
    const updated: Entry = { ...existing, ...safe, updatedAt: new Date().toISOString() };
    await this.db.entries.put(toRow(updated));
    return updated;
  }

  async deleteEntry(id: string): Promise<void> {
    await this.db.entries.delete(id);
  }

  async findEntriesForAnchor(anchor: AnchorLookup): Promise<Entry[]> {
    const key =
      anchor.kind === 'topic'
        ? `topic:${anchor.topicId}`
        : anchor.kind === 'book'
          ? `book:${anchor.book}`
          : anchor.kind === 'outline'
            ? `outline:${anchor.outlineEntryId}`
            : `ref:${anchor.book}:${anchor.chapterStart}:${anchor.verseStart}:${anchor.chapterEnd}:${anchor.verseEnd}`;

    const rows = (await this.db.entries.where('anchorKeys').equals(key).toArray()) as EntryRow[];
    return rows.sort((a, b) => b.date.localeCompare(a.date)).map(fromRow);
  }

  async putEntries(entries: Entry[]): Promise<void> {
    await this.db.entries.bulkPut(entries.map(toRow));
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
    return this.distinct((entry) => entry.tags);
  }

  async listSpeakers(): Promise<string[]> {
    return this.distinct((entry) => (entry.speaker ? [entry.speaker] : []));
  }

  async listPlaces(): Promise<string[]> {
    return this.distinct((entry) => (entry.place ? [entry.place] : []));
  }

  private async distinct(pick: (entry: Entry) => string[]): Promise<string[]> {
    const rows = await this.db.entries.toArray();
    const values = new Set<string>();
    for (const row of rows) for (const value of pick(row)) if (value.trim()) values.add(value);
    return [...values].sort((a, b) => a.localeCompare(b));
  }
}

/** Does a stored row satisfy a query? */
function matches(row: EntryRow, query: EntryQuery): boolean {
  if (query.text) {
    const needle = query.text.trim().toLowerCase();
    const haystack = row.searchText ?? searchableText(row);
    if (needle && !haystack.includes(needle)) return false;
  }
  if (query.from && row.date < query.from) return false;
  if (query.to && row.date > query.to) return false;
  if (query.forDescendantsOnly && !row.forDescendants) return false;
  if (query.kinds?.length && !query.kinds.includes(row.kind as EntryKind)) return false;
  if (query.tags?.length && !query.tags.some((tag) => row.tags.includes(tag))) return false;

  const keys = row.anchorKeys ?? anchorKeys(row);
  if (query.books?.length && !query.books.some((book) => keys.includes(`book:${book}`))) return false;
  if (query.topics?.length && !query.topics.some((topic) => keys.includes(`topic:${topic}`))) return false;

  return true;
}
