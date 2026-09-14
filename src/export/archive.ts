/**
 * Assembling the archive.
 *
 * One action produces one file: journey-export-YYYY-MM-DD.zip. Everything the
 * reader could need is inside it, and nothing inside it requires this app — or
 * any app — to read.
 *
 * The layout, and why each part exists:
 *
 *   README.txt      what this is, for a human with no context
 *   MANIFEST.txt    every file, its size and SHA-256, so damage is detectable
 *   EXPORT-NOTE.txt only when something was filtered out (see below)
 *   data/           canonical JSON, its schema, and a flat CSV
 *   notes/          one Markdown file per entry — the real archive
 *   indexes/        cross-references into notes/
 *   book/           a single self-contained HTML file that prints to PDF
 *
 * A partial export must never look complete, so a filtered archive always
 * carries EXPORT-NOTE.txt stating plainly what was left out and how much.
 */

import type { Entry, ExportFilter, JourneyExport, OutlineBook, Topic } from '../types';
import { BOOK_NAMES, BOOK_ORDER } from '../lib/canon';
import { loadPassage, type PassageVerse } from '../lib/bible';
import { buildNoteFilenames, refKey, type ExportContext } from './context';
import { renderNote } from './notes';
import { renderIndexes } from './indexes';
import { renderBook } from './book';
import { renderCsv, renderExportNote, renderReadme, renderSchema } from './readme';
import { createZip, sha256, type ZipEntry } from './zip';
import { CURRENT_VERSION } from './migrate';

export interface BuildArchiveOptions {
  entries: Entry[];
  /** Every entry in the journal, so a filtered export can say what it omitted. */
  allEntries?: Entry[];
  filter?: ExportFilter;
  outlineBooks: OutlineBook[];
  topics: Topic[];
  profile: 'full' | 'refs-only';
  now?: Date;
}

export interface BuiltArchive {
  filename: string;
  bytes: Uint8Array;
  /** File paths in the archive, for the UI to report what was written. */
  paths: string[];
  entryCount: number;
  excludedCount: number;
}

/** Does an entry pass the filter? */
export function matchesFilter(entry: Entry, filter?: ExportFilter): boolean {
  if (!filter) return true;
  if (filter.from && entry.date < filter.from) return false;
  if (filter.to && entry.date > filter.to) return false;
  if (filter.forDescendantsOnly && !entry.forDescendants) return false;
  if (filter.kinds?.length && !filter.kinds.includes(entry.kind)) return false;

  if (filter.books?.length) {
    const books = new Set(
      entry.anchors.flatMap((anchor) => (anchor.kind === 'topic' ? [] : [anchor.book])),
    );
    if (!filter.books.some((book) => books.has(book))) return false;
  }
  if (filter.topics?.length) {
    const topics = new Set(
      entry.anchors.flatMap((anchor) => (anchor.kind === 'topic' ? [anchor.topicId] : [])),
    );
    if (!filter.topics.some((topic) => topics.has(topic))) return false;
  }
  return true;
}

/** Every scripture range an entry refers to, for preloading KJV text. */
function entryRefs(entry: Entry) {
  return entry.anchors.flatMap((anchor) => (anchor.kind === 'scripture' ? [anchor] : []));
}

/** Load the KJV text for every passage any entry anchors to, once. */
async function loadPassages(entries: Entry[]): Promise<Map<string, PassageVerse[]>> {
  const wanted = new Map<string, ReturnType<typeof entryRefs>[number]>();
  for (const entry of entries) {
    for (const ref of entryRefs(entry)) wanted.set(refKey(ref), ref);
  }

  const passages = new Map<string, PassageVerse[]>();
  for (const [key, ref] of wanted) {
    try {
      passages.set(key, await loadPassage(ref));
    } catch {
      // A passage that will not load must not fail the whole export. The note
      // renders without it, and the reference itself is still recorded.
      passages.set(key, []);
    }
  }
  return passages;
}

/** Build the context every generator reads from. */
export async function buildContext(options: BuildArchiveOptions): Promise<ExportContext> {
  const entries = [...options.entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt),
  );
  const now = options.now ?? new Date();

  const outlineEntries = new Map(
    options.outlineBooks.flatMap((book) => book.entries.map((entry) => [entry.id, entry] as const)),
  );

  return {
    entries,
    filter: options.filter,
    excludedCount: Math.max(0, (options.allEntries?.length ?? entries.length) - entries.length),
    exportedAt: now.toISOString(),
    profile: options.profile,
    bookNames: new Map(Object.entries(BOOK_NAMES)),
    bookOrder: new Map(Object.entries(BOOK_ORDER)),
    outlineBooks: new Map(options.outlineBooks.map((book) => [book.id, book])),
    outlineEntries,
    topics: new Map(options.topics.map((topic) => [topic.id, topic])),
    passages: await loadPassages(entries),
    noteFilenames: buildNoteFilenames(entries),
  };
}

/** The canonical, re-importable copy of the journal. */
export function buildJourneyJson(ctx: ExportContext): JourneyExport {
  return {
    format: 'journey-export',
    version: CURRENT_VERSION,
    exportedAt: ctx.exportedAt,
    ...(ctx.filter ? { filter: ctx.filter } : {}),
    entries: ctx.entries,
  };
}

/** YYYY-MM-DD in local time, for the archive filename. */
function localDate(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * Build the whole archive.
 *
 * MANIFEST.txt is written last, since it hashes everything else. It does not
 * list itself — a file cannot contain its own hash.
 */
export async function buildArchive(options: BuildArchiveOptions): Promise<BuiltArchive> {
  const now = options.now ?? new Date();
  const ctx = await buildContext({ ...options, now });

  const files: ZipEntry[] = [];

  files.push({ path: 'README.txt', content: renderReadme(ctx) });

  const exportNote = renderExportNote(ctx);
  if (exportNote) files.push({ path: 'EXPORT-NOTE.txt', content: exportNote });

  files.push({
    path: 'data/journey.json',
    content: `${JSON.stringify(buildJourneyJson(ctx), null, 2)}\n`,
  });
  files.push({ path: 'data/schema.json', content: renderSchema() });
  files.push({ path: 'data/entries.csv', content: renderCsv(ctx) });

  for (const entry of ctx.entries) {
    const path = ctx.noteFilenames.get(entry.id);
    if (path) files.push({ path, content: renderNote(entry, ctx) });
  }

  for (const [path, content] of Object.entries(renderIndexes(ctx))) {
    files.push({ path, content });
  }

  files.push({ path: 'book/my-journey-with-God.html', content: renderBook(ctx) });

  const manifest = await renderManifest(files, ctx);
  // Second position, right after the README: a reader looking for the inventory
  // should find it without hunting.
  files.splice(1, 0, { path: 'MANIFEST.txt', content: manifest });

  return {
    filename: `journey-export-${localDate(now)}.zip`,
    bytes: await createZip(files, now),
    paths: files.map((file) => file.path),
    entryCount: ctx.entries.length,
    excludedCount: ctx.excludedCount,
  };
}

const encoder = new TextEncoder();

/** Every file, its size, and its SHA-256, so damage is detectable in 2060. */
async function renderManifest(files: ZipEntry[], ctx: ExportContext): Promise<string> {
  const books = new Set<string>();
  const topics = new Set<string>();
  for (const entry of ctx.entries) {
    for (const anchor of entry.anchors) {
      if (anchor.kind === 'topic') topics.add(anchor.topicId);
      else books.add(anchor.book);
    }
  }

  const dates = ctx.entries.map((entry) => entry.date).filter(Boolean).sort();
  const lines: string[] = [];

  lines.push('MANIFEST');
  lines.push('========');
  lines.push('');
  lines.push(`Created:        ${ctx.exportedAt}`);
  lines.push(`Entries:        ${ctx.entries.length}`);
  lines.push(`Date range:     ${dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : 'none'}`);
  lines.push(`Books touched:  ${books.size}`);
  lines.push(`Topics touched: ${topics.size}`);
  if (ctx.excludedCount > 0) {
    lines.push(`Excluded:       ${ctx.excludedCount} (see EXPORT-NOTE.txt)`);
  }
  lines.push('');
  lines.push('Each line below is: SHA-256, size in bytes, then the file path.');
  lines.push('To check a file has not been damaged, compare its SHA-256 against');
  lines.push('this list. On Mac or Linux:  shasum -a 256 <file>');
  lines.push('');
  lines.push('This manifest does not list itself — a file cannot contain its own hash.');
  lines.push('');

  for (const file of files) {
    const bytes = typeof file.content === 'string' ? encoder.encode(file.content) : file.content;
    const hash = await sha256(bytes);
    lines.push(`${hash}  ${String(bytes.length).padStart(9)}  ${file.path}`);
  }

  lines.push('');
  return lines.join('\n');
}
