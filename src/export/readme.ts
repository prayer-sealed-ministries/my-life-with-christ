/**
 * The files that explain the archive to a person, and the files that let a
 * machine read it without this app.
 *
 * One question shapes all four: a reader in 2060 has unzipped a folder, has
 * never heard of this app, and has nothing to log into. What has to be in front
 * of them for the journal to still make sense? README.txt is the answer for a
 * person, data/schema.json for a programmer, data/entries.csv for a
 * spreadsheet, and EXPORT-NOTE.txt for the case where the archive is not the
 * whole story and must never be mistaken for it.
 *
 * The prose here is deliberately long. It is the one file in the archive that
 * costs nothing to carry and is worth everything if the reader has no context.
 */

import type { Entry, EntryAnchor, EntryKind } from '../types';
import type { ExportContext } from './context';
import { KIND_LABELS, csvCell } from './context';
import { refToString } from '../lib/bible';
import { attributionText } from '../lib/attribution';

// ---------------------------------------------------------------------------
// Plain-text helpers
// ---------------------------------------------------------------------------

/**
 * 76 columns, not 80.
 *
 * It survives being pasted into an email, printed, or read in a terminal that
 * has added its own margin, without a second wrap turning every line into two.
 */
const WIDTH = 76;

const RULE = '-'.repeat(WIDTH);

/**
 * Hard-wrap to `width`, prefixing every line with `indent`.
 *
 * A word longer than the line is left to overflow rather than broken: the long
 * words here are filenames and references, and a filename split across two
 * lines is a filename the reader cannot type.
 */
function wrapLines(text: string, indent = '', width = WIDTH): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line === '') {
      line = word;
    } else if (indent.length + line.length + 1 + word.length <= width) {
      line = `${line} ${word}`;
    } else {
      lines.push(indent + line);
      line = word;
    }
  }
  lines.push(indent + line);
  return lines;
}

const para = (text: string, indent = ''): string => wrapLines(text, indent).join('\n');

/** A label and its description, with the description hanging under itself. */
function labelled(label: string, text: string, labelWidth: number): string {
  const head = `  ${label.padEnd(labelWidth)}`;
  const lines = wrapLines(text, ' '.repeat(head.length));
  if (lines.length === 0) return head.trimEnd();
  return [head + lines[0].slice(head.length), ...lines.slice(1)].join('\n');
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * "13 September 2026".
 *
 * Day-month-year spelled out, because 09/13/26 and 13/09/26 are the same six
 * characters to two different readers. Built from the text of the ISO string
 * rather than from `new Date()`, so the printed day is the stored day and no
 * timezone can shift it backwards overnight.
 */
function longDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso; // print what was stored rather than guess at it
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return iso;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

/** "a, b and c" — an Oxford-comma-free list, for reading aloud. */
function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`;

/** Entry dates that are real dates, sorted. Guards against a malformed date. */
function entryDates(entries: Entry[]): string[] {
  return entries
    .map((entry) => entry.date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
}

/** An archive is partial if a filter was recorded or anything was dropped. */
const isPartial = (ctx: ExportContext): boolean => ctx.filter !== undefined || ctx.excludedCount > 0;

/** Display name for a book id, falling back to the id so nothing disappears. */
const bookLabel = (ctx: ExportContext, id: string): string => ctx.bookNames.get(id) ?? id;

// ---------------------------------------------------------------------------
// README.txt
// ---------------------------------------------------------------------------

/**
 * README.txt — the first thing a stranger reads.
 *
 * Plain text, no markup of any kind, hard-wrapped. If every other file in the
 * archive were unreadable, this one would still explain what was lost.
 */
export function renderReadme(ctx: ExportContext): string {
  const blocks: string[] = [];
  const dates = entryDates(ctx.entries);
  const count = ctx.entries.length;

  blocks.push(
    [
      'MY JOURNEY WITH CHRIST',
      `A Bible journal, saved as plain files on ${longDate(ctx.exportedAt)}.`,
      `Exported ${ctx.exportedAt}`,
      RULE,
    ].join('\n'),
  );

  // The partial warning goes above everything, before the reader has settled
  // in. A reader who stops after one paragraph must still know it is partial.
  if (isPartial(ctx)) {
    const loss =
      ctx.excludedCount > 0
        ? `This archive does not hold the whole journal. ${plural(ctx.excludedCount, 'entry', 'entries')} ` +
          `${ctx.excludedCount === 1 ? 'was' : 'were'} left out of it when it was made.`
        : 'This archive was made with a filter applied, so it may not hold the ' +
          'whole journal.';

    // Promise only what EXPORT-NOTE.txt can actually deliver. With no filter
    // recorded it cannot name what is missing, and sending the reader to it for
    // an answer it does not have is worse than sending them for a warning.
    const pointer =
      ctx.filter !== undefined
        ? 'The file EXPORT-NOTE.txt, next to this one, says what the filter kept ' +
          'and what it left behind.'
        : 'The file EXPORT-NOTE.txt, next to this one, says everything that was ' +
          'recorded about what is missing, which is not much.';

    blocks.push(['IMPORTANT: THIS IS A PARTIAL COPY', '', para(`${loss} ${pointer}`, '  ')].join('\n'));
  }

  blocks.push(
    section(
      'WHAT THIS IS',
      para(
        'This is somebody\'s journal. Over years they sat in church services, ' +
          'read the Bible at home, prayed, and wrote down both what they heard ' +
          'and what it did to them. The app they wrote it in is gone, or will ' +
          'be. This archive is the part that was meant to last: ordinary files, ' +
          'readable by anything, owned by nobody, needing no internet and no ' +
          'permission from anyone.',
      ),
      para(describeContents(ctx, dates, count)),
    ),
  );

  blocks.push(
    section(
      'START HERE',
      // Deliberately says nothing about how the book lays itself out: that is
      // another generator's business, and a promise made here that it stops
      // keeping is a lie told to somebody who cannot check it.
      para(
        'Open the file book/my-journey-with-christ.html. Double-click it and it ' +
          'opens in whatever web browser the machine has; it is the whole ' +
          'journal, laid out to read front to back. It needs no internet ' +
          'connection, and nothing in it is loaded from anywhere else.',
      ),
      para(
        'If that file will not open — browsers change — nothing is lost. ' +
          'Everything in it is also in the notes folder as plain text, and all ' +
          'of it is in data/journey.json.',
      ),
    ),
  );

  blocks.push(section('WHAT IS IN HERE', inventory(ctx)));

  blocks.push(
    section(
      'READING IT WITH NOTHING BUT A TEXT EDITOR',
      para(
        'Every file in the notes folder is plain text. The .md ending stands ' +
          'for Markdown, but that is only a convention — open one in Notepad, ' +
          'TextEdit, or any editor at all and it reads straight through.',
      ),
      para(
        'Each note begins with a short block fenced above and below by three ' +
          'dashes. That block lists the facts of the entry: the date, what kind ' +
          'of entry it is, the title, who was speaking, where it happened, which ' +
          'passages it is about. The writing follows underneath.',
      ),
      // The reader has to be told which part is the writer and which part is
      // the Bible before they read a word of either. Nothing here promises more
      // than the note files hold: a part with nothing in it is simply absent.
      para(
        'Under that block the note is laid out in parts, each under its own ' +
          'heading. "Notes" is what was said or read. "Reflection" is what it ' +
          'meant to the writer, kept in a part of its own on purpose, because ' +
          'what was taught and what it did to somebody are not the same thing. ' +
          '"Prayer" and "Links" appear when the entry had them. A part with ' +
          'nothing in it is left out rather than left standing empty.',
      ),
      para(
        'Last comes "Scripture", the Bible passage the entry is about, printed ' +
          'in full so the note can be read with no Bible to hand. That part is ' +
          'quoted, and says so where it begins. Every word above it is the ' +
          'writer\'s own.',
      ),
      para(
        'In the writing you will see a few marks. A line that begins with a ' +
          'number sign is a heading. A line that begins with a hyphen is an ' +
          'item in a list. A word with a star either side of it was ' +
          'emphasised. They are shorthand a program can turn into formatting. ' +
          'Read straight past them: nothing is hidden inside them, and no text ' +
          'is missing without them.',
      ),
    ),
  );

  blocks.push(
    section(
      'THE BIBLE TEXT',
      para(
        'Where this archive quotes scripture, the text is the King James ' +
          'Version — the English translation first published in 1611, the KJV. ' +
          'It was chosen for one reason above all others: in the United States ' +
          'it is in the public domain. Nobody owns it, no permission is needed ' +
          'to copy it, and no licence can be withdrawn later. That means this ' +
          'archive can be copied, printed and handed on freely, forever, with ' +
          'the scripture still inside it.',
      ),
      para(
        '(One caution if this is ever published rather than kept: in the ' +
          'United Kingdom the KJV is still held under Crown letters patent, so ' +
          'a UK publisher would need permission. Reading it, copying it for ' +
          'your family, and keeping it are not affected.)',
      ),
    ),
  );

  // Source attribution, in the archive as well as on the site. Neither source
  // requires it; a record meant to outlive its software should carry it anyway.
  blocks.push(
    section(
      'WHERE THESE WORDS CAME FROM',
      ...attributionText(ctx.profile === 'full' ? 'outlines' : ctx.profile === 'public' ? 'sections' : 'none')
        .split('\n\n')
        .map((entry) => para(entry.replace(/\n/g, ' '))),
    ),
  );

  const refsOnly = refsOnlyNote(ctx);
  if (refsOnly) blocks.push(refsOnly);

  const descendants = descendantsNote(ctx);
  if (descendants) blocks.push(descendants);

  const privacy = privacyNote(ctx);
  if (privacy) blocks.push(privacy);

  blocks.push(
    section(
      'THE COMPLETE DATA',
      para(
        'data/journey.json is the complete machine-readable copy of this ' +
          'journal: every entry, every field, nothing summarised and nothing ' +
          'left out. Everything else in this archive was generated from it. If ' +
          'this is ever moved into another program, that is the file to hand ' +
          'over, and it is the file to trust if two of these ever disagree.',
      ),
      para(
        'data/schema.json describes journey.json field by field, in the same ' +
          'plain language as this file. It exists so that somebody who has ' +
          'never seen this app can decode the journal without guessing at what ' +
          'a field meant.',
      ),
      para(
        'data/entries.csv is a table, one row per entry, that opens in any ' +
          'spreadsheet. It is a summary and it is lossy: it carries the facts ' +
          'of each entry and the length of the writing, not the writing itself. ' +
          'The writing is in the notes folder and in journey.json.',
      ),
      // The apostrophe is otherwise unexplained punctuation sitting in front of
      // somebody's words. Say what put it there, so nobody reads it as part of
      // what was written or strips it thinking the file is corrupt.
      para(
        'One oddity in that table: where a value starts with an equals sign, a ' +
          'plus, a minus or an at sign, it is written with an apostrophe in ' +
          'front of it. Spreadsheets read those characters as the beginning of ' +
          'a calculation, and the apostrophe is what stops them. It is not part ' +
          'of what was written.',
      ),
    ),
  );

  blocks.push(
    section(
      'A LAST WORD',
      para(
        'There is nothing to install, no account to make, and nobody to ask. ' +
          'This is a folder of text files, which is the most durable thing we ' +
          'know how to make. Copy it somewhere other than where you found it, ' +
          'and it will keep.',
      ),
    ),
  );

  blocks.push(RULE);

  return `${blocks.join('\n\n')}\n`;
}

/** A heading and its paragraphs, blank-line separated. */
const section = (title: string, ...body: string[]): string => [title, ...body.filter(Boolean)].join('\n\n');

/** "It holds 124 entries, written between ... : 60 sermons, 12 readings ..." */
function describeContents(ctx: ExportContext, dates: string[], count: number): string {
  if (count === 0) {
    return (
      'This copy holds no entries at all. Either the journal was empty when ' +
      'the copy was made, or a filter was applied that matched nothing. The ' +
      'structure below is what it would have held.'
    );
  }

  const first = dates[0];
  const last = dates[dates.length - 1];
  const span =
    dates.length === 0
      ? ''
      : first === last
        ? `, written on ${longDate(first)}`
        : `, written between ${longDate(first)} and ${longDate(last)}`;

  const counts = new Map<EntryKind, number>();
  for (const entry of ctx.entries) counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);

  const kinds = (Object.keys(KIND_LABELS) as EntryKind[])
    .filter((kind) => (counts.get(kind) ?? 0) > 0)
    .map((kind) => plural(counts.get(kind) ?? 0, KIND_LABELS[kind].toLowerCase()));

  return `It holds ${plural(count, 'entry', 'entries')}${span}: ${joinList(kinds)}.`;
}

/** The folder listing, with a real note filename from this archive as example. */
function inventory(ctx: ExportContext): string {
  const sample = sampleNoteName(ctx);
  const width = 16;
  // Every path the archive writes is listed. A folder the README does not
  // account for is a folder the reader has to guess about.
  const rows = [
    labelled('README.txt', 'This file.', width),
    labelled(
      'MANIFEST.txt',
      // "every other file": the manifest cannot carry its own checksum, and it
      // says so itself. Claiming it lists everything would send a reader
      // hunting for a line that was never written.
      'A list of every other file in this archive with its size and a checksum, so damage can be spotted. Nothing needs it to be read.',
      width,
    ),
  ];

  if (isPartial(ctx)) {
    rows.push(
      labelled(
        'EXPORT-NOTE.txt',
        'What was left out of this copy. Read it before assuming the journal ends where this archive does.',
        width,
      ),
    );
  }

  rows.push(
    labelled(
      'book/',
      'The whole journal as one web page. Open my-journey-with-christ.html in any web browser. Start here.',
      width,
    ),
    // The example goes on a line of its own. A long title makes a long
    // filename, and a filename wrapped into the middle of a sentence is a
    // filename the reader cannot see whole.
    sample === null
      ? labelled(
          'notes/',
          'One plain-text file per entry, named by the date it happened, so the folder reads in order. This copy holds no entries, so there is no notes folder in it.',
          width,
        )
      : `${labelled('notes/', 'One plain-text file per entry, named by the date it happened, so the folder reads in order, like this one:', width)}\n${' '.repeat(width + 2)}${sample}`,
    labelled(
      'indexes/',
      'The same entries listed several ways over — by date, by book, by topic, by speaker, by place, and the ones written for whoever came after. Each points into the notes folder.',
      width,
    ),
    labelled('data/', 'The same journal in forms a machine can read:', width),
    labelled('  journey.json', 'The complete copy. Everything else was made from this.', width),
    labelled('  schema.json', 'What every field in journey.json means.', width),
    labelled('  entries.csv', 'One row per entry, for a spreadsheet.', width),
  );

  return rows.join('\n');
}

/**
 * A genuine filename from this archive, or null when there is none.
 *
 * Never an invented one: a name printed here is a name the reader will go
 * looking for, and an archive with no entries has no notes folder to find it
 * in. Always taken from `ctx.noteFilenames`, which is what the archive wrote.
 */
function sampleNoteName(ctx: ExportContext): string | null {
  for (const entry of ctx.entries) {
    const name = ctx.noteFilenames.get(entry.id);
    if (name) return name.replace(/^notes\//, '');
  }
  return null;
}

/**
 * Under `refs-only` the outline layer is absent — its titles and prose are
 * third-party material that cannot travel. Say so plainly, and say what is not
 * missing, so a reader does not go looking for a file that was never there.
 */
function refsOnlyNote(ctx: ExportContext): string | null {
  if (ctx.profile !== 'refs-only') return null;
  return section(
    'ABOUT THE PASSAGE NAMES',
    para(
      'This copy names every passage by book, chapter and verse — Genesis ' +
        '35:1-15, and so on — rather than by the titles of the study outline ' +
        'the writer was following. Those titles belong to their author and ' +
        'could not be copied into an archive meant to be handed on freely.',
    ),
    para(
      'Nothing of the writer\'s own is missing because of this. Every entry ' +
        'still says exactly which passage it is about, and the passage text is ' +
        'still here.',
    ),
  );
}

/** The entries written with a later reader in mind. Likely that reader is you. */
function descendantsNote(ctx: ExportContext): string | null {
  const marked = ctx.entries.filter((entry) => entry.forDescendants).length;
  if (marked === 0) return null;
  const one = marked === 1;
  return section(
    'WRITTEN FOR WHOEVER CAME AFTER',
    para(
      `${plural(marked, 'entry', 'entries')} in this archive ${one ? 'is' : 'are'} ` +
        'marked "for descendants". That was a deliberate act: the writer ' +
        `flagged ${one ? 'it as one meant' : 'these as the ones meant'} to be ` +
        'read by somebody later, rather than kept for themselves. If you read ' +
        `nothing else here, read ${one ? 'that one' : 'those'}.`,
    ),
    para(
      `The file indexes/for-descendants.md ${one ? 'holds that one' : 'gathers them together'}. ` +
        `You can also pick ${one ? 'it' : 'them'} out by the for_descendants ` +
        'column in data/entries.csv, or the forDescendants field in ' +
        'data/journey.json.',
    ),
  );
}

/** Private entries are included. Saying why is kinder than staying silent. */
function privacyNote(ctx: ExportContext): string | null {
  const private_ = ctx.entries.filter((entry) => entry.visibility === 'private').length;
  if (private_ === 0) return null;
  const one = private_ === 1;
  return section(
    'ABOUT THE PRIVATE ENTRIES',
    para(
      `${plural(private_, 'entry', 'entries')} here ${one ? 'is' : 'are'} ` +
        'marked private. In the app that meant the writer had not chosen to ' +
        `show ${one ? 'it' : 'them'} to anybody. ${one ? 'It is' : 'They are'} ` +
        'in this archive anyway, because a record with the honest parts taken ' +
        'out is not much of a record, and because this copy was made by the ' +
        'writer, on purpose, to be handed on.',
    ),
    para('Read it the way you would want yours read.'),
  );
}

// ---------------------------------------------------------------------------
// EXPORT-NOTE.txt
// ---------------------------------------------------------------------------

/**
 * EXPORT-NOTE.txt — present only when the archive is not the whole journal.
 *
 * Returns null for a complete export: a file saying "nothing was filtered"
 * sitting in every archive teaches the reader to ignore it, and this is the one
 * file that must never be ignored.
 */
export function renderExportNote(ctx: ExportContext): string | null {
  if (ctx.filter === undefined && ctx.excludedCount === 0) return null;

  const blocks: string[] = [];
  const dates = entryDates(ctx.entries);

  blocks.push(
    [
      'EXPORT NOTE: THIS IS A PARTIAL COPY',
      // The exact stamp as well as the readable one: it is what matches this
      // note to the exportedAt field in data/journey.json, and tells somebody
      // holding two partial archives which of them they are reading.
      `Made ${longDate(ctx.exportedAt)} (${ctx.exportedAt})`,
      RULE,
    ].join('\n'),
  );

  blocks.push(
    para(
      'This archive was made with a filter applied. It does not hold the ' +
        'whole journal, and it should not be read as if it did.',
    ),
  );

  const width = 20;
  const tally = [
    labelled('Entries included:', String(ctx.entries.length), width),
    labelled('Entries left out:', String(ctx.excludedCount), width),
  ];
  if (dates.length > 0) {
    tally.push(
      labelled(
        'Included dates:',
        dates[0] === dates[dates.length - 1]
          ? longDate(dates[0])
          : `${longDate(dates[0])} to ${longDate(dates[dates.length - 1])}`,
        width,
      ),
    );
  }
  blocks.push(tally.join('\n'));

  const filter = ctx.filter;
  if (!filter) {
    // Entries were dropped but no filter was recorded. Never paper over this:
    // an unexplained gap that is named is still better than one that is not.
    blocks.push(
      section(
        'WHAT WAS LEFT OUT',
        para(
          `${plural(ctx.excludedCount, 'entry', 'entries')} from the journal ` +
            'did not make it into this archive, but no record was kept of what ' +
            'the filter was. This note cannot say which entries are missing, ' +
            'only that they are missing. Treat this copy as incomplete.',
        ),
      ),
    );
  } else {
    const limits = describeLimits(ctx, filter);
    blocks.push(
      limits.length > 0
        ? section('WHAT THE FILTER KEPT', limits.join('\n'))
        : section(
            'WHAT THE FILTER KEPT',
            para(
              'A filter was recorded, but it named no limits at all. That may ' +
                'mean nothing was left out, or it may mean the limits were not ' +
                'saved. Treat this copy as possibly incomplete.',
            ),
          ),
    );
    blocks.push(
      para(
        'Anything outside those limits is not in this archive. It was not ' +
          'deleted by this export; it stayed behind in the journal this copy ' +
          'was taken from.',
      ),
    );
  }

  blocks.push(
    para(
      'The same statement in machine-readable form is the "filter" field in ' +
        'data/journey.json. If that field is present, the file is a partial ' +
        'export. If it is absent, the file is the whole journal.',
    ),
  );

  blocks.push(RULE);

  return `${blocks.join('\n\n')}\n`;
}

/** One line per limit the filter recorded, in plain words. */
function describeLimits(ctx: ExportContext, filter: NonNullable<ExportContext['filter']>): string[] {
  const width = 14;
  const lines: string[] = [];

  if (filter.from && filter.to) {
    lines.push(labelled('Dates:', `${longDate(filter.from)} through ${longDate(filter.to)}`, width));
  } else if (filter.from) {
    lines.push(labelled('Dates:', `${longDate(filter.from)} onwards; nothing earlier`, width));
  } else if (filter.to) {
    lines.push(labelled('Dates:', `up to and including ${longDate(filter.to)}; nothing later`, width));
  }

  // Unknown ids are printed raw rather than dropped. A name we cannot resolve
  // is still a clue; a silently shortened list is a lie about what is missing.
  if (filter.books && filter.books.length > 0) {
    lines.push(labelled('Books:', joinList(filter.books.map((id) => bookLabel(ctx, id))), width));
  }
  if (filter.topics && filter.topics.length > 0) {
    lines.push(
      labelled('Topics:', joinList(filter.topics.map((id) => ctx.topics.get(id)?.name ?? id)), width),
    );
  }
  if (filter.kinds && filter.kinds.length > 0) {
    lines.push(labelled('Kinds:', joinList(filter.kinds.map((kind) => KIND_LABELS[kind] ?? kind)), width));
  }
  if (filter.forDescendantsOnly) {
    lines.push(
      labelled('Marked:', 'only entries the writer marked "for descendants" were kept', width),
    );
  }

  return lines;
}

// ---------------------------------------------------------------------------
// data/schema.json
// ---------------------------------------------------------------------------

/**
 * data/schema.json — JSON Schema (draft 2020-12) for data/journey.json.
 *
 * Two audiences. A validator, which wants keywords; and a person in 2060 with
 * the JSON open in one window and this in the other, who wants sentences. Every
 * field carries a description written for the second audience, because the
 * first one will be fine either way.
 *
 * The `$id` is a URN, not an https URL. A schema that points at a domain name
 * is a schema that breaks when the domain lapses; a URN names itself and needs
 * nothing to resolve.
 *
 * Takes no context: the shape of the format does not vary by export.
 */
export function renderSchema(): string {
  const bookIdDescription =
    'A book of the Bible, as a lowercase id: "genesis", "mark", "1-samuel", ' +
    '"1-corinthians". Numbered books put the number first, and spaces become ' +
    'hyphens. There are 66, in the usual Protestant order.';

  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:journey:schema:journey-export:1',
    title: 'Journey export, format version 1',
    description:
      'The file data/journey.json inside a Journey archive: one personal Bible ' +
      'journal, exported whole. It is ordinary JSON — a text file any editor ' +
      'can open. Everything else in the archive (the book, the note files, the ' +
      'spreadsheet) was generated from it, so a reader who can decode this file ' +
      'has the entire journal.',
    $comment:
      'If you have not met JSON Schema before: this file describes another ' +
      'file. Each "properties" block lists the fields that may appear, each ' +
      '"description" says what that field means, and "required" lists the ' +
      'fields that are always there. You do not need any software to use it — ' +
      'read it alongside journey.json and it will tell you what you are ' +
      'looking at.',
    type: 'object',
    properties: {
      format: {
        type: 'string',
        const: 'journey-export',
        description:
          'Identifies the kind of file. Always the exact string ' +
          '"journey-export". Check it before trusting anything else here.',
      },
      version: {
        type: 'integer',
        const: 1,
        description:
          'Format version. This schema describes version 1. A file with a ' +
          'higher number was written by a later version of the app and may ' +
          'carry fields described nowhere here; keep any field you do not ' +
          'recognise rather than dropping it.',
      },
      exportedAt: {
        type: 'string',
        format: 'date-time',
        description:
          'When this copy was made, as an ISO 8601 timestamp. This is the date ' +
          'of the export, not of anything inside the journal.',
        examples: ['2026-09-13T14:02:11.000Z'],
      },
      filter: {
        $ref: '#/$defs/exportFilter',
        description:
          'Present only when this export left something out. Absent means the ' +
          'file holds the whole journal as it stood at exportedAt. If it is ' +
          'present, entries are missing and EXPORT-NOTE.txt in the archive ' +
          'says which.',
      },
      entries: {
        type: 'array',
        items: { $ref: '#/$defs/entry' },
        description:
          'Every entry in this export, ordered oldest first by the date the ' +
          'thing happened.',
      },
      _unmigrated: {
        type: 'object',
        description:
          'Fields written by a newer version of the app that the exporting ' +
          'version did not understand, preserved word for word so a round trip ' +
          'through an older version cannot silently lose data. Normally absent.',
      },
    },
    required: ['format', 'version', 'exportedAt', 'entries'],
    additionalProperties: false,
    $defs: {
      entry: {
        title: 'Entry',
        description:
          'One thing written down: a sermon heard, a passage read, a prayer, a ' +
          'reflection, a letter. This is the unit the whole journal is made of.',
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'Unique id for this entry within this journal, usually a UUID. It ' +
              'exists so two copies of a journal can be merged without ' +
              'duplicating anything. It carries no meaning of its own.',
          },
          kind: {
            type: 'string',
            enum: ['sermon', 'reading', 'service', 'prayer', 'reflection', 'letter'],
            description:
              'What kind of entry this is. "sermon": notes taken while somebody ' +
              'preached. "reading": the writer reading scripture on their own. ' +
              '"service": a whole service or gathering. "prayer": a prayer ' +
              'written down. "reflection": thinking on paper. "letter": written ' +
              'to a person, often to whoever would read it later.',
          },
          title: {
            type: 'string',
            description: 'What the writer called this entry.',
          },
          date: {
            type: 'string',
            description:
              'The date the thing happened, as YYYY-MM-DD — the Sunday of the ' +
              'sermon, not the day the note was typed. For that, see createdAt. ' +
              'No pattern is required of it: the app kept whatever the writer ' +
              'typed, so a value that is not a date, or an empty one, can appear ' +
              'and means the date was never pinned down.',
            examples: ['2026-09-13'],
          },
          place: {
            type: 'string',
            description:
              'Where it happened, in the writer\'s own words: "First Baptist, ' +
              'Tallahassee, FL", or "back porch". Absent when not recorded.',
          },
          speaker: {
            type: 'string',
            description: 'Who was speaking or preaching. Absent when not recorded.',
          },
          sermonSeries: {
            type: 'string',
            description:
              'The named series a sermon belonged to, when it was part of one.',
          },
          anchors: {
            type: 'array',
            items: { $ref: '#/$defs/entryAnchor' },
            description:
              'What this entry is about: passages of scripture, life topics, or ' +
              'whole books. An entry may have several, or none at all.',
          },
          scriptureRefs: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Further references the writer typed by hand, kept exactly as ' +
              'typed — "Rom 8:28", "cf. James 1". Free text: it is not ' +
              'guaranteed to parse, and it is not the same as anchors.',
          },
          notes: {
            type: 'string',
            description:
              'What was said or read: the record of the thing itself. Written ' +
              'in Markdown, a light shorthand where # starts a heading, - starts ' +
              'a list item and *stars* mark emphasis; it reads fine as it ' +
              'stands. May be empty.',
          },
          reflection: {
            type: 'string',
            description:
              'What it meant to the writer. Kept in its own field on purpose: ' +
              'what was taught and what it did to me were never meant to be the ' +
              'same thing, and a reflection is never shared implicitly along ' +
              'with notes. Markdown. May be empty.',
          },
          prayer: {
            type: 'string',
            description: 'A prayer written alongside the entry. Absent when there is none.',
          },
          links: {
            type: 'array',
            items: { $ref: '#/$defs/entryLink' },
            description:
              'Web addresses saved with the entry — a sermon recording, an ' +
              'article. Expect many to be dead by the time you read this; see ' +
              'capturedTitle.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description:
              'The writer\'s own labels, such as "grace" or "advent". There is ' +
              'no fixed vocabulary; they mean what the writer meant by them.',
          },
          forDescendants: {
            type: 'boolean',
            description:
              'True when the writer marked this entry as one meant to be handed ' +
              'on — written with a later reader in mind rather than for ' +
              'themselves.',
          },
          visibility: {
            type: 'string',
            enum: ['private', 'shared'],
            description:
              '"private" means the writer had not chosen to show this entry to ' +
              'anybody; "shared" means they had. Private is the default. It ' +
              'records an intention, not a lock: everything in this file is ' +
              'readable.',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            description: 'When the entry was first written down. ISO 8601.',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            description:
              'When the entry was last changed. ISO 8601. When two copies of a ' +
              'journal are merged, the later updatedAt wins.',
          },
          // An entry really can carry this — it is how a journal written by a
          // newer version survives a trip through an older one. Leaving it out
          // while additionalProperties is false would make this schema reject
          // the very files it describes.
          _unmigrated: {
            type: 'object',
            description:
              'Fields on this entry written by a version of the app that did ' +
              'not exist when this copy was made, kept word for word rather ' +
              'than dropped. Normally absent. Whatever is in here was somebody\'s ' +
              'data once: keep it if you rewrite this file.',
          },
        },
        required: [
          'id',
          'kind',
          'title',
          'date',
          'anchors',
          'scriptureRefs',
          'notes',
          'reflection',
          'links',
          'tags',
          'forDescendants',
          'visibility',
          'createdAt',
          'updatedAt',
        ],
        additionalProperties: false,
      },
      entryAnchor: {
        title: 'Entry anchor',
        description:
          'What an entry is attached to. Read the "kind" field first: it says ' +
          'which of the three shapes below this object has.',
        oneOf: [
          {
            title: 'Scripture anchor',
            description:
              'A passage of the Bible, written as an explicit range running ' +
              'from chapterStart:verseStart through chapterEnd:verseEnd, ' +
              'inclusive at both ends. A single verse repeats the same chapter ' +
              'and verse at both ends; a whole chapter runs from verse 1 to that ' +
              'chapter\'s last verse. The range is always spelled out in full, ' +
              'so it means the same thing on its own, with no other file needed ' +
              'to interpret it.',
            type: 'object',
            properties: {
              kind: { type: 'string', const: 'scripture', description: 'Always "scripture".' },
              book: { type: 'string', description: bookIdDescription },
              chapterStart: {
                type: 'integer',
                minimum: 1,
                description: 'First chapter of the passage, counting from 1.',
              },
              verseStart: {
                type: 'integer',
                minimum: 1,
                description: 'First verse of the passage, within chapterStart, counting from 1.',
              },
              chapterEnd: {
                type: 'integer',
                minimum: 1,
                description:
                  'Last chapter of the passage. Equal to chapterStart unless the ' +
                  'passage crosses a chapter boundary.',
              },
              verseEnd: {
                type: 'integer',
                minimum: 1,
                description: 'Last verse of the passage, within chapterEnd. Included in the range.',
              },
              outlineEntryId: {
                type: 'string',
                description:
                  'Optional link to a named passage in the study outline the ' +
                  'writer was following. That outline is third-party material and ' +
                  'is not part of every archive; when it is absent this id ' +
                  'resolves to nothing, and the range above still says exactly ' +
                  'what the entry is about. Never require it.',
              },
            },
            required: ['kind', 'book', 'chapterStart', 'verseStart', 'chapterEnd', 'verseEnd'],
            additionalProperties: false,
          },
          {
            title: 'Topic anchor',
            description:
              'A life topic — grief, forgiveness, work — rather than a ' +
              'particular passage. Topics were a way of browsing the Bible in ' +
              'the app. The id is usually readable enough to say what it was.',
            type: 'object',
            properties: {
              kind: { type: 'string', const: 'topic', description: 'Always "topic".' },
              topicId: {
                type: 'string',
                description: 'Lowercase id of the topic, such as "grief" or "forgiveness".',
              },
            },
            required: ['kind', 'topicId'],
            additionalProperties: false,
          },
          {
            title: 'Book anchor',
            description: 'A whole book of the Bible, rather than a passage within it.',
            type: 'object',
            properties: {
              kind: { type: 'string', const: 'book', description: 'Always "book".' },
              book: { type: 'string', description: bookIdDescription },
            },
            required: ['kind', 'book'],
            additionalProperties: false,
          },
        ],
      },
      entryLink: {
        title: 'Entry link',
        description: 'A web address saved with an entry.',
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The address, exactly as the writer saved it.',
          },
          label: {
            type: 'string',
            description: 'What the writer called this link. Absent when unlabelled.',
          },
          capturedTitle: {
            type: 'string',
            description:
              'What the link pointed to at the time it was saved, written down ' +
              'then so the link still says something once the address stops ' +
              'working. It was typed by the writer, never fetched: this app made ' +
              'no network calls.',
          },
          capturedAt: {
            type: 'string',
            format: 'date-time',
            description: 'When capturedTitle was recorded. ISO 8601.',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
      exportFilter: {
        title: 'Export filter',
        description:
          'What a partial export kept. Every field is a limit, and a field that ' +
          'is absent placed no limit. If this object appears in a file at all, ' +
          'entries are missing from that file.',
        type: 'object',
        properties: {
          from: {
            type: 'string',
            description: 'Earliest entry date kept, YYYY-MM-DD, included in the range.',
          },
          to: {
            type: 'string',
            description: 'Latest entry date kept, YYYY-MM-DD, included in the range.',
          },
          books: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only entries anchored to these books were kept. Book ids, as above.',
          },
          topics: {
            type: 'array',
            items: { type: 'string' },
            description: 'Only entries anchored to these topics were kept. Topic ids.',
          },
          kinds: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['sermon', 'reading', 'service', 'prayer', 'reflection', 'letter'],
            },
            description: 'Only these kinds of entry were kept.',
          },
          forDescendantsOnly: {
            type: 'boolean',
            description:
              'When true, only entries marked forDescendants were kept and ' +
              'everything else was left behind.',
          },
        },
        additionalProperties: false,
      },
    },
  };

  return `${JSON.stringify(schema, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// data/entries.csv
// ---------------------------------------------------------------------------

/**
 * The columns, in order. Spelled exactly as the archive contract names them —
 * mixed casing and all — because a column name that shifts breaks every
 * spreadsheet and script anybody ever pointed at this file.
 */
const CSV_COLUMNS = [
  'id',
  'date',
  'kind',
  'title',
  'speaker',
  'place',
  'sermonSeries',
  'anchors',
  'scripture_refs',
  'tags',
  'for_descendants',
  'visibility',
  'created_at',
  'updated_at',
  'notes_chars',
  'reflection_chars',
  'note_file',
];

/** RFC 4180 says CRLF between records, and every spreadsheet agrees. */
const CRLF = '\r\n';

/**
 * The characters a spreadsheet reads as "this cell is a calculation".
 *
 * Excel, Numbers and Google Sheets all treat a cell opening with =, +, - or @
 * (or a leading tab or carriage return) as a formula rather than as text. Two
 * things follow, and both are bad. A title the writer typed as "- and yet"
 * opens as #NAME? and their words are gone from the table; and anything
 * starting "=" is executed, so a journal that ever passed through somebody
 * else's hands could open a link or call out of the sheet on a double-click.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * A CSV cell that a spreadsheet will show rather than run.
 *
 * The apostrophe is the prefix every spreadsheet understands as "the rest of
 * this is text"; it is dropped on display and the value reads as written. It is
 * added only where it is needed, and README.txt explains it to anyone reading
 * the file raw, so it can never be mistaken for the writer's punctuation.
 */
function csvText(value: string | number | boolean | undefined): string {
  const text = value === undefined ? '' : String(value);
  return csvCell(FORMULA_LEAD.test(text) ? `'${text}` : text);
}

/**
 * data/entries.csv — one row per entry, for a spreadsheet.
 *
 * A summary, not the journal: it carries the facts of each entry and the size
 * of the writing, never the writing itself. Notes and reflections run to
 * thousands of characters with line breaks in them, and a cell is a bad home
 * for prose; journey.json and the note files hold the real text.
 */
export function renderCsv(ctx: ExportContext): string {
  const rows = [CSV_COLUMNS.join(',')];

  for (const entry of ctx.entries) {
    // Every cell goes through csvText, not csvCell. The columns that hold what
    // somebody typed are the ones that need the guard, but an id or a date read
    // back from a file written by another program is no more trustworthy than a
    // title, and a uniform rule cannot be got wrong when a column is added.
    rows.push(
      [
        csvText(entry.id),
        csvText(entry.date),
        csvText(entry.kind),
        csvText(entry.title),
        csvText(entry.speaker),
        csvText(entry.place),
        csvText(entry.sermonSeries),
        csvText(entry.anchors.map((anchor) => anchorLabel(ctx, anchor)).join('; ')),
        csvText(entry.scriptureRefs.join('; ')),
        csvText(entry.tags.join('; ')),
        csvText(entry.forDescendants),
        csvText(entry.visibility),
        csvText(entry.createdAt),
        csvText(entry.updatedAt),
        csvText(countCharacters(entry.notes)),
        csvText(countCharacters(entry.reflection)),
        // Always the filename the archive actually wrote, never a re-derived
        // one, so a link from this table can never point at a missing file.
        csvText(ctx.noteFilenames.get(entry.id) ?? ''),
      ].join(','),
    );
  }

  // The BOM is what tells Excel this file is UTF-8; without it, a name with an
  // accent in it opens as mojibake. Every other tool skips it silently.
  return `\uFEFF${rows.join(CRLF)}${CRLF}`;
}

/**
 * Characters as a person counts them, not UTF-16 code units: an accented
 * letter or an emoji counts once. Good enough as a sense of length, which is
 * all this column claims to be.
 */
const countCharacters = (text: string): number => [...text].length;

/**
 * An anchor in words, for a spreadsheet cell.
 *
 * Scripture reads as a bare reference because that is how a person says it;
 * topics and books are prefixed so a column of mixed anchors stays legible.
 * Ids that do not resolve are printed as they stand — under the refs-only
 * profile nothing outline-shaped resolves, and a blank cell would lose the
 * anchor entirely.
 */
function anchorLabel(ctx: ExportContext, anchor: EntryAnchor): string {
  if (anchor.kind === 'topic') return `Topic: ${ctx.topics.get(anchor.topicId)?.name ?? anchor.topicId}`;
  if (anchor.kind === 'book') return `Book: ${bookLabel(ctx, anchor.book)}`;

  const name = bookLabel(ctx, anchor.book);
  const formatted = refToString(anchor, name);
  // refToString gives back the bare book name for a reference it cannot place —
  // a book outside the vendored canon, or a chapter that book does not have.
  // Printing that would turn "Genesis 99:1-4" into "Genesis", which reads as an
  // entry about the whole book and collapses two unplaceable references into one
  // identical row. So the numbers the writer stored are printed instead, worded
  // exactly as indexes/ words them, so the same anchor reads the same in both.
  if (formatted !== name) return formatted;

  const numbers = [anchor.chapterStart, anchor.verseStart, anchor.chapterEnd, anchor.verseEnd];
  if (!numbers.every((value) => Number.isFinite(value))) return `${name} (reference unreadable)`;

  const start = `${anchor.chapterStart}:${anchor.verseStart}`;
  const end =
    anchor.chapterEnd === anchor.chapterStart ? `${anchor.verseEnd}` : `${anchor.chapterEnd}:${anchor.verseEnd}`;
  const span =
    anchor.chapterEnd === anchor.chapterStart && anchor.verseEnd === anchor.verseStart ? start : `${start}-${end}`;
  return `${name} ${span} (as recorded; no such passage in this Bible)`;
}
