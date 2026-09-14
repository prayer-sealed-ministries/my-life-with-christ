/**
 * The archive's six indexes.
 *
 * A note file is the artefact; an index is how someone with no app, no account
 * and no search box finds one. They are plain Markdown lists with relative
 * links, so they work in a text editor, in a Markdown viewer, on a phone, and
 * printed out.
 *
 * Everything here is built from entry anchors, `ctx.bookNames`, `ctx.bookOrder`
 * and `ctx.topics` — never from the outline layer, which is empty under the
 * `refs-only` profile. An index whose shape changed with the data profile would
 * make two archives of the same journal read as two different things, so the
 * outline layer is deliberately not consulted, even where it is loaded.
 */

import type { Entry, ScriptureRef } from '../types';
import { KIND_LABELS, type ExportContext } from './context';
import { refToString } from '../lib/bible';

/** The six files this module owns, in the order they are written. */
const PATHS = {
  byDate: 'indexes/by-date.md',
  byBook: 'indexes/by-book.md',
  byTopic: 'indexes/by-topic.md',
  bySpeaker: 'indexes/by-speaker.md',
  byPlace: 'indexes/by-place.md',
  forDescendants: 'indexes/for-descendants.md',
} as const;

type IndexKey = keyof typeof PATHS;

/** Every index points back at the same folder, one level up from `indexes/`. */
const UP = '../';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Make a value safe to drop into a Markdown line.
 *
 * Only the characters that would change the *structure* of the line are
 * escaped: brackets (which would break a link), a backtick (a code span), a
 * backslash, and `<` (raw HTML). `*` and `_` are left alone on purpose — an
 * unmatched one renders as itself, and a file peppered with backslashes reads
 * worse as plain text, which is the form that has to survive.
 */
function mdInline(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`[\]<])/g, '\\$1');
}

/**
 * A user value wrapped in Markdown emphasis.
 *
 * `mdInline` leaves `*` and `_` alone because an unmatched one renders as
 * itself. That reasoning holds inside a plain line but not here: a topic
 * description containing an asterisk would close this emphasis run early and
 * scramble the rest of the line, so in this one position they are escaped.
 */
function mdEmphasis(value: string): string {
  return `*${mdInline(value).replace(/([*_])/g, '\\$1')}*`;
}

/**
 * The link to a file elsewhere in the archive, written from inside `indexes/`.
 *
 * A note's path always comes from `ctx.noteFilenames`, never re-derived, so a
 * link cannot disagree with the file that was actually written. The characters
 * that would break a Markdown link are percent-encoded rather than assumed
 * absent — `#` and `?` truncate a link target outright — so a later change to
 * the naming rules cannot quietly break every link in the archive at once.
 */
function href(archivePath: string): string {
  return UP + archivePath.replace(/[ ()#?]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** "1 entry", "12 entries", "no entries" — never "0 entries". */
function entryCount(n: number): string {
  return n === 0 ? 'no entries' : n === 1 ? '1 entry' : `${n} entries`;
}

/** "1 book", "12 books". */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Agree a verb with a count, so the honesty lines are not also ungrammatical. */
function agree(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? singular : pluralForm;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/**
 * Read an ISO date without going through `Date`.
 *
 * `new Date('2019-03-01')` is parsed as UTC midnight and then read back in local
 * time, which anywhere west of Greenwich reports as February 28th. An entry is
 * dated by the day it was where the writer stood, so the string is split by hand
 * and never touched by a timezone.
 *
 * Returns null for anything that is not a plain `YYYY-MM-DD`, including the
 * empty string — an entry can reach an old archive undated, and it must still be
 * listed rather than dropped.
 */
function parseDate(value: string): CalendarDate | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** "March 1, 2019". */
function formatDate(date: CalendarDate): string {
  return `${MONTH_NAMES[date.month - 1]} ${date.day}, ${date.year}`;
}

/** "March 1" — for lines already sitting under a year-and-month heading. */
function formatDayOfMonth(date: CalendarDate): string {
  return `${MONTH_NAMES[date.month - 1]} ${date.day}`;
}

/** What a line says where a date is missing. Said, not hidden. */
const NO_DATE = 'Date not recorded';

function dateLabel(entry: Entry): string {
  const parsed = parseDate(entry.date);
  return parsed ? formatDate(parsed) : NO_DATE;
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/**
 * A scripture reference in words, never losing what the writer recorded.
 *
 * `refToString` falls back to the bare book name whenever it cannot place a
 * reference — a book outside the vendored canon, or a chapter the book does not
 * have. In an index that is silent data loss: a line reading "Genesis" for an
 * entry anchored at Genesis 99:1-4 looks like an entry about the whole book, and
 * two entries in the same unplaceable book collapse into two identical lines.
 *
 * So when the formatter gives back nothing but the name, the numbers are printed
 * exactly as the writer stored them, and the line says why they look odd. A
 * reference we cannot resolve is still a reference someone wrote down.
 */
function refLabel(ref: ScriptureRef, bookName: string): string {
  const formatted = refToString(ref, bookName);
  // formatSpan always appends at least a chapter number, so the bare name coming
  // back is a reliable signal that the reference did not resolve.
  if (formatted !== bookName) return formatted;

  const numbers = [ref.chapterStart, ref.verseStart, ref.chapterEnd, ref.verseEnd];
  if (!numbers.every((value) => Number.isFinite(value))) return `${bookName} (reference unreadable)`;

  // Written the way `formatSpan` writes a reference that does resolve, so the
  // two kinds of line read alike: "99:1-4" within a chapter, "12:3-13:2" across.
  const start = `${ref.chapterStart}:${ref.verseStart}`;
  const end = ref.chapterEnd === ref.chapterStart ? `${ref.verseEnd}` : `${ref.chapterEnd}:${ref.verseEnd}`;
  const span = ref.chapterEnd === ref.chapterStart && ref.verseEnd === ref.verseStart ? start : `${start}-${end}`;
  return `${bookName} ${span} (as recorded; no such passage in this Bible)`;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/**
 * Sort undated entries to the end of every list rather than the start.
 *
 * An empty date string sorts before every real one, which would open a group
 * with the entries that say least. by-date.md already gathers them in a group of
 * their own at the end; this keeps every other index agreeing with it.
 */
function sortKey(entry: Entry): string {
  return parseDate(entry.date) ? entry.date.trim() : '9999-99-99';
}

/**
 * Order entries the way the whole archive orders them: oldest first, ties broken
 * by creation time and then id.
 *
 * `ctx.entries` already arrives sorted, but the indexes state the order they
 * promise rather than inherit it, and this matches `buildNoteFilenames`, so the
 * numbered suffixes on colliding filenames run in the same direction a reader
 * sees.
 */
function chronological(entries: readonly Entry[]): Entry[] {
  return [...entries].sort(compareChronologically);
}

function compareChronologically(a: Entry, b: Entry): number {
  return (
    sortKey(a).localeCompare(sortKey(b)) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

/** Which repeated field a given index uses as its heading, and so omits. */
type Omitted = 'speaker' | 'place' | undefined;

/**
 * The facts that identify an entry at a glance, always in the same order:
 * date, kind, speaker, place.
 *
 * The field an index is grouped by is left off its own lines — the heading above
 * already says it — but every other line carries all four, so a line quoted on
 * its own still says who, what, when and where.
 */
function facts(entry: Entry, when: string, omit: Omitted): string[] {
  const out = [when, KIND_LABELS[entry.kind] ?? entry.kind];
  const speaker = entry.speaker?.trim();
  const place = entry.place?.trim();
  if (speaker && omit !== 'speaker') out.push(mdInline(speaker));
  if (place && omit !== 'place') out.push(`at ${mdInline(place)}`);
  return out;
}

/**
 * One list item: the link first, then the facts.
 *
 * An entry with no filename in `ctx.noteFilenames` is listed without a link
 * rather than linked to a file that is not in the archive. A dead link inside
 * the archive is worse than a plain line, because it makes the reader think
 * something was lost. That fact joins the end of the fact run rather than
 * sitting beside the title, so the line is not cut in half by two em dashes.
 */
function entryLine(ctx: ExportContext, entry: Entry, meta: string[]): string {
  const title = mdInline(entry.title) || '(untitled)';
  const path = ctx.noteFilenames.get(entry.id);
  const parts = meta.filter((part) => part.length > 0);
  if (!path) parts.push('note file not in this archive');
  const label = path ? `[${title}](${href(path)})` : title;
  return parts.length > 0 ? `- ${label} — ${parts.join(' · ')}` : `- ${label}`;
}

// ---------------------------------------------------------------------------
// The closing block every index carries
// ---------------------------------------------------------------------------

/** The six indexes as a reader would name them, in a fixed order. */
const SIBLINGS: Array<{ key: IndexKey; file: string; label: string }> = [
  { key: 'byDate', file: 'by-date.md', label: 'by date' },
  { key: 'byBook', file: 'by-book.md', label: 'by book of the Bible' },
  { key: 'byTopic', file: 'by-topic.md', label: 'by topic' },
  { key: 'bySpeaker', file: 'by-speaker.md', label: 'by speaker' },
  { key: 'byPlace', file: 'by-place.md', label: 'by place' },
  { key: 'forDescendants', file: 'for-descendants.md', label: 'for those who come after' },
];

/**
 * The same closing block on every index.
 *
 * Any one of these six can be the first thing a stranger opens — they sit in a
 * folder together and nothing outside says which to read first. So each one ends
 * by saying where the entries themselves are, what the other five are, and which
 * file explains the whole archive. A reader should never have to already know.
 *
 * The paths are the archive layout `archive.ts` writes. They are constants here
 * rather than derived, because a link that guesses is a link that breaks.
 */
function footer(current: IndexKey): string[] {
  const others = SIBLINGS.filter((sibling) => sibling.key !== current).map(
    (sibling) => `[${sibling.label}](${sibling.file})`,
  );
  return [
    '',
    '---',
    '',
    'The entries themselves are plain text files in the `notes` folder beside this one, one file for each entry.',
    '',
    `[README.txt](${UP}README.txt) says what this archive is and how to read it with no program from anyone. [my-journey-with-God.html](${UP}book/my-journey-with-God.html) is the same journal laid out as one page you can read straight through.`,
    '',
    `The other indexes: ${others.join(' · ')}.`,
    '',
  ];
}

/** Join the assembled lines into a file, with the trailing newline a file wants. */
function file(lines: string[]): string {
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// by-date.md
// ---------------------------------------------------------------------------

/**
 * Chronological, grouped by year and then month, oldest first.
 *
 * Oldest first because read top to bottom it is a life in the order it was
 * lived. Undated entries land in a group of their own at the very end, where
 * they interrupt nothing.
 */
function renderByDate(ctx: ExportContext, entries: Entry[]): string {
  const years = new Map<number, Map<number, Entry[]>>();
  const undated: Entry[] = [];

  for (const entry of entries) {
    const date = parseDate(entry.date);
    if (!date) {
      undated.push(entry);
      continue;
    }
    let months = years.get(date.year);
    if (!months) {
      months = new Map<number, Entry[]>();
      years.set(date.year, months);
    }
    const bucket = months.get(date.month);
    if (bucket) bucket.push(entry);
    else months.set(date.month, [entry]);
  }

  const lines = [
    '# Entries by date',
    '',
    `Every entry in this journal, oldest first, grouped by the year and month it happened — ${entryCount(entries.length)}.`,
    '',
  ];

  for (const year of [...years.keys()].sort((a, b) => a - b)) {
    const months = years.get(year);
    if (!months) continue;
    lines.push(`## ${year}`, '');
    for (const month of [...months.keys()].sort((a, b) => a - b)) {
      lines.push(`### ${MONTH_NAMES[month - 1]}`, '');
      for (const entry of months.get(month) ?? []) {
        const date = parseDate(entry.date);
        lines.push(entryLine(ctx, entry, facts(entry, date ? formatDayOfMonth(date) : NO_DATE, undefined)));
      }
      lines.push('');
    }
  }

  if (undated.length > 0) {
    lines.push(
      `## ${NO_DATE}`,
      '',
      `${entryCount(undated.length)} here ${agree(undated.length, 'carries', 'carry')} no date, listed by title.`,
      '',
    );
    const byTitle = [...undated].sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    for (const entry of byTitle) {
      // The heading above already says the date is missing; the line need not.
      lines.push(entryLine(ctx, entry, facts(entry, '', undefined)));
    }
    lines.push('');
  }

  if (entries.length === 0) lines.push('This archive contains no entries.', '');

  return file([...lines, ...footer('byDate')]);
}

// ---------------------------------------------------------------------------
// by-book.md
// ---------------------------------------------------------------------------

interface BookListing {
  entry: Entry;
  /** Position of the entry's earliest anchor in this book, for ordering. */
  chapter: number;
  verse: number;
  /** Every reference this entry makes into this book, as printed. */
  refs: string[];
}

/**
 * Grouped by book of the Bible, in canonical order — Genesis to Revelation, not
 * A to Z. Anyone reaching for a book reaches for it where it sits in the Bible.
 *
 * An entry is listed under every book it anchors to, but only once per book,
 * placed at its earliest passage there and carrying all of its references into
 * that book on the one line. Two lines for the same entry under one heading
 * would read as two entries.
 */
function renderByBook(ctx: ExportContext, entries: Entry[]): string {
  const books = new Map<string, Map<string, BookListing>>();
  const listed = new Set<string>();

  for (const entry of entries) {
    for (const anchor of entry.anchors) {
      if (anchor.kind === 'topic') continue;

      const bookId = anchor.book;
      const bookName = ctx.bookNames.get(bookId) ?? bookId;

      // A whole-book anchor sits before chapter 1, because it covers all of it.
      const chapter = anchor.kind === 'book' ? 0 : anchor.chapterStart;
      const verse = anchor.kind === 'book' ? 0 : anchor.verseStart;
      // A scripture anchor carries a full ScriptureRef, so it prints the same
      // way under either data profile — no outline lookup, nothing to dangle.
      const ref = anchor.kind === 'book' ? `${bookName} (whole book)` : refLabel(anchor, bookName);

      let listings = books.get(bookId);
      if (!listings) {
        listings = new Map<string, BookListing>();
        books.set(bookId, listings);
      }

      const existing = listings.get(entry.id);
      if (!existing) {
        listings.set(entry.id, { entry, chapter, verse, refs: [ref] });
      } else {
        if (!existing.refs.includes(ref)) existing.refs.push(ref);
        if (chapter < existing.chapter || (chapter === existing.chapter && verse < existing.verse)) {
          existing.chapter = chapter;
          existing.verse = verse;
        }
      }
      listed.add(entry.id);
    }
  }

  // Canonical order. A book id with no known order goes last rather than
  // vanishing — an unplaceable book is still a book someone wrote about.
  const bookIds = [...books.keys()].sort((a, b) => {
    const orderA = ctx.bookOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
    const orderB = ctx.bookOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
    return orderA - orderB || a.localeCompare(b);
  });

  const unanchored = entries.length - listed.size;
  const across = bookIds.length > 0 ? ` across ${plural(bookIds.length, 'book', 'books')}` : '';
  const lines = [
    '# Entries by book of the Bible',
    '',
    `Every entry that names a passage, grouped by book in the order the books appear in the Bible — ${entryCount(listed.size)}${across}.`,
    '',
    // Said once, here, because chapter and verse numbers are not the same in
    // every Bible and a reader in 2060 should not have to work out which one
    // these belong to.
    'Chapter and verse numbers follow the King James Version, which is the text this archive quotes throughout.',
    '',
  ];

  if (unanchored > 0) {
    lines.push(
      `${entryCount(unanchored)} in this archive ${agree(unanchored, 'names', 'name')} no book and ${agree(unanchored, 'is', 'are')} not listed here; ${agree(unanchored, 'it appears', 'they appear')} in [by-date.md](by-date.md).`,
      '',
    );
  }

  for (const bookId of bookIds) {
    const listings = [...(books.get(bookId)?.values() ?? [])].sort(
      (a, b) =>
        a.chapter - b.chapter ||
        a.verse - b.verse ||
        // Same tie-break as `chronological`, so an undated entry falls to the
        // end of its book exactly as it falls to the end of every other index.
        // Comparing `entry.date` directly would sort it to the top instead.
        compareChronologically(a.entry, b.entry),
    );

    lines.push(`## ${mdInline(ctx.bookNames.get(bookId) ?? bookId)}`, '');
    for (const listing of listings) {
      const refs = mdInline(listing.refs.join(', '));
      lines.push(entryLine(ctx, listing.entry, [refs, ...facts(listing.entry, dateLabel(listing.entry), undefined)]));
    }
    lines.push('');
  }

  if (bookIds.length === 0) lines.push('No entry in this archive names a book of the Bible.', '');

  return file([...lines, ...footer('byBook')]);
}

// ---------------------------------------------------------------------------
// by-topic.md
// ---------------------------------------------------------------------------

/**
 * Grouped by topic, in the order the topic list itself is curated rather than
 * alphabetically — that order was chosen by hand and carries meaning.
 *
 * Topics nobody wrote under are left out entirely: a page of empty headings
 * says nothing about the journal and buries the topics that do have entries.
 */
function renderByTopic(ctx: ExportContext, entries: Entry[]): string {
  const byTopic = new Map<string, Entry[]>();
  const seen = new Map<string, Set<string>>();
  const anchored = new Set<string>();

  for (const entry of entries) {
    for (const anchor of entry.anchors) {
      if (anchor.kind !== 'topic') continue;
      const ids = seen.get(anchor.topicId) ?? new Set<string>();
      if (ids.has(entry.id)) continue; // Two anchors on the same topic are one listing.
      ids.add(entry.id);
      seen.set(anchor.topicId, ids);

      const bucket = byTopic.get(anchor.topicId);
      if (bucket) bucket.push(entry);
      else byTopic.set(anchor.topicId, [entry]);
      anchored.add(entry.id);
    }
  }

  // Curated order first; then any topic id the archive has entries for but no
  // description of, so an anchor written by a newer version is never dropped.
  const known = [...ctx.topics.keys()].filter((id) => byTopic.has(id));
  const unknown = [...byTopic.keys()].filter((id) => !ctx.topics.has(id)).sort((a, b) => a.localeCompare(b));
  const topicIds = [...known, ...unknown];

  const unanchored = entries.length - anchored.size;
  const across = topicIds.length > 0 ? ` across ${plural(topicIds.length, 'topic', 'topics')}` : '';
  const lines = [
    '# Entries by topic',
    '',
    `Every entry filed under a topic, grouped by topic — ${entryCount(anchored.size)}${across}.`,
    '',
  ];

  if (unanchored > 0) {
    lines.push(
      `${entryCount(unanchored)} in this archive ${agree(unanchored, 'is', 'are')} filed under no topic and ${agree(unanchored, 'is', 'are')} not listed here; ${agree(unanchored, 'it appears', 'they appear')} in [by-date.md](by-date.md).`,
      '',
    );
  }

  for (const topicId of topicIds) {
    const topic = ctx.topics.get(topicId);
    lines.push(`## ${mdInline(topic?.name ?? topicId)}`, '');
    if (topic?.description) lines.push(mdEmphasis(topic.description), '');
    else if (!topic) {
      lines.push(mdEmphasis(`Filed under "${topicId}". No description of this topic was exported.`), '');
    }

    for (const entry of chronological(byTopic.get(topicId) ?? [])) {
      lines.push(entryLine(ctx, entry, facts(entry, dateLabel(entry), undefined)));
    }
    lines.push('');
  }

  if (topicIds.length === 0) lines.push('No entry in this archive is filed under a topic.', '');

  return file([...lines, ...footer('byTopic')]);
}

// ---------------------------------------------------------------------------
// by-speaker.md and by-place.md
// ---------------------------------------------------------------------------

/** The heading the entries that record nothing are gathered under. */
const MISSING_HEADING = 'Not recorded';

interface FieldIndexSpec {
  key: IndexKey;
  title: string;
  /** Completes "Every entry, grouped by ...". */
  groupedBy: string;
  one: string;
  many: string;
  /** What the "Not recorded" group means for this field, in one line. */
  missingNote: string;
  emptyNote: string;
  valueOf: (entry: Entry) => string | undefined;
  omit: Omitted;
}

/**
 * Alphabetical groups, with everything the journal does not record gathered
 * under one clearly named heading at the end.
 *
 * Names that differ only in case or spelling are left as separate groups.
 * Merging "Dr. Smith" into "Smith" would be the export guessing at what a person
 * was called, and a guess written into the permanent record is worse than two
 * headings a reader can see for themselves are the same man.
 */
function renderByField(ctx: ExportContext, entries: Entry[], spec: FieldIndexSpec): string {
  const groups = new Map<string, Entry[]>();
  const missing: Entry[] = [];

  for (const entry of entries) {
    const value = spec.valueOf(entry)?.trim();
    if (!value) {
      missing.push(entry);
      continue;
    }
    const bucket = groups.get(value);
    if (bucket) bucket.push(entry);
    else groups.set(value, [entry]);
  }

  const names = [...groups.keys()].sort(
    // Case-insensitive first so "de Vries" and "De Vries" land together, then a
    // plain compare so the order is total and the file is reproducible.
    (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) || a.localeCompare(b),
  );

  const counted = entries.length - missing.length;
  const summary =
    names.length > 0
      ? `${entryCount(counted)} across ${plural(names.length, spec.one, spec.many)}${
          missing.length > 0 ? `, and ${entryCount(missing.length)} with none recorded` : ''
        }`
      : missing.length > 0
        ? `${entryCount(missing.length)}, and ${agree(missing.length, 'it does', 'they do')} not record ${spec.groupedBy}`
        : entryCount(0);

  const lines = [`# ${spec.title}`, '', `Every entry, grouped by ${spec.groupedBy} — ${summary}.`, ''];

  for (const name of names) {
    lines.push(`## ${mdInline(name)}`, '');
    for (const entry of chronological(groups.get(name) ?? [])) {
      lines.push(entryLine(ctx, entry, facts(entry, dateLabel(entry), spec.omit)));
    }
    lines.push('');
  }

  if (missing.length > 0) {
    // A speaker or place literally called "Not recorded" would otherwise produce
    // two identical headings, and nothing on the page would tell a reader which
    // entries actually recorded it. Rare, but it would be wrong forever.
    const collides = names.some((name) => name.toLowerCase() === MISSING_HEADING.toLowerCase());
    const heading = collides ? `${MISSING_HEADING} — nothing was written here` : MISSING_HEADING;
    lines.push(`## ${heading}`, '', mdEmphasis(spec.missingNote), '');
    for (const entry of chronological(missing)) {
      lines.push(entryLine(ctx, entry, facts(entry, dateLabel(entry), spec.omit)));
    }
    lines.push('');
  }

  if (entries.length === 0) lines.push(spec.emptyNote, '');

  return file([...lines, ...footer(spec.key)]);
}

// ---------------------------------------------------------------------------
// for-descendants.md
// ---------------------------------------------------------------------------

/**
 * The entries whose writer marked them to be handed on.
 *
 * This is the file a grandchild is most likely to open first, possibly without
 * knowing what any of this is, so it opens by saying so in plain words before it
 * lists anything. Where nothing was marked it says that outright: an empty list
 * under a hopeful heading would read like something had gone missing.
 */
function renderForDescendants(ctx: ExportContext, entries: Entry[]): string {
  const marked = entries.filter((entry) => entry.forDescendants === true);

  if (marked.length === 0) {
    return file([
      '# For those who come after',
      '',
      'The entries marked to be handed on — none were marked.',
      '',
      'Nobody marked an entry in this journal to be passed on. That is not the same',
      'as there being nothing here. Someone kept this journal over years: what they',
      'heard preached, what they read, what they prayed, and what it meant to them at',
      'the time. Every entry they kept is in this archive, and the indexes listed',
      'below will each take you into it. Any of them is a place to start.',
      ...footer('forDescendants'),
    ]);
  }

  const lines = [
    '# For those who come after',
    '',
    `The entries marked to be handed on, oldest first — ${entryCount(marked.length)}.`,
    '',
    'Someone kept this journal over years: what they heard preached, what they read,',
    'what they prayed, and what it meant to them at the time. The entries below are',
    'the ones they marked to be passed on, which means they were written with',
    'somebody later in mind. That may well be you.',
    '',
    'Each line links to a plain text file you can read with anything, on any',
    'computer, with no program from us and no account anywhere. The rest of the',
    'journal is here too, listed at the foot of this page.',
    '',
  ];

  for (const entry of chronological(marked)) {
    lines.push(entryLine(ctx, entry, facts(entry, dateLabel(entry), undefined)));
  }

  return file([...lines, ...footer('forDescendants')]);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Build all six indexes.
 *
 * Pure and synchronous: everything it needs — entries, book names, topics and
 * the note filenames it links to — is already in the context.
 *
 * @returns archive path -> file content, for exactly the six index files
 */
export function renderIndexes(ctx: ExportContext): Record<string, string> {
  const entries = chronological(ctx.entries);

  return {
    [PATHS.byDate]: renderByDate(ctx, entries),
    [PATHS.byBook]: renderByBook(ctx, entries),
    [PATHS.byTopic]: renderByTopic(ctx, entries),
    [PATHS.bySpeaker]: renderByField(ctx, entries, {
      key: 'bySpeaker',
      title: 'Entries by speaker',
      groupedBy: 'who was speaking',
      one: 'speaker',
      many: 'speakers',
      missingNote: 'These entries do not record who was speaking.',
      emptyNote: 'This archive contains no entries.',
      valueOf: (entry) => entry.speaker,
      omit: 'speaker',
    }),
    [PATHS.byPlace]: renderByField(ctx, entries, {
      key: 'byPlace',
      title: 'Entries by place',
      groupedBy: 'where it happened',
      one: 'place',
      many: 'places',
      missingNote: 'These entries do not record where they happened.',
      emptyNote: 'This archive contains no entries.',
      valueOf: (entry) => entry.place,
      omit: 'place',
    }),
    [PATHS.forDescendants]: renderForDescendants(ctx, entries),
  };
}
