/**
 * One Markdown file per journal entry — `notes/` inside the archive.
 *
 * This is the part of the export that has to stand entirely on its own. The
 * reader we are writing for is a grandchild in 2060 with a zip file, no app, no
 * account and no idea what this was, so every note carries three things:
 *
 * 1. Front matter holding every structured field, so the file is still machine
 *    readable after `data/journey.json` is lost or unreadable.
 * 2. The writing itself — what was taught, what it meant, what was prayed —
 *    verbatim, in clearly separated sections that are never merged.
 * 3. The full KJV text of every passage the entry points at. A note that cannot
 *    be read without also owning a Bible has failed.
 *
 * Everything here is pure and synchronous: scripture text is already loaded and
 * sitting in `ctx.passages`. Nothing in this file can fail an export.
 */

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

/** Collapse a name or id to comparable letters: "1 John", "1-john" -> "1john". */
const foldName = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * "Matthew 5:1-12", "Mark 4", "Acts 7-8", "John 3:16", "Matt 5:1-6:2".
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
 * cannot read simply goes unillustrated; the string itself is still preserved
 * verbatim in the note's front matter, so nothing is lost either way. That
 * failure mode is why no attempt is made at abbreviations ("Matt", "1 Cor"):
 * a wrong guess would quote the wrong scripture under the writer's words, which
 * is far worse than quoting none.
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
  let chapterEnd = chapterStart;
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
 * An unknown book id means this build is missing canon data, not that the
 * reference is meaningless, so the numbers are still printed rather than
 * dropped.
 */
export function describeRef(ref: ScriptureRef, ctx: ExportContext): string {
  const name = ctx.bookNames.get(ref.book) ?? ref.book;
  const counts = versification[ref.book];
  if (counts) return formatRef(ref, name, counts);

  const from = `${ref.chapterStart}:${ref.verseStart}`;
  const to = `${ref.chapterEnd}:${ref.verseEnd}`;
  return from === to ? `${name} ${from}` : `${name} ${from}-${to}`;
}

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

/** `key: value` lines for one item of a block list. */
type YamlItem = string[];

/** A block list of scalars, or `key: []` when there is nothing to list. */
function yamlScalarList(key: string, values: string[]): string[] {
  if (values.length === 0) return [`${key}: []`];
  return [`${key}:`, ...values.map((value) => `  - ${yamlString(value)}`)];
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
      `reference: ${yamlString(describeRef(anchor, ctx))}`,
      `book: ${yamlString(anchor.book)}`,
      `chapterStart: ${anchor.chapterStart}`,
      `verseStart: ${anchor.verseStart}`,
      `chapterEnd: ${anchor.chapterEnd}`,
      `verseEnd: ${anchor.verseEnd}`,
    ];
    if (anchor.outlineEntryId) item.push(`outlineEntryId: ${yamlString(anchor.outlineEntryId)}`);
    return item;
  }

  if (anchor.kind === 'topic') {
    const item = ['kind: topic', `topicId: ${yamlString(anchor.topicId)}`];
    const topic = ctx.topics.get(anchor.topicId);
    if (topic) item.push(`topic: ${yamlString(topic.name)}`);
    return item;
  }

  const item = ['kind: book', `book: ${yamlString(anchor.book)}`];
  const name = ctx.bookNames.get(anchor.book);
  if (name) item.push(`bookName: ${yamlString(name)}`);
  return item;
}

/** One link, as readable YAML. Fields absent at capture time stay absent. */
function linkItem(link: EntryLink): YamlItem {
  const item = [`url: ${yamlString(link.url)}`];
  if (link.label) item.push(`label: ${yamlString(link.label)}`);
  if (link.capturedTitle) item.push(`capturedTitle: ${yamlString(link.capturedTitle)}`);
  if (link.capturedAt) item.push(`capturedAt: ${yamlString(link.capturedAt)}`);
  return item;
}

/**
 * Every structured field on the entry, in a fixed order.
 *
 * Optional fields are omitted when they hold nothing rather than written out
 * empty: `speaker: ''` invites a reader to wonder who was erased, where no
 * `speaker` key plainly means nobody was recorded. Lists are always written,
 * empty ones as `[]`, because an absent `tags` key and a `tags: []` key read
 * the same to a parser but not to a person — the empty list says we looked.
 *
 * Links are included here as well as in the body. The body renders them for
 * reading; this renders them for a machine, and keeps the promise that a note
 * file alone carries the whole entry.
 */
function frontMatter(entry: Entry, ctx: ExportContext): string {
  const lines: string[] = ['---'];

  const scalar = (key: string, value: string | undefined): void => {
    if (value === undefined || value === '') return;
    lines.push(`${key}: ${yamlString(value)}`);
  };

  scalar('id', entry.id);
  scalar('title', entry.title);
  scalar('kind', entry.kind);
  scalar('date', entry.date);
  scalar('place', entry.place);
  scalar('speaker', entry.speaker);
  scalar('sermonSeries', entry.sermonSeries);
  lines.push(...yamlScalarList('tags', entry.tags));
  lines.push(...yamlItemList('anchors', entry.anchors.map((anchor) => anchorItem(anchor, ctx))));
  lines.push(...yamlScalarList('scriptureRefs', entry.scriptureRefs));
  lines.push(...yamlItemList('links', entry.links.map(linkItem)));
  // Booleans are written bare so they parse as booleans, not as the strings
  // "true" and "false" that yamlString would quote them into.
  lines.push(`forDescendants: ${entry.forDescendants ? 'true' : 'false'}`);
  scalar('visibility', entry.visibility);
  scalar('createdAt', entry.createdAt);
  scalar('updatedAt', entry.updatedAt);

  lines.push('---');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

/**
 * Title, then one line placing the entry in the world.
 *
 * The date is spelled out. A grandchild should not have to know that 2026-04-12
 * is a date format before they can know when this happened.
 */
function headerBlock(entry: Entry): string {
  const title = entry.title.trim() || 'Untitled';

  const parts: string[] = [KIND_LABELS[entry.kind]];
  if (entry.date.trim()) parts.push(formatEventDate(entry.date.trim()));
  if (entry.place?.trim()) parts.push(`at ${entry.place.trim()}`);
  // Labelled, because a bare name on a line of facts is a guess in fifty years.
  if (entry.speaker?.trim()) parts.push(`Speaker: ${entry.speaker.trim()}`);
  if (entry.sermonSeries?.trim()) parts.push(`Series: ${entry.sermonSeries.trim()}`);

  return `# ${title}\n\n${parts.join(' · ')}`;
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
 * captured title is the whole reason the note survives that. It is rendered
 * ahead of nothing and behind everything: the bullet leads with what a reader
 * can click, then says what it was and when that was true.
 */
function linkBullet(link: EntryLink): string {
  const parts: string[] = [];
  const url = link.url.trim();
  const label = link.label?.trim();

  if (url && label) {
    parts.push(`[${label.replace(/[[\]]/g, '\\$&')}](${linkTarget(url)})`);
  } else if (url) {
    // No label, so show the URL itself. Angle brackets make it a link when
    // rendered and cost a plain-text reader nothing.
    parts.push(`<${url.replace(/</g, '%3C').replace(/>/g, '%3E')}>`);
  } else if (label) {
    parts.push(label);
  }

  const capturedTitle = link.capturedTitle?.trim();
  if (capturedTitle) parts.push(`— "${capturedTitle}"`);

  const capturedAt = link.capturedAt?.trim();
  if (capturedAt) {
    // capturedAt is a full timestamp; the day is the part worth reading.
    const day = /^(\d{4}-\d{2}-\d{2})/.exec(capturedAt);
    parts.push(`(captured ${day ? formatEventDate(day[1]) : capturedAt})`);
  }

  return `- ${parts.join(' ')}`;
}

function linksSection(entry: Entry): string | null {
  const bullets = entry.links.map(linkBullet).filter((bullet) => bullet !== '- ');
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

/**
 * The full text of everything this entry points at.
 *
 * Scripture anchors first, in the order the writer attached them, then anything
 * cited in `scriptureRefs` that could be read as a reference. Duplicates between
 * the two collapse, so a passage that is both the anchor and the cited verse is
 * printed once.
 *
 * A reference with no text in `ctx.passages` is skipped silently rather than
 * announced. It is already listed in full in the front matter, so nothing is
 * hidden, and a heading with an apology under it is worse than no heading.
 */
function scriptureSection(entry: Entry, ctx: ExportContext): string | null {
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
  for (const cited of entry.scriptureRefs) {
    const parsed = parseScriptureRef(cited, ctx.bookNames);
    if (parsed) add(parsed);
  }

  const blocks: string[] = [];
  for (const ref of refs) {
    const verses = ctx.passages.get(refKey(ref));
    if (!verses || verses.length === 0) continue;
    blocks.push(`### ${describeRef(ref, ctx)}\n\n${renderVerses(verses)}`);
  }

  if (blocks.length === 0) return null;
  return ['## Scripture (King James Version)', KJV_NOTE, ...blocks].join('\n\n');
}

// ---------------------------------------------------------------------------

/**
 * Render one journal entry as a self-contained Markdown file.
 *
 * Sections appear in a fixed order and empty ones are dropped, so two notes are
 * comparable at a glance and no note carries a heading over nothing.
 */
export function renderNote(entry: Entry, ctx: ExportContext): string {
  const blocks = [
    frontMatter(entry, ctx),
    headerBlock(entry),
    section('Notes', entry.notes),
    // Never merged with Notes. What was taught and what it meant to me are
    // different things, and the separation is the point of the journal.
    section('Reflection', entry.reflection),
    section('Prayer', entry.prayer),
    linksSection(entry),
    scriptureSection(entry, ctx),
  ].filter((block): block is string => block !== null);

  return `${blocks.join('\n\n')}\n`;
}
