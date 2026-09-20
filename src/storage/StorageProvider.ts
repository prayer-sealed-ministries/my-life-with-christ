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
  updateEntry(id: string, patch: Partial<Entry>): Promise<Entry>;
  deleteEntry(id: string): Promise<void>;

  /** Entries anchored to a scripture range, an outline entry, a topic, or a book. */
  findEntriesForAnchor(anchor: AnchorLookup): Promise<Entry[]>;

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
  putDraft(draft: EntryDraft): Promise<void>;
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
