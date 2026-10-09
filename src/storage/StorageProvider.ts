/**
 * The persistence seam.
 *
 * Every persistence call in the app goes through this interface. v1 has exactly
 * one implementation, backed by IndexedDB on the user's device, and makes no
 * network calls at all. v2 adds sharing — small private groups posting notes on
 * the same sermon — and that must arrive as a new implementation behind this
 * same interface, not as a rewrite of every caller.
 *
 * Hence the shapes here: everything is async, ids are caller-visible strings
 * rather than autoincrement numbers, and nothing returns a live query handle
 * that only Dexie could satisfy.
 */

import type { Entry, EntryDraft, EntryKind, NewEntry, Settings } from '../types';

/** Exact logical state observed before an atomic journal mutation. */
export interface JournalSnapshot {
  entries: Entry[];
  drafts: EntryDraft[];
}

/** Narrowing applied to a list or search. */
export interface EntryQuery {
  /** Matches title, notes, reflection, speaker, place, series, and tags. */
  text?: string;
  /** Entries anchored to any of these book ids. */
  books?: string[];
  /** Entries anchored to any of these topic ids. */
  topics?: string[];
  kinds?: EntryKind[];
  tags?: string[];
  /** Inclusive ISO date bounds on the event date. */
  from?: string;
  to?: string;
  forDescendantsOnly?: boolean;
}

export interface StorageProvider {
  /** Open and migrate. Safe to call more than once. */
  open(): Promise<void>;

  getEntry(id: string): Promise<Entry | undefined>;
  /** All entries, newest event first. */
  listEntries(query?: EntryQuery): Promise<Entry[]>;
  /** Chronological, for the timeline and the legacy view. */
  listEntriesChronological(query?: EntryQuery): Promise<Entry[]>;

  createEntry(entry: NewEntry): Promise<Entry>;
  /**
   * Update one entry in the same transaction that reads its current value.
   *
   * `expected` is the exact version the editor loaded. When another tab or
   * overlapping operation has committed since then, the provider refuses the
   * write instead of acknowledging an overwrite. Callers that do not carry a
   * previously-read version may omit it; their read/patch/write still happens
   * atomically, so disjoint concurrent patches cannot erase one another.
   */
  updateEntry(id: string, patch: Partial<Entry>, expected?: Entry): Promise<Entry>;
  /** Delete an entry and every recovery draft belonging to it, atomically. */
  deleteEntry(id: string): Promise<void>;

  /**
   * Entries carrying EXACTLY this anchor. Not a passage search.
   *
   * The name says `Exact` because the previous one did not, and that cost a
   * real defect: the passage view asked this for `{kind:'scripture', ...ref}`
   * and rendered the answer under "Your entries on this passage". An entry
   * anchored to John 15:5 was then missing from John 15:1-17, because the two
   * ranges are different keys — a reader's own note simply did not appear on
   * the passage they wrote it about.
   *
   * It is exact because it is a key lookup: `anchorKeys` on Dexie and the
   * `entry_anchor_keys` table on SQLite both index one string per anchor, and
   * range overlap is not something an equality index can answer. Making this
   * overlap would mean a scan, which is a different operation and belongs
   * where the caller can see it.
   *
   * For "what have I written about this passage", use
   * `entriesAnchoredTo(entries, ref)` in src/lib/journal-search.ts, which is
   * the one overlap implementation and is tested against the cross-chapter and
   * cross-book cases.
   *
   * Exact lookup stays because three of its four anchor kinds have no range at
   * all — a topic, a book and an outline id are identities, not spans — and
   * because the shared conformance contract holds providers to it.
   */
  findEntriesForExactAnchor(anchor: AnchorLookup): Promise<Entry[]>;

  /** Bulk write, used by import. Replaces on id collision. */
  putEntries(entries: Entry[]): Promise<void>;
  /** Used by `replace`-mode import and by the round-trip test. */
  clearEntries(): Promise<void>;
  /**
   * Swap the whole journal for another one, atomically.
   *
   * Exists because `clearEntries()` followed by `putEntries()` is two
   * transactions, and a failure between them leaves the reader with neither
   * journal — the old one deleted, the new one not written. For a replace-mode
   * restore that is the worst outcome the product can produce, and it is
   * reachable from an ordinary "restore from my archive" tap.
   *
   * Either every entry given here is the journal afterwards, or nothing changed.
   * Settings are untouched, exactly as `clearEntries` leaves them.
   */
  replaceEntries(entries: Entry[]): Promise<void>;

  /** Atomically merge a complete logical journal fragment. */
  mergeJournal(entries: Entry[], drafts: EntryDraft[], expected?: JournalSnapshot): Promise<void>;
  /** Atomically replace entries and drafts with an exact logical journal. */
  replaceJournal(entries: Entry[], drafts: EntryDraft[], expected?: JournalSnapshot): Promise<void>;

  /**
   * Work in progress, kept apart from the journal itself.
   *
   * Drafts are their own collection rather than flagged entries, so nothing
   * that reads entries — the timeline, search, the book — can show an
   * unfinished sentence by forgetting to filter. See
   * docs/ADR-CRASH-SAFE-DRAFTS.md.
   *
   * `putDraft` writes the whole snapshot in one transaction. A snapshot that
   * could be half-applied would give back a title from one keystroke and notes
   * from another, which is a worse outcome than losing the draft outright.
   */
  /** `expected: null` requires a new id; an object requires that exact prior version. */
  putDraft(draft: EntryDraft, expected?: EntryDraft | null): Promise<void>;
  getDraft(id: string): Promise<EntryDraft | undefined>;
  /** The draft holding unsaved edits to a saved entry, if there is one. */
  getDraftForEntry(entryId: string): Promise<EntryDraft | undefined>;
  /** All drafts, newest first. */
  listDrafts(): Promise<EntryDraft[]>;
  /** Idempotent: discarding something already gone is not an error. */
  deleteDraft(id: string): Promise<void>;

  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;

  /** Distinct values, for search filters and export indexes. */
  listTags(): Promise<string[]>;
  listSpeakers(): Promise<string[]>;
  listPlaces(): Promise<string[]>;
}

/** How a caller asks "what has been written about this?" */
export type AnchorLookup =
  | { kind: 'scripture'; book: string; chapterStart: number; verseStart: number; chapterEnd: number; verseEnd: number }
  | { kind: 'outline'; outlineEntryId: string }
  | { kind: 'topic'; topicId: string }
  | { kind: 'book'; book: string };
