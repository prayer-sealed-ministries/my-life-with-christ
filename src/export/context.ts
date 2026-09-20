/**
 * The shared contract every export generator works against.
 *
 * Generators are pure, synchronous string functions. All async work — loading
 * scripture, reading the database — happens once, up front, and lands here. That
 * keeps each generator trivially testable and guarantees that the filename a
 * note is written under is the same filename every index links to.
 */

import type { Entry, EntryDraft, EntryKind, ExportFilter, OutlineBook, OutlineEntry, ScriptureRef, Topic, DataProfile} from '../types';
import type { PassageVerse } from '../lib/bible';

export interface ExportContext {
  /** Already filtered and sorted oldest-first. */
  entries: Entry[];
  /**
   * Unfinished writing, carried so the archive is not missing the newest words.
   *
   * Kept out of `entries` deliberately. Every generator that renders the
   * journal — the book, the CSV, the note files — reads `entries`, so a draft
   * cannot appear as a finished piece of writing by any of them forgetting to
   * check. Only the canonical JSON carries these, and it labels them.
   */
  drafts: EntryDraft[];
  /** Present only when something was filtered out. */
  filter?: ExportFilter;
  /** How many entries the filter excluded. Zero on a full export. */
  excludedCount: number;
  /** ISO timestamp stamped across the archive. */
  exportedAt: string;
  /** Which data profile produced this archive. */
  profile: DataProfile;

  /** Display name for every book id in the canon, outline layer or not. */
  bookNames: Map<string, string>;
  /** Canonical order (1-66) for every book id. */
  bookOrder: Map<string, number>;
  /** Outline books by id. Empty under `refs-only`. */
  outlineBooks: Map<string, OutlineBook>;
  /** Outline entries by id. Empty under `refs-only`. */
  outlineEntries: Map<string, OutlineEntry>;
  topics: Map<string, Topic>;

  /** KJV text for every ref any entry anchors to, keyed by refKey(). */
  passages: Map<string, PassageVerse[]>;
  /** entry.id -> archive path, e.g. "notes/2026-09-13--sermon--beatitudes.md". */
  noteFilenames: Map<string, string>;
}

/** Stable key for a scripture ref, used to look up preloaded passage text. */
export function refKey(ref: ScriptureRef): string {
  return `${ref.book}:${ref.chapterStart}:${ref.verseStart}:${ref.chapterEnd}:${ref.verseEnd}`;
}

/**
 * ASCII-safe, sortable, stable filename slug.
 *
 * Transliterates what it can, strips what it cannot, and never emits a name that
 * would collide with a Windows reserved device or trip a case-insensitive
 * filesystem.
 */
export function slugify(value: string, fallback = 'untitled'): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || fallback;
}

const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Build the archive path for every entry's note file.
 *
 * `YYYY-MM-DD--kind--slug.md`, sorted by the event date so the directory reads
 * chronologically in any file browser. Collisions take a numeric suffix, applied
 * in a deterministic order so the same journal always exports the same names.
 */
export function buildNoteFilenames(entries: Entry[]): Map<string, string> {
  const ordered = [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );

  const used = new Set<string>();
  const names = new Map<string, string>();

  for (const entry of ordered) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? entry.date : 'undated';
    let base = `${date}--${slugify(entry.kind, 'note')}--${slugify(entry.title, 'untitled')}`;
    if (RESERVED.has(base.toLowerCase())) base = `${base}-note`;

    let candidate = `${base}.md`;
    let suffix = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base}-${suffix}.md`;
      suffix += 1;
    }
    used.add(candidate.toLowerCase());
    names.set(entry.id, `notes/${candidate}`);
  }

  return names;
}

/** Human label for an entry kind, used in headings and indexes. */
export const KIND_LABELS: Record<EntryKind, string> = {
  sermon: 'Sermon',
  reading: 'Reading',
  service: 'Service',
  prayer: 'Prayer',
  reflection: 'Reflection',
  letter: 'Letter',
};

/** Escape a value for YAML front matter, quoting only when necessary. */
export function yamlString(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/** Escape a value for a CSV cell (RFC 4180). */
export function csvCell(value: string | number | boolean | undefined): string {
  const text = value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
