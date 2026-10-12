/**
 * The persistence semantics both providers obey, with no storage engine in it.
 *
 * WHY THIS MODULE EXISTS
 *
 * `conformance.ts` says what the contract is, as tests. This says what it is, as
 * code — the defaulting, the derived index keys, the query predicate, the
 * ordering and the tie-break. Dexie and SQLite then differ only in how rows are
 * put on a disk, never in what the answers mean.
 *
 * The alternative is what usually happens: the second provider reimplements
 * "newest first, ties broken by creation order" in SQL, gets it 95% right, and
 * the two editions disagree about the order of two entries written on the same
 * Sunday. Nobody notices until a journal is printed and the sermons are in the
 * wrong order. A shared test suite would catch that only if someone thought to
 * write that exact case; shared code cannot get it wrong in the first place.
 *
 * So the rule is: anything that could be answered differently by two correct
 * implementations lives here, and neither provider is allowed its own opinion.
 *
 * Nothing here imports Dexie, SQLite, or Capacitor. It must stay that way — the
 * native bundle should not carry IndexedDB code, and the web bundle should not
 * carry a native plugin.
 */

import type { Entry, EntryKind } from '../types';
import type { AnchorLookup, EntryQuery } from './StorageProvider';

/** Stable id. Uses crypto.randomUUID where available. */
export function newId(): string {
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

/**
 * Flatten an entry's anchors into indexable strings.
 *
 * A scripture anchor deliberately emits `book:` as well as `ref:`, which is what
 * makes "everything written about Romans" find a note anchored to Romans 8:28.
 */
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

/** The single key a lookup asks for. Mirrors what `anchorKeys` emits. */
export function anchorLookupKey(anchor: AnchorLookup): string {
  switch (anchor.kind) {
    case 'topic':
      return `topic:${anchor.topicId}`;
    case 'book':
      return `book:${anchor.book}`;
    case 'outline':
      return `outline:${anchor.outlineEntryId}`;
    default:
      return `ref:${anchor.book}:${anchor.chapterStart}:${anchor.verseStart}:${anchor.chapterEnd}:${anchor.verseEnd}`;
  }
}

/**
 * The text that free-text search runs over.
 *
 * Provided sermon notes are included, deliberately. Someone who remembers a
 * phrase from a handout should be able to find the Sunday it belongs to —
 * that is what search is for, and excluding it would make a church's outline
 * the one thing in the journal that cannot be found.
 *
 * What the index must NOT do is let that material pass for the writer's own,
 * so the views that show a result say which part matched. This function only
 * decides what is findable; `matchedIn` below decides what a result is called.
 */
export function searchableText(entry: Entry): string {
  return [
    entry.title,
    entry.notes,
    entry.reflection,
    entry.prayer ?? '',
    entry.sourceMaterial?.body ?? '',
    entry.sourceMaterial?.church ?? '',
    entry.speaker ?? '',
    entry.place ?? '',
    entry.sermonSeries ?? '',
    entry.tags.join(' '),
    entry.scriptureRefs.join(' '),
    ...entry.links.map((link) => `${link.label ?? ''} ${link.capturedTitle ?? ''}`),
  ]
    .join('\n')
    .normalize('NFC')
    .toLowerCase();
}

/** What a provider needs alongside an entry to answer a query. */
export interface IndexedEntry {
  entry: Entry;
  anchorKeys: string[];
  searchText: string;
}

/** Derive the index fields for an entry. */
export const indexed = (entry: Entry): IndexedEntry => ({
  entry,
  anchorKeys: anchorKeys(entry),
  searchText: searchableText(entry),
});

/** Does a stored entry satisfy a query? */
export function matches(row: IndexedEntry, query: EntryQuery): boolean {
  const { entry } = row;

  if (query.text) {
    const needle = query.text.trim().normalize('NFC').toLowerCase();
    if (needle && !row.searchText.includes(needle)) return false;
  }
  if (query.from && entry.date < query.from) return false;
  if (query.to && entry.date > query.to) return false;
  if (query.forDescendantsOnly && !entry.forDescendants) return false;
  if (query.kinds?.length && !query.kinds.includes(entry.kind as EntryKind)) return false;
  if (query.tags?.length && !query.tags.some((tag) => entry.tags.includes(tag))) return false;

  if (query.books?.length && !query.books.some((book) => row.anchorKeys.includes(`book:${book}`)))
    return false;
  if (
    query.topics?.length &&
    !query.topics.some((topic) => row.anchorKeys.includes(`topic:${topic}`))
  )
    return false;

  return true;
}

/**
 * Oldest first, ties broken by creation order.
 *
 * `listEntries` is the exact reverse of this, which is why it is not written
 * separately: a provider that sorted newest-first independently would have to
 * re-derive the tie-break, and that is where the two would drift apart.
 */
export const chronologically = (a: Entry, b: Entry): number =>
  a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);

/** Newest event first, which is how an anchor's notes are shown. */
export const byDateDescending = (a: Entry, b: Entry): number => b.date.localeCompare(a.date);

/** Sorted, deduplicated, blank-free — for the filter lists and export indexes. */
export function distinctValues(entries: Entry[], pick: (entry: Entry) => string[]): string[] {
  const values = new Set<string>();
  for (const entry of entries) for (const value of pick(entry)) if (value.trim()) values.add(value);
  return [...values].sort((a, b) => a.localeCompare(b));
}

/** The picks behind listTags / listSpeakers / listPlaces. */
export const TAGS = (entry: Entry): string[] => entry.tags;
export const SPEAKERS = (entry: Entry): string[] => (entry.speaker ? [entry.speaker] : []);
export const PLACES = (entry: Entry): string[] => (entry.place ? [entry.place] : []);

/** Build the entry `createEntry` would store, given caller input. */
export function entryToCreate(input: Partial<Entry>, now = new Date()): Entry {
  const timestamp = now.toISOString();
  return {
    ...EMPTY_ENTRY,
    date: todayIso(now),
    ...input,
    id: newId(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Apply a patch, refusing the two fields that are identity rather than content.
 *
 * A patch that could move `id` or `createdAt` would let an ordinary edit orphan
 * an entry, so both providers drop them rather than trusting callers.
 */
export function applyPatch(existing: Entry, patch: Partial<Entry>, now = new Date()): Entry {
  const { id: _id, createdAt: _createdAt, ...safe } = patch;
  const previous = Date.parse(existing.updatedAt);
  const requested = now.getTime();
  // Keep edit ordering monotonic even when the device clock moves backward.
  const timestamp = Number.isFinite(previous)
    ? new Date(Math.max(requested, previous + 1)).toISOString()
    : now.toISOString();
  return { ...existing, ...safe, updatedAt: timestamp };
}
