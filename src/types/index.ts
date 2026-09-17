/**
 * Domain types for Journey.
 *
 * Two rules shape everything here:
 *
 * 1. The entry is what gets handed down. Its shape is chosen for a book a
 *    grandchild can read, not for a database's convenience. It stays plain,
 *    serializable, and lossless through export/import.
 * 2. Nothing leaves the device in v1. Persistence and sharing both sit behind
 *    interfaces so v2 can add a backend without rewriting callers.
 */

// ---------------------------------------------------------------------------
// Outlines
// ---------------------------------------------------------------------------

export type Testament = 'OT' | 'NT';

/**
 * Which division scheme a build carries.
 *
 *   full       the purchased [licensed content removed] — local use only
 *   public     BSB section headings, public domain — publishable
 *   refs-only  no divisions at all; whole chapters from KJV versification
 */
export type DataProfile = 'full' | 'public' | 'refs-only';

/** How a reference was written in the source outline. */
export type ReferenceForm =
  | 'chapter'
  | 'chapter-range'
  | 'verse-range'
  | 'single-verse'
  | 'cross-chapter-verse-range';

/**
 * One outline entry: a named passage.
 *
 * `title` is verbatim from the purchased source and is never altered;
 * `displayTitle` is the readable wording the UI shows. `sourceRef` is the
 * reference exactly as printed, which may differ from `ref` where a reference
 * was adjudicated by hand.
 */
export interface OutlineEntry {
  id: string;
  ref: string;
  sourceRef: string;
  book: string;
  chapterStart: number;
  chapterEnd: number;
  verseStart?: number;
  verseEnd?: number;
  title: string;
  displayTitle: string;
  classicStory: boolean;
  series: string | null;
  /**
   * Present when a hand adjudication changed the reference.
   *
   * `alternatives` records readings that were weighed and not taken. Where the
   * source was ambiguous rather than simply wrong, the choice is visible on the
   * entry itself rather than buried in the overrides file.
   */
  adjudicated?: {
    from: string;
    confidence: string;
    reason?: string;
    alternatives?: { ref: string; rationale: string }[];
  };
  /** Present when the source reference is impossible and awaits a decision. */
  unresolved?: { confidence: string; candidates: { ref: string; rationale: string }[] };
}

export interface OutlineBook {
  id: string;
  name: string;
  testament: Testament;
  order: number;
  /** Author's prose introduction. Empty under the `refs-only` data profile. */
  intro: string;
  entries: OutlineEntry[];
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

/**
 * A scripture range, independent of any outline.
 *
 * This is the portable anchor: it means the same thing whether or not the
 * outline layer is loaded, and it survives an export/import across data
 * profiles unchanged.
 */
export interface ScriptureRef {
  book: string;
  chapterStart: number;
  verseStart: number;
  chapterEnd: number;
  verseEnd: number;
  /** Why this passage belongs to the topic that cites it. */
  note?: string;
}

/**
 * A life topic.
 *
 * Topics map to scripture refs, never to outline entry ids. That inversion is
 * deliberate: under the `refs-only` data profile the outline layer is absent
 * entirely, and a topic that pointed at outline ids would resolve to nothing.
 * The outline layer is an *enhancement* over topics — when it is present, a
 * topic's refs resolve to the outline entries they overlap, for a richer
 * display — but it is never a dependency.
 */
export interface Topic {
  id: string;
  name: string;
  /** One line on what a person is usually looking for when they pick this. */
  description: string;
  /**
   * Other words people actually search with. Nobody types the label we picked —
   * they type "worry", or "tithing". Matched exactly as the name is.
   */
  aliases: string[];
  refs: ScriptureRef[];
}

// ---------------------------------------------------------------------------
// Passages: the browse model
// ---------------------------------------------------------------------------

/**
 * A contiguous stretch of a book, as the browse UI sees it.
 *
 * The outline set does not cover the whole Bible — it leaves 286 verses across
 * 46 gaps untouched. A reader who opens Genesis 35 and finds no way to write a
 * note has hit a product bug, so a book is modelled as a complete sequence of
 * segments with no holes: every verse belongs to exactly one segment, and every
 * segment is journalable through the identical "Add entry" action.
 */
export type PassageSegment =
  | {
      kind: 'outline';
      id: string;
      ref: string;
      entry: OutlineEntry;
      chapterStart: number;
      verseStart: number;
      chapterEnd: number;
      verseEnd: number;
    }
  | {
      kind: 'uncovered';
      /** Synthesized and stable, e.g. "genesis-35-1-15", so notes can anchor to it. */
      id: string;
      ref: string;
      chapterStart: number;
      verseStart: number;
      chapterEnd: number;
      verseEnd: number;
    };

/** Verse counts per chapter, keyed by book id. */
export type Versification = Record<string, number[]>;

/** A single verse of scripture. */
export interface Verse {
  number: number;
  text: string;
}

/** One book of the KJV, as vendored under src/data/kjv/. */
export interface BibleBook {
  id: string;
  name: string;
  /** chapters[c][v] — both zero-based; verse numbers are positional. */
  chapters: string[][];
}

// ---------------------------------------------------------------------------
// The entry: the core object
// ---------------------------------------------------------------------------

export type EntryKind = 'sermon' | 'reading' | 'service' | 'prayer' | 'reflection' | 'letter';

export type Visibility = 'private' | 'shared';

/**
 * A link on an entry.
 *
 * Sermon links die. `capturedTitle` records what the link pointed to at the time
 * it was saved, so an exported note still says something useful once the URL
 * 404s. It is captured from what the user types, not fetched: v1 makes no
 * network calls at all, and a dead-link safety net is not worth breaking that.
 */
export interface EntryLink {
  url: string;
  label?: string;
  /** What this link pointed to, recorded when it was saved. */
  capturedTitle?: string;
  /** ISO timestamp when capturedTitle was recorded. */
  capturedAt?: string;
}

/**
 * What an entry is attached to.
 *
 * A passage anchor always carries a resolved scripture range, so it stays
 * meaningful with or without the outline layer. `outlineEntryId` is a secondary,
 * optional enhancement: under `refs-only` it simply has nothing to resolve
 * against, and the anchor still renders as scripture. Topic and book anchors
 * reference data that exists under every profile.
 */
export type EntryAnchor =
  | ({ kind: 'scripture'; outlineEntryId?: string } & ScriptureRef)
  | { kind: 'topic'; topicId: string }
  | { kind: 'book'; book: string };

/**
 * Where an entry came from, when it did not come from the editor.
 *
 * Optional, and absent on everything written in the app — an entry someone
 * typed here has no provenance to record. It is set only by the document
 * importer, so a note brought in from a file can still say what file, years
 * later, without the reading views having to care.
 *
 * Deliberately small and free of anything the reader should not see: no local
 * paths, no byte offsets, no stack traces. `filename` is the name the browser
 * reported for the chosen file, which the user picked themselves.
 */
export interface EntrySource {
  /** ISO timestamp of the import that created this entry. */
  importedAt: string;
  /** The name of the file it came from, as the user saw it. */
  filename: string;
  format: 'txt' | 'markdown' | 'docx' | 'pdf';
  /** Which candidate within that file, 1-based, so an order can be recovered. */
  itemIndex: number;
  /** 1-based page, where the format has pages and the text could be placed. */
  page?: number;
  /** Which parser produced it, so a later fix can find what an older one wrote. */
  parserVersion: number;
}

/**
 * A journal entry.
 *
 * `notes` and `reflection` are deliberately separate fields: what was taught,
 * and what it meant to me. They are never merged, and a reflection is never
 * shared implicitly along with notes.
 */
export interface Entry {
  id: string;
  kind: EntryKind;
  title: string;
  /** ISO date the event happened — not when it was typed. */
  date: string;
  /** "First Baptist, Tallahassee, FL", or "back porch". */
  place?: string;
  speaker?: string;
  sermonSeries?: string;
  /**
   * What this entry is about. Passage anchors always resolve to scripture, so
   * an entry written under the full profile stays fully readable after an
   * export/import into `refs-only` — no dangling anchors, no orphaned entries.
   */
  anchors: EntryAnchor[];
  /** Free-form references the user cites, parsed to links on render. */
  scriptureRefs: string[];
  /** What was said. Markdown. */
  notes: string;
  /** What it meant to me. Markdown. Deliberately separate from `notes`. */
  reflection: string;
  prayer?: string;
  links: EntryLink[];
  tags: string[];
  /** Include in the legacy export's front section. */
  forDescendants: boolean;
  /** Set only on an imported entry. Absent on anything written here. */
  source?: EntrySource;
  /** Private is the default, always. */
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  /**
   * Fields written by a version this build does not know about, preserved
   * verbatim through a forward migration. Never dropped silently, so a journal
   * written by a newer version and re-imported here loses nothing.
   */
  _unmigrated?: Record<string, unknown>;
}

/** Everything needed to create an entry; the rest is defaulted. */
export type NewEntry = Partial<Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>>;

// ---------------------------------------------------------------------------
// Export format
// ---------------------------------------------------------------------------

/**
 * The canonical export envelope — `data/journey.json` inside the archive.
 *
 * Round-trips losslessly: export -> wipe -> import must deep-equal the original.
 * This is the inheritance format. It has to stay readable and re-importable long
 * after this app stops being maintained, so it carries its own schema alongside
 * it and never relies on code to be interpretable.
 *
 * `_unmigrated` preserves fields written by a newer version verbatim, so a
 * forward migration can never silently drop data.
 */
export interface JourneyExport {
  format: 'journey-export';
  version: 1;
  exportedAt: string;
  /** Absent on a full export; present and explicit when anything was filtered. */
  filter?: ExportFilter;
  entries: Entry[];
  _unmigrated?: Record<string, unknown>;
}

/** What a selective export kept. A partial archive must never look complete. */
export interface ExportFilter {
  from?: string;
  to?: string;
  books?: string[];
  topics?: string[];
  kinds?: EntryKind[];
  forDescendantsOnly?: boolean;
}

export type ImportMode = 'merge' | 'replace';

/** What an import would do, shown before anything is written. */
export interface ImportPreview {
  mode: ImportMode;
  incoming: number;
  newEntries: number;
  updated: number;
  unchanged: number;
  /** Same id, both sides edited — newest updatedAt wins under merge. */
  conflicts: { id: string; title: string; mineUpdatedAt: string; theirsUpdatedAt: string }[];
  /** Anchors that will not resolve in this build's data profile. */
  danglingAnchors: number;
  migratedFrom?: number;
  warnings: string[];
}

/** App-level state that is not an entry. */
export interface Settings {
  /** Drives the "you have not exported" reminder. */
  lastExportAt?: string;
  reminderDismissedAt?: string;
  /**
   * How long an export stays "recent", in days — the reader's choice.
   *
   * Absent, or anything not on the offered list, means the default. It lives
   * here rather than in localStorage because it drives the export reminder,
   * and a setting that drives the reminder is not disposable: silently losing
   * it would lengthen or shorten the interval a person deliberately chose.
   */
  backupReminderDays?: number;
  theme?: 'light' | 'dark' | 'system';
}
