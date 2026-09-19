/**
 * One Markdown file per journal entry — `notes/` inside the archive.
 *
 * This is the part of the export that has to stand entirely on its own. The
 * reader we are writing for is a grandchild in 2060 with a zip file, no app, no
 * account and no idea what this was, so every note carries four things:
 *
 * 1. Front matter holding every structured field, so the file is still machine
 *    readable after `data/journey.json` is lost or unreadable.
 * 2. The writing itself — what was taught, what it meant, what was prayed —
 *    verbatim, in clearly separated sections that are never merged.
 * 3. The full KJV text of every passage the entry points at. A note that cannot
 *    be read without also owning a Bible has failed.
 * 4. Everything in 1 that a person would actually want, said again in the body
 *    in plain words. Front matter is for machines; most Markdown readers hide it
 *    outright. What the entry is about, what was cited, and how it was tagged
 *    are facts about the entry, not metadata, so they are written where a human
 *    will see them.
 *
 * Everything here is pure and synchronous: scripture text is already loaded and
 * sitting in `ctx.passages`. Nothing in this file can fail an export.
 */

import { describeProvenance } from '../lib/provided-notes';
import type { Entry, EntryAnchor, EntryLink, ScriptureRef } from '../types';
import type { PassageVerse } from '../lib/bible';
import { formatRef } from '../lib/passages';
import { buildIndex, referenceSpan } from '../lib/verse-index';
import versificationData from '../data/kjv/versification.json';
import { KIND_LABELS, refKey, yamlString, type ExportContext } from './context';

/**
 * Verse counts per chapter, imported directly rather than carried on the
 * context. This is static canon data — identical under every data profile, the
 * same in 2026 and 2060 — so there is nothing for the export builder to decide
 * about it, and threading it through the context would only add a way to get it
 * wrong. It is also small: counts, not text.
 */
const versification: Record<string, number[]> = versificationData;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2026-04-12" -> "12 April 2026".
 *
 * Parsed by hand instead of through `Date`: `new Date('2026-04-12')` is UTC
 * midnight, which west of Greenwich prints as the day before — an entry dated
 * the day of the sermon would silently read as the day before it. Month names
 * are a fixed English table rather than `Intl`, so the same journal exports the
 * same words on every machine.
 *
 * Anything that is not a plain ISO day passes through untouched. An entry can
 * hold whatever the writer typed, and showing it is better than guessing at it.
 */
export function formatEventDate(value: string): string {
  const match = ISO_DATE.exec(value);
  if (!match) return value;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return value;
  return `${Number(match[3])} ${month} ${match[1]}`;
}

// ---------------------------------------------------------------------------
// Text hygiene
//
// Two places in this file cannot take an arbitrary run of whitespace: a YAML
// scalar and a single-line piece of Markdown. Neither is allowed to change a
// word — only what the writing sits on.
// ---------------------------------------------------------------------------

/**
 * Line endings, normalised before anything is written.
 *
 * `yamlString` escapes a newline but not a carriage return, and YAML reads a
 * bare CR as a line break — so a title typed on Windows would end its own quoted
 * scalar early and come back out of a parser as something other than what went
 * in. CRLF and CR collapse to LF, the one line ending everything downstream
 * already handles.
 */
const normalizeBreaks = (value: string): string => value.replace(/\r\n?/g, '\n');

/** Escape a value for YAML front matter, line endings normalised first. */
const yaml = (value: string): string => yamlString(normalizeBreaks(value));

/**
 * Fold a value onto one line.
 *
 * The `#` heading and the line of facts under it are single-line by
 * construction: a newline in a title would split the heading and leave half of
 * it reading as body text, and a newline in a place name would break the facts
 * line in two. Only whitespace is touched, never a word, and the value is still
 * written verbatim in the front matter — it is simply not allowed to break the
 * page it sits on.
 */
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

/** Collapse a name or id to comparable letters: "1 John", "1-john" -> "1john". */
const foldName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * "Matthew 5:1-12", "Mark 4", "Acts 7-8", "John 3:16", "Matthew 5:47-6:2".
 *
 * Group 1 is the book, then chapter, then optional verse, then an optional
 * range end that may or may not name its own chapter.
 */
const REF_PATTERN = /^(.+?)\s+(\d+)(?::\s*(\d+))?(?:\s*[-–—]\s*(?:(\d+)\s*:\s*)?(\d+))?$/;

/**
 * Parse one of `entry.scriptureRefs` into a portable reference.
 *
 * Those are free text — whatever the writer typed while listening — so this is
 * deliberately conservative and returns null on anything it is not sure of. It
 * is only ever used as a lookup key into `ctx.passages`, so a reference it
 * cannot read simply goes unquoted; the string itself is preserved verbatim in
 * the note's front matter and named again in the body, so nothing is lost either
 * way. That failure mode is why no attempt is made at abbreviations ("Matt",
 * "1 Cor"): a wrong guess would quote the wrong scripture under the writer's
 * words, which is far worse than quoting none.
 */
export function parseScriptureRef(text: string, bookNames: Map<string, string>): ScriptureRef | null {
  const match = REF_PATTERN.exec(text.trim().replace(/[.,;]+$/, ''));
  if (!match) return null;

  const [, bookPart, chapterText, verseText, endChapterText, endText] = match;

  const wanted = foldName(bookPart);
  let book: string | undefined;
  for (const [id, name] of bookNames) {
    // A trailing "s" is optional on the book name, because "Psalm 23" is how
    // almost everyone writes it and "Psalms 23" is how the canon spells it. No
    // book's name is another book's name plus an s, so this cannot collide.
    const folded = foldName(name);
    if (wanted === folded || wanted === folded.replace(/s$/, '') || wanted === foldName(id)) {
      book = id;
      break;
    }
  }
  if (!book) return null;

  const counts = versification[book];
  if (!counts) return null;

  const chapterStart = Number(chapterText);
  let chapterEnd: number;
  let verseStart: number;
  let verseEnd: number;

  if (verseText === undefined) {
    // No verse given, so the range end counts chapters: "Acts 7-8", not verses.
    chapterEnd = Number(endChapterText ?? endText ?? chapterText);
    verseStart = 1;
    verseEnd = counts[chapterEnd - 1];
    if (verseEnd === undefined) return null;
  } else {
    verseStart = Number(verseText);
    chapterEnd = endChapterText === undefined ? chapterStart : Number(endChapterText);
    // "John 3:16" with no range end is a single verse, not an open one.
    verseEnd = endText === undefined ? verseStart : Number(endText);
  }

  const ref = { book, chapterStart, verseStart, chapterEnd, verseEnd };
  // Bounds are checked by the same code the browse model uses, so a reference
  // this accepts means exactly what it means everywhere else in the app.
  return referenceSpan(buildIndex(counts), ref) ? ref : null;
}

/**
 * A reference as a person reads it: "Matthew 5:1-12".
 *
 * A reference can fail to resolve two ways, and neither may be allowed to
 * swallow the numbers. The book id may be unknown here — this build is missing
 * canon data. Or the range may be impossible against the book it names, which is
 * what an entry written by another build, or against outline data since
 * adjudicated, can leave behind. `formatRef` answers both with the bare book
 * name, so Genesis 99:1-4 would print as "Genesis" and read as the whole book.
 * The span is therefore checked here first and anything that does not resolve is
 * spelled out end to end. Verbose beats wrong.
 */
export function describeRef(ref: ScriptureRef, ctx: ExportContext): string {
  const name = ctx.bookNames.get(ref.book) ?? ref.book;
  const counts = versification[ref.book];
  if (counts && referenceSpan(buildIndex(counts), ref)) return formatRef(ref, name, counts);

  const from = `${ref.chapterStart}:${ref.verseStart}`;
  const to = `${ref.chapterEnd}:${ref.verseEnd}`;
  return from === to ? `${name} ${from}` : `${name} ${from}-${to}`;
}

/**
 * What one anchor is, in a handful of words.
 *
 * Used in the body, where a reader needs to know what the entry is about before
 * anything else. The outline layer is never consulted: it is absent entirely
 * under `refs-only`, and a label that appeared under one profile and vanished
 * under the other would make two copies of the same journal read differently.
 *
 * A topic or book this archive does not carry is still named by its id rather
 * than dropped, so the reader can see the entry pointed somewhere rather than
 * nowhere.
 */
function anchorLabel(anchor: EntryAnchor, ctx: ExportContext): string {
  if (anchor.kind === 'scripture') return oneLine(describeRef(anchor, ctx));
  if (anchor.kind === 'topic') {
    const topic = ctx.topics.get(anchor.topicId);
    return oneLine(`${topic ? topic.name : anchor.topicId} (topic)`);
  }
  // "(whole book)" is the wording indexes/by-book.md uses for the same thing.
  return oneLine(`${ctx.bookNames.get(anchor.book) ?? anchor.book} (whole book)`);
}

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

/** `key: value` lines for one item of a block list. */
type YamlItem = string[];

/** A block list of scalars, or `key: []` when there is nothing to list. */
function yamlScalarList(key: string, values: string[]): string[] {
  if (values.length === 0) return [`${key}: []`];
  return [`${key}:`, ...values.map((value) => `  - ${yaml(value)}`)];
}

/** A block list of maps: first line takes the dash, the rest line up under it. */
function yamlItemList(key: string, items: YamlItem[]): string[] {
  if (items.length === 0) return [`${key}: []`];
  const lines = [`${key}:`];
  for (const item of items) {
    item.forEach((line, index) => lines.push(index === 0 ? `  - ${line}` : `    ${line}`));
  }
  return lines;
}

/**
 * One anchor, as readable YAML.
 *
 * Each kind carries both a human line and its structured fields. The human line
 * matters most: `book: matthew, chapterStart: 5` is recoverable but nobody
 * reads it, whereas "Matthew 5:1-12" needs no explanation in any century.
 *
 * `outlineEntryId` appears only when the entry has one. It points into the
 * purchased outline layer, which is absent entirely under `refs-only` — so it
 * is written as a bare id and never as a resolved title, and the anchor stays
 * complete without it.
 */
function anchorItem(anchor: EntryAnchor, ctx: ExportContext): YamlItem {
  if (anchor.kind === 'scripture') {
    const item = [
      'kind: scripture',
      `reference: ${yaml(describeRef(anchor, ctx))}`,
      `book: ${yaml(anchor.book)}`,
      `chapterStart: ${anchor.chapterStart}`,
      `verseStart: ${anchor.verseStart}`,
      `chapterEnd: ${anchor.chapterEnd}`,
      `verseEnd: ${anchor.verseEnd}`,
    ];
    if (anchor.outlineEntryId) item.push(`outlineEntryId: ${yaml(anchor.outlineEntryId)}`);
    return item;
  }

  if (anchor.kind === 'topic') {
    const item = ['kind: topic', `topicId: ${yaml(anchor.topicId)}`];
    const topic = ctx.topics.get(anchor.topicId);
    if (topic) item.push(`topic: ${yaml(topic.name)}`);
    return item;
  }

  const item = ['kind: book', `book: ${yaml(anchor.book)}`];
  const name = ctx.bookNames.get(anchor.book);
  if (name) item.push(`bookName: ${yaml(name)}`);
  return item;
}

/** One link, as readable YAML. Fields absent at capture time stay absent. */
function linkItem(link: EntryLink): YamlItem {
  const item = [`url: ${yaml(link.url)}`];
  if (link.label) item.push(`label: ${yaml(link.label)}`);
  if (link.capturedTitle) item.push(`capturedTitle: ${yaml(link.capturedTitle)}`);
  if (link.capturedAt) item.push(`capturedAt: ${yaml(link.capturedAt)}`);
  return item;
}

/**
 * Every structured field on the entry, in a fixed order.
 *
 * A field the `Entry` type requires is always written, empty or not. Leaving
 * `title` out of an untitled entry would say the format has no such field, which
 * is false, and would stop the front matter alone from rebuilding the entry.
 *
 * Optional fields are the other way round: they are omitted when they hold
 * nothing rather than written out empty. `speaker: ''` invites a reader to
 * wonder who was erased, where no `speaker` key plainly means nobody was
 * recorded. They are omitted on the same test the body uses — empty once
 * trimmed — so the two halves of the file never disagree about whether there was
 * a speaker.
 *
 * Lists are always written, empty ones as `[]`, because an absent `tags` key and
 * a `tags: []` key read the same to a parser but not to a person — the empty
 * list says we looked.
 *
 * Links are included here as well as in the body. The body renders them for
 * reading; this renders them for a machine, and keeps the promise that a note
 * file alone carries the whole entry.
 */
function frontMatter(entry: Entry, ctx: ExportContext): string {
  const lines: string[] = ['---'];

  /** A field the type requires. Written verbatim, so it round-trips exactly. */
  const required = (key: string, value: string): void => {
    lines.push(`${key}: ${yaml(value)}`);
  };

  /** A field the type marks optional. Absent when there is nothing in it. */
  const optional = (key: string, value: string | undefined): void => {
    if (value === undefined || value.trim() === '') return;
    lines.push(`${key}: ${yaml(value)}`);
  };

  required('id', entry.id);
  required('title', entry.title);
  required('kind', entry.kind);
  required('date', entry.date);
  optional('place', entry.place);
  optional('speaker', entry.speaker);
  optional('sermonSeries', entry.sermonSeries);
  lines.push(...yamlScalarList('tags', entry.tags));
  lines.push(...yamlItemList('anchors', entry.anchors.map((anchor) => anchorItem(anchor, ctx))));
  lines.push(...yamlScalarList('scriptureRefs', entry.scriptureRefs));
  lines.push(...yamlItemList('links', entry.links.map(linkItem)));
  // Booleans are written bare so they parse as booleans, not as the strings
  // "true" and "false" that yamlString would quote them into.
  lines.push(`forDescendants: ${entry.forDescendants ? 'true' : 'false'}`);
  required('visibility', entry.visibility);
  required('createdAt', entry.createdAt);
  required('updatedAt', entry.updatedAt);
  // Fields written by a version this build does not understand. They are
  // carried as a JSON string rather than mapped into YAML, because their shape
  // is by definition unknown and a guess at it could lose or reshape them.
  // JSON inside YAML is still readable by hand and by any parser; dropping the
  // field, in the file the family is meant to keep, would not be.
  if (entry._unmigrated && Object.keys(entry._unmigrated).length > 0) {
    lines.push(`_unmigrated: ${yaml(JSON.stringify(entry._unmigrated))}`);
  }

  lines.push('---');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

/**
 * Title, then one line placing the entry in the world, then what it is about.
 *
 * The date is spelled out. A grandchild should not have to know that 2026-04-12
 * is a date format before they can know when this happened.
 *
 * The "About" line exists because the anchors are the answer to the first
 * question anybody asks of an entry, and until now they lived only in the front
 * matter — which many Markdown readers hide, and which nobody reads for pleasure
 * in any case. It also means a passage whose text could not be included is still
 * named in the body rather than vanishing from it.
 */
function headerBlock(entry: Entry, ctx: ExportContext): string {
  const title = oneLine(entry.title) || 'Untitled';

  const date = oneLine(entry.date);
  const place = oneLine(entry.place ?? '');
  const speaker = oneLine(entry.speaker ?? '');
  const series = oneLine(entry.sermonSeries ?? '');

  const facts: string[] = [KIND_LABELS[entry.kind]];
  if (date) facts.push(formatEventDate(date));
  if (place) facts.push(`at ${place}`);
  // Labelled, because a bare name on a line of facts is a guess in fifty years.
  if (speaker) facts.push(`Speaker: ${speaker}`);
  if (series) facts.push(`Series: ${series}`);

  const blocks = [`# ${title}`, facts.join(' · ')];

  // Two identical anchors say nothing twice, so the labels are de-duplicated
  // while the anchors themselves stay exactly as written in the front matter.
  const about = [...new Set(entry.anchors.map((anchor) => anchorLabel(anchor, ctx)))];
  if (about.length > 0) blocks.push(`About: ${about.join(' · ')}`);

  return blocks.join('\n\n');
}

/**
 * A `## Heading` over verbatim markdown, or nothing at all.
 *
 * Only surrounding blank space is touched — the writing inside is exactly what
 * was typed. An empty section is dropped rather than left as a bare heading: a
 * "## Reflection" with nothing under it reads as something lost.
 */
function section(title: string, body: string | undefined): string | null {
  const text = (body ?? '').trim();
  return text ? `## ${title}\n\n${text}` : null;
}

/**
 * A link destination Markdown will not mangle.
 *
 * Angle brackets around anything with a space or a parenthesis in it, which is
 * the CommonMark form for exactly that case; literal angle brackets inside the
 * URL are percent-encoded first so they cannot end the destination early.
 */
function linkTarget(url: string): string {
  const safe = url.replace(/</g, '%3C').replace(/>/g, '%3E');
  return /[\s()]/.test(safe) ? `<${safe}>` : safe;
}

/**
 * One link, written so it still says something once the URL dies.
 *
 * Sermon links die — a church changes its website, a video host folds — and the
 * captured title is the whole reason the note survives that. The bullet leads
 * with what a reader can click, then says what it was and when that was true.
 * When there is nothing to click and nothing labelled, the captured title leads
 * instead: a bullet opening on an em dash attached to nothing reads as damage.
 *
 * Null when the link holds nothing a reader could use. A bullet saying only
 * "(captured 13 April 2026)" names neither a destination nor a thing; the
 * fields are still in the front matter, where a machine can see them.
 */
function linkBullet(link: EntryLink): string | null {
  const parts: string[] = [];
  const url = oneLine(link.url);
  const label = oneLine(link.label ?? '');
  const capturedTitle = oneLine(link.capturedTitle ?? '');

  if (url && label) {
    parts.push(`[${label.replace(/[[\]]/g, '\\$&')}](${linkTarget(url)})`);
  } else if (url) {
    // No label, so show the URL itself. Angle brackets make it a link when
    // rendered and cost a plain-text reader nothing.
    parts.push(`<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`);
  } else if (label) {
    parts.push(label);
  }

  if (capturedTitle) {
    parts.push(parts.length === 0 ? `"${capturedTitle}"` : `— "${capturedTitle}"`);
  }
  if (parts.length === 0) return null;

  const capturedAt = oneLine(link.capturedAt ?? '');
  if (capturedAt) {
    // capturedAt is a full timestamp; the day is the part worth reading.
    const day = /^(\d{4}-\d{2}-\d{2})/.exec(capturedAt);
    parts.push(`(captured ${day ? formatEventDate(day[1]) : capturedAt})`);
  }

  return `- ${parts.join(' ')}`;
}

function linksSection(entry: Entry): string | null {
  const bullets = entry.links
    .map(linkBullet)
    .filter((bullet): bullet is string => bullet !== null);
  return bullets.length ? `## Links\n\n${bullets.join('\n')}` : null;
}

const KJV_NOTE =
  '*The passages below are the King James Version, reproduced in full so this note can be read ' +
  'without a Bible to hand. They are scripture, not the writer\'s words.*';

/**
 * Verses as "**3** Blessed are the poor in spirit...", one per line.
 *
 * One verse per line is for the plain-text reader — opened in Notepad in 2060,
 * a passage stays a numbered list instead of a wall. A Markdown renderer folds
 * those lines back into one flowing paragraph with bold verse numbers, which is
 * how a Bible sets a column anyway, so both readings come out right.
 *
 * The chapter appears in the number only when the passage crosses a chapter
 * boundary; printing "5:3" on every verse of a single chapter is noise.
 */
function renderVerses(verses: PassageVerse[]): string {
  const spansChapters = verses[0].chapter !== verses[verses.length - 1].chapter;
  return verses
    .map((verse) => {
      const label = spansChapters ? `${verse.chapter}:${verse.number}` : String(verse.number);
      // Whitespace only: a stray newline inside a verse would break the one
      // verse per line rule. No word of the text is changed.
      return `**${label}** ${verse.text.replace(/\s+/g, ' ').trim()}`;
    })
    .join('\n');
}

/** What the scripture pass found: text to quote, and citations it could not. */
interface ScriptureResult {
  /** The `## Scripture` section, or null when nothing resolved to text. */
  section: string | null;
  /**
   * Free-text citations from `entry.scriptureRefs` whose text is not quoted
   * above — unparseable, or parseable but absent from this archive. Named in
   * the body verbatim so a reader still learns what the writer was pointing at.
   */
  unquoted: string[];
}

/**
 * The full text of everything this entry points at.
 *
 * Scripture anchors first, in the order the writer attached them, then anything
 * cited in `scriptureRefs` that could be read as a reference. Duplicates between
 * the two collapse, so a passage that is both the anchor and the cited verse is
 * printed once.
 *
 * A reference with no text in `ctx.passages` is not announced here — a heading
 * with an apology under it is worse than no heading. Nothing is hidden by that:
 * an anchor is already named on the "About" line, and a citation comes back in
 * `unquoted` to be named in its own line. Both routes print the reference; this
 * one is only about whether the verses themselves are available to print.
 */
function scriptureSection(entry: Entry, ctx: ExportContext): ScriptureResult {
  const refs: ScriptureRef[] = [];
  const seen = new Set<string>();

  const add = (ref: ScriptureRef): void => {
    const key = refKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };

  for (const anchor of entry.anchors) {
    if (anchor.kind === 'scripture') add(anchor);
  }

  // Parsed once, and the result kept: the same list decides both what gets
  // quoted and what has to be named as unquoted, so the two can never disagree.
  const citations = entry.scriptureRefs
    .map((raw) => oneLine(raw))
    .filter((text) => text !== '')
    .map((text) => ({ text, ref: parseScriptureRef(text, ctx.bookNames) }));

  for (const citation of citations) {
    if (citation.ref) add(citation.ref);
  }

  const quoted = new Set<string>();
  const blocks: string[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    const verses = ctx.passages.get(key);
    if (!verses || verses.length === 0) continue;
    quoted.add(key);
    blocks.push(`### ${describeRef(ref, ctx)}\n\n${renderVerses(verses)}`);
  }

  const unquoted = [
    ...new Set(
      citations
        .filter((citation) => !citation.ref || !quoted.has(refKey(citation.ref)))
        .map((citation) => citation.text),
    ),
  ];

  return {
    section: blocks.length === 0 ? null : ['## Scripture (King James Version)', KJV_NOTE, ...blocks].join('\n\n'),
    unquoted,
  };
}

/**
 * Scripture the writer cited that this archive does not quote.
 *
 * Their words, not ours, and not resolved to anything — quoting the wrong
 * chapter under someone's notes is worse than quoting none, so a reference that
 * could not be read with certainty is simply repeated as it was written.
 */
function mentionedLine(unquoted: string[]): string | null {
  if (unquoted.length === 0) return null;
  return `Also mentioned: ${unquoted.join('; ')}`;
}

/**
 * The writer's own filing words.
 *
 * In the body as well as the front matter: a tag is how this entry was found
 * again, which is a fact about it worth reading, not machinery.
 */
function tagsLine(entry: Entry): string | null {
  const tags = entry.tags.map((tag) => oneLine(tag)).filter(Boolean);
  return tags.length ? `Tags: ${tags.join(', ')}` : null;
}

/**
 * Sermon notes somebody else provided, under a heading that says so.
 *
 * The heading is "Provided notes" and never "Notes", and the attribution line
 * sits directly under it. A stranger opening this file in 2060 must be able to
 * tell in one line which paragraphs the journal's owner wrote — that is the
 * whole reason the field exists, and a Markdown file with no styling has only
 * its words to do it with.
 */
function providedSection(entry: Entry): string | null {
  const material = entry.sourceMaterial;
  if (!material?.body.trim()) return null;

  const facts = [describeProvenance(material)];
  if (material.speaker) facts.push(`Speaker: ${oneLine(material.speaker)}`);
  if (material.date) facts.push(formatEventDate(material.date));
  if (material.scripture?.length) facts.push(material.scripture.map(oneLine).join(', '));
  facts.push(`Imported from ${oneLine(material.filename)}`);

  return [
    '## Provided notes',
    '',
    `*${facts.filter(Boolean).join(' · ')}. This section is not the writer's own words.*`,
    '',
    material.body.trim(),
  ].join('\n');
}

// ---------------------------------------------------------------------------

/**
 * Render one journal entry as a self-contained Markdown file.
 *
 * Sections appear in a fixed order and empty ones are dropped, so two notes are
 * comparable at a glance and no note carries a heading over nothing. The writing
 * comes first and the scripture last: the entry is the point, and the passages
 * are there so it can be understood without a Bible, not so they can lead.
 */
export function renderNote(entry: Entry, ctx: ExportContext): string {
  const scripture = scriptureSection(entry, ctx);

  const blocks = [
    frontMatter(entry, ctx),
    headerBlock(entry, ctx),
    // Before the writer's own words, and unmistakably labelled as not theirs.
    // First because it is what they were handed and wrote in response to, and
    // because a reader who meets it after "## Notes" has already been told,
    // wrongly, whose words they are reading.
    providedSection(entry),
    section('Notes', entry.notes),
    // Never merged with Notes. What was taught and what it meant to me are
    // different things, and the separation is the point of the journal.
    section('Reflection', entry.reflection),
    section('Prayer', entry.prayer),
    linksSection(entry),
    mentionedLine(scripture.unquoted),
    tagsLine(entry),
    scripture.section,
  ].filter((block): block is string => block !== null);

  return `${blocks.join('\n\n')}\n`;
}
