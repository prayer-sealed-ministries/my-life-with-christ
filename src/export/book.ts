/**
 * The book: `book/my-journey-with-God.html`.
 *
 * One file, and the whole journal is in it. No script, no stylesheet, no font,
 * no image, nothing fetched from anywhere — open it from a USB stick on a
 * machine that has never seen a network and it reads exactly as it does today.
 * That constraint is the whole design. A grandchild in 2060 has a browser and a
 * printer; assume nothing else survived.
 *
 * Everything a reader needs is printed inline, including the scripture itself,
 * so the book never says "look this up". Where the app knows something the
 * reader cannot be expected to know — what the KJV is, what the rest of the zip
 * holds, what was left out of a partial export — the book says it in plain
 * words rather than assuming.
 */

import type { Entry, EntryAnchor, EntryLink, EntryKind, ScriptureRef } from '../types';
import type { PassageVerse } from '../lib/bible';
import { formatRef } from '../lib/passages';
// The JSON directly, not `bible.ts`: that module carries the lazy `import.meta.glob`
// loader for the whole KJV, and this generator must stay pure and synchronous.
// Verse counts are unaffected by the data profile — they ship under both.
import versificationData from '../data/kjv/versification.json';
import { KIND_LABELS, refKey, type ExportContext } from './context';

const versification = versificationData as Record<string, number[]>;

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * Escape text for HTML, in text content and in attribute values alike.
 *
 * Quotes are escaped too, so a single pass is safe in both positions and no
 * caller has to remember which context it is in. Everything a user typed goes
 * through here; nothing else is ever concatenated into the document.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * An href we are willing to emit, or null.
 *
 * The book is a local file a reader opens by double-clicking, which is exactly
 * the situation where a `javascript:` or `data:` URL saved years ago is worth
 * refusing. Only the three schemes that mean "a place" are allowed through;
 * anything else is shown as plain text instead, so the value is still visible
 * and nothing is silently dropped.
 */
function safeHref(url: string): string | null {
  const trimmed = url.trim();
  return /^(?:https?:\/\/|mailto:)/i.test(trimmed) ? escapeHtml(trimmed) : null;
}

// ---------------------------------------------------------------------------
// A small markdown renderer
// ---------------------------------------------------------------------------

/**
 * Inline markup, matched in one ordered pass.
 *
 * Bold comes before italic so `**x**` is not read as an empty italic. The
 * underscore forms require a non-word character on each side, so `file_name_2`
 * and `snake_case` survive untouched — people write those in notes.
 */
const INLINE =
  /`([^`\n]+)`|\[([^\]\n]+)\]\(\s*([^)\s]+)\s*\)|\*\*([^*\n]+)\*\*|(?<![A-Za-z0-9])__([^_\n]+)__(?![A-Za-z0-9])|\*([^*\n]+)\*|(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])/g;

/**
 * Render one line of markdown inline markup.
 *
 * The safety property is structural, not a filter: the source string is never
 * copied into the output. Every literal run between matches is escaped, every
 * captured span is escaped, and the only unescaped characters emitted are the
 * tags written literally below. Raw HTML a user typed therefore cannot survive
 * as markup — it comes out as visible text, which is the honest outcome for a
 * journal.
 */
function renderInline(raw: string): string {
  let out = '';
  let cursor = 0;
  INLINE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = INLINE.exec(raw)) !== null) {
    out += escapeHtml(raw.slice(cursor, match.index));
    const [, code, linkText, linkUrl, boldStar, boldScore, italicStar, italicScore] = match;

    if (code !== undefined) {
      out += `<code>${escapeHtml(code)}</code>`;
    } else if (linkText !== undefined && linkUrl !== undefined) {
      const href = safeHref(linkUrl);
      out += href
        ? `<a href="${href}" rel="noreferrer">${escapeHtml(linkText)}</a>`
        : // Refused scheme: keep both halves as text so nothing is lost.
          `${escapeHtml(linkText)} (${escapeHtml(linkUrl)})`;
    } else if (boldStar !== undefined || boldScore !== undefined) {
      out += `<strong>${escapeHtml(boldStar ?? boldScore ?? '')}</strong>`;
    } else {
      out += `<em>${escapeHtml(italicStar ?? italicScore ?? '')}</em>`;
    }

    cursor = INLINE.lastIndex;
  }

  return out + escapeHtml(raw.slice(cursor));
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^\s{0,6}[-*+]\s+(.*)$/;
const NUMBERED = /^\s{0,6}(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const BLANK = /^\s*$/;

/** True when a line would start a new block, so a paragraph run must stop. */
function startsBlock(line: string): boolean {
  return (
    BLANK.test(line) ||
    RULE.test(line) ||
    HEADING.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line)
  );
}

/**
 * Render the small subset of markdown people actually type in a journal.
 *
 * Paragraphs, line breaks, emphasis, code spans, links, bullet and numbered
 * lists, block quotes and rules. No nesting, no tables, no images, no raw HTML.
 * A markdown library is not worth a runtime dependency the archive would have
 * to outlive, and anything this renderer does not understand degrades to the
 * literal characters the writer typed — which is still readable prose.
 *
 * `#` headings become bold paragraphs rather than real heading elements. An
 * entry's content sits under an `h4`, and a user's stray `#` must not be
 * allowed to inject an `h1` and wreck the document outline.
 */
export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (BLANK.test(line)) {
      i += 1;
      continue;
    }

    if (RULE.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      out.push(`<p class="md-heading"><strong>${renderInline(heading[2])}</strong></p>`);
      i += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && !BLANK.test(lines[i])) {
        const inner = QUOTE.exec(lines[i]);
        // A lazy continuation line (no `>`) belongs to the quote it follows.
        quoted.push(inner ? inner[1] : lines[i].trim());
        i += 1;
      }
      out.push(`<blockquote><p>${quoted.map(renderInline).join('<br>')}</p></blockquote>`);
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = !bullet;
      const start = numbered ? Number(numbered[1]) : 1;
      // The line we matched on is consumed here rather than inside the loop, so
      // the list always makes progress and the outer walk can never stall.
      const items: string[] = [ordered ? numbered![2] : bullet![1]];
      i += 1;

      while (i < lines.length && !BLANK.test(lines[i])) {
        const asBullet = BULLET.exec(lines[i]);
        const asNumbered = NUMBERED.exec(lines[i]);
        if (ordered ? asNumbered : asBullet) {
          items.push(ordered ? asNumbered![2] : asBullet![1]);
        } else if (asBullet || asNumbered) {
          break; // the other kind of list starts here; let the next pass take it
        } else {
          // A wrapped item: markdown joins the continuation onto the item above.
          items[items.length - 1] += ` ${lines[i].trim()}`;
        }
        i += 1;
      }

      const tag = ordered ? 'ol' : 'ul';
      const open = ordered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
      out.push(`${open}${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`);
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && !startsBlock(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    // Every newline inside a paragraph is a real break. People write notes in
    // ragged lines under a preacher and mean them to stay ragged.
    out.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
  }

  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface CivilDate {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

/**
 * Parse `YYYY-MM-DD` as a plain calendar date.
 *
 * Built through `Date.UTC`, never `new Date('2026-03-01')`, because the latter
 * is midnight UTC and renders as the previous day for anyone west of Greenwich.
 * A journal that quietly moves a Sunday to a Saturday is a bug the reader can
 * see. The round-trip check also rejects 2026-02-30 and its friends.
 */
function parseDate(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day, weekday: utc.getUTCDay() };
}

/** "March 1, 2026", or the raw value when it is not a date we understand. */
function longDate(value: string): string {
  const date = parseDate(value);
  return date ? `${MONTHS[date.month - 1]} ${date.day}, ${date.year}` : value;
}

/** "Sunday, March 1, 2026" — the weekday matters in a journal kept on Sundays. */
function fullDate(value: string): string {
  const date = parseDate(value);
  return date ? `${WEEKDAYS[date.weekday]}, ${longDate(value)}` : value;
}

/** A date with its machine-readable `datetime`, or plain text if unparseable. */
function dateElement(value: string): string {
  const text = escapeHtml(fullDate(value));
  return parseDate(value) ? `<time datetime="${escapeHtml(value)}">${text}</time>` : text;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------

function bookName(ctx: ExportContext, id: string): string {
  return ctx.bookNames.get(id) ?? id;
}

/**
 * A scripture reference as a reader would say it.
 *
 * Falls back to spelling out both ends when the book is not in the versification
 * table — an imported entry from a future version, say. Verbose beats wrong.
 */
function refLabel(ctx: ExportContext, ref: ScriptureRef): string {
  const name = bookName(ctx, ref.book);
  const counts = versification[ref.book];
  if (counts) return formatRef(ref, name, counts);
  return ref.chapterStart === ref.chapterEnd
    ? `${name} ${ref.chapterStart}:${ref.verseStart}-${ref.verseEnd}`
    : `${name} ${ref.chapterStart}:${ref.verseStart}-${ref.chapterEnd}:${ref.verseEnd}`;
}

/**
 * The outline title for a scripture anchor, when there is one.
 *
 * Under `refs-only` the outline layer is absent and this is always empty — the
 * passage heading then stands on chapter and verse alone, which reads correctly
 * on its own. The field checks are deliberate: a `refs-only` archive re-imported
 * elsewhere can carry outline entries whose title fields were stripped.
 */
function outlineTitle(ctx: ExportContext, anchor: EntryAnchor): string {
  if (anchor.kind !== 'scripture' || !anchor.outlineEntryId) return '';
  const outline = ctx.outlineEntries.get(anchor.outlineEntryId);
  return outline ? (outline.displayTitle || outline.title || '') : '';
}

// ---------------------------------------------------------------------------
// Entry parts
// ---------------------------------------------------------------------------

function kindLabel(kind: EntryKind): string {
  return KIND_LABELS[kind] ?? kind;
}

function entryTitle(entry: Entry): string {
  const title = entry.title.trim();
  if (title) return title;
  // Untitled entries still need a name in the contents and at the top of a page.
  return `${kindLabel(entry.kind)}, ${longDate(entry.date)}`;
}

/**
 * The anchor id for an entry, borrowed from its note filename.
 *
 * Tying the two together means `#2026-03-01--sermon--beatitudes` in the book and
 * `notes/2026-03-01--sermon--beatitudes.md` in the archive are visibly the same
 * entry, which is what a reader cross-referencing the two folders needs. The
 * filenames are already unique and already deterministic.
 */
function entryAnchorId(ctx: ExportContext, entry: Entry, index: number, prefix: string): string {
  const file = ctx.noteFilenames.get(entry.id);
  const stem = file ? file.replace(/^notes\//, '').replace(/\.md$/, '') : `${index + 1}`;
  return `${prefix}-${stem.replace(/[^A-Za-z0-9._-]/g, '-')}`;
}

/** The date, kind and circumstances of an entry, as an inline list. */
function renderMeta(entry: Entry): string {
  const items = [dateElement(entry.date), escapeHtml(kindLabel(entry.kind))];
  if (entry.place?.trim()) items.push(escapeHtml(entry.place.trim()));
  if (entry.speaker?.trim()) items.push(`Speaker: ${escapeHtml(entry.speaker.trim())}`);
  if (entry.sermonSeries?.trim()) items.push(`Series: ${escapeHtml(entry.sermonSeries.trim())}`);
  return `<ul class="meta">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

/**
 * Scripture, set as a Bible sets it: verse numbers raised, prose running on.
 *
 * A chapter marker appears only where a passage crosses a boundary — the
 * heading above already names the chapter for a quote that stays inside one.
 */
function renderPassage(verses: PassageVerse[]): string {
  const parts: string[] = [];
  let chapter: number | null = null;

  for (const verse of verses) {
    if (chapter !== null && verse.chapter !== chapter) {
      parts.push(`<b class="chapter-mark">Chapter ${verse.chapter}</b>`);
    }
    chapter = verse.chapter;
    parts.push(`<span class="verse"><sup class="verse-num">${verse.number}</sup>${escapeHtml(verse.text.trim())}</span>`);
  }

  return `<blockquote class="passage"><p>${parts.join(' ')}</p></blockquote>`;
}

/**
 * Every scripture anchor on an entry, with its KJV text.
 *
 * Refs are de-duplicated: an entry that anchors the same passage twice should
 * not print it twice. A passage with no loaded text still gets its heading and
 * says so plainly, because a silent gap looks like the entry had no scripture.
 */
function renderScripture(ctx: ExportContext, entry: Entry): string {
  const seen = new Set<string>();
  const blocks: string[] = [];

  for (const anchor of entry.anchors) {
    if (anchor.kind !== 'scripture') continue;
    const key = refKey(anchor);
    if (seen.has(key)) continue;
    seen.add(key);

    const title = outlineTitle(ctx, anchor);
    const heading = title
      ? `${escapeHtml(refLabel(ctx, anchor))} <span class="outline-title">${escapeHtml(title)}</span>`
      : escapeHtml(refLabel(ctx, anchor));

    const verses = ctx.passages.get(key);
    const body =
      verses && verses.length > 0
        ? renderPassage(verses)
        : '<p class="absent">The text of this passage was not included in this copy of the archive.</p>';

    blocks.push(`<h4 class="scripture-heading">${heading}</h4>\n${body}`);
  }

  return blocks.join('\n');
}

/** Topic and book anchors, which have no other home in the entry. */
function renderSubjects(ctx: ExportContext, entry: Entry): string {
  const subjects: string[] = [];

  for (const anchor of entry.anchors) {
    if (anchor.kind === 'topic') {
      const topic = ctx.topics.get(anchor.topicId);
      // A topic that is not in this archive still gets named by its id, so the
      // reader can see that the entry pointed somewhere rather than nowhere.
      subjects.push(escapeHtml(topic ? topic.name : anchor.topicId));
    } else if (anchor.kind === 'book') {
      subjects.push(escapeHtml(`The book of ${bookName(ctx, anchor.book)}`));
    }
  }

  return subjects.length === 0 ? '' : `<p class="subjects">On: ${subjects.join(' · ')}</p>`;
}

/**
 * Links, with the URL always printed as visible text.
 *
 * Most of these will be dead by the time anyone reads this. `capturedTitle`
 * records what the link pointed at when it was saved, and that is usually the
 * only part still worth anything — so it leads, and the URL follows in full.
 */
function renderLinks(links: EntryLink[]): string {
  if (links.length === 0) return '';

  const items = links.map((link) => {
    const label = link.label?.trim() || link.capturedTitle?.trim() || link.url;
    const href = safeHref(link.url);
    const shown = href ? `<a href="${href}" rel="noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label);
    const url = `<span class="url">${escapeHtml(link.url)}</span>`;
    const captured = link.capturedAt ? ` <span class="captured">saved ${escapeHtml(longDate(link.capturedAt.slice(0, 10)))}</span>` : '';
    return `<li>${shown}<br>${url}${captured}</li>`;
  });

  return `<h4>Links</h4>\n<ul class="links">${items.join('')}</ul>`;
}

/**
 * One entry, whole.
 *
 * `notes` and `reflection` are set apart visually as well as by heading,
 * because the distinction between what was said and what it meant is the point
 * of the entry and must survive being read by someone with no context.
 */
function renderEntry(ctx: ExportContext, entry: Entry, id: string, alsoAt?: string): string {
  const parts: string[] = [];

  parts.push(`<article class="entry" id="${escapeHtml(id)}">`);
  parts.push(`<h3>${escapeHtml(entryTitle(entry))}</h3>`);
  parts.push(renderMeta(entry));

  const subjects = renderSubjects(ctx, entry);
  if (subjects) parts.push(subjects);

  if (alsoAt) {
    parts.push(
      `<p class="cross-ref">This entry appears again below, in its place in time: <a href="#${escapeHtml(alsoAt)}">${escapeHtml(longDate(entry.date))}</a>.</p>`,
    );
  }

  if (entry.notes.trim()) {
    parts.push('<h4>Notes</h4>');
    parts.push(`<div class="notes">${renderMarkdown(entry.notes)}</div>`);
  }

  if (entry.reflection.trim()) {
    parts.push('<h4 class="reflection-heading">Reflection</h4>');
    parts.push(`<div class="reflection">${renderMarkdown(entry.reflection)}</div>`);
  }

  if (entry.prayer?.trim()) {
    parts.push('<h4 class="prayer-heading">Prayer</h4>');
    parts.push(`<div class="prayer">${renderMarkdown(entry.prayer)}</div>`);
  }

  const scripture = renderScripture(ctx, entry);
  if (scripture) parts.push(scripture);

  const mentioned = entry.scriptureRefs.map((ref) => ref.trim()).filter(Boolean);
  if (mentioned.length > 0) {
    // Free text the writer cited in passing. Not resolved to anything, and not
    // presented as though it were — just what they wrote down.
    parts.push(`<p class="mentioned">Also mentioned: ${escapeHtml(mentioned.join('; '))}</p>`);
  }

  parts.push(renderLinks(entry.links));

  const tags = entry.tags.map((tag) => tag.trim()).filter(Boolean);
  if (tags.length > 0) {
    parts.push(`<p class="tags">Tags: ${escapeHtml(tags.join(', '))}</p>`);
  }

  const file = ctx.noteFilenames.get(entry.id);
  if (file) {
    // The book sits in `book/`, the notes one level up in `notes/`. Always the
    // filename the archive actually wrote, never one re-derived here.
    parts.push(
      `<p class="source-file">Written as <a href="../${escapeHtml(file)}"><code>${escapeHtml(file)}</code></a> in this archive.</p>`,
    );
  }

  parts.push('</article>');
  return parts.filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Front and back matter
// ---------------------------------------------------------------------------

/** Oldest and newest dates actually present, ignoring anything unparseable. */
function dateRange(entries: Entry[]): { first: string; last: string } | null {
  const dates = entries.map((entry) => entry.date).filter((date) => parseDate(date) !== null).sort();
  if (dates.length === 0) return null;
  return { first: dates[0], last: dates[dates.length - 1] };
}

/**
 * What a filter kept, in words.
 *
 * "A partial archive must never look complete." If anything was excluded the
 * book says so on its first page, in the same breath as the entry count, rather
 * than leaving a reader to assume this was a whole life.
 */
function describeFilter(ctx: ExportContext): string {
  const filter = ctx.filter;
  if (!filter) return '';

  const clauses: string[] = [];
  if (filter.from && filter.to) clauses.push(`dated between ${longDate(filter.from)} and ${longDate(filter.to)}`);
  else if (filter.from) clauses.push(`dated on or after ${longDate(filter.from)}`);
  else if (filter.to) clauses.push(`dated on or before ${longDate(filter.to)}`);
  if (filter.books?.length) clauses.push(`about ${filter.books.map((book) => bookName(ctx, book)).join(', ')}`);
  if (filter.topics?.length) {
    clauses.push(`on the topics ${filter.topics.map((id) => ctx.topics.get(id)?.name ?? id).join(', ')}`);
  }
  if (filter.kinds?.length) clauses.push(`of the kinds ${filter.kinds.map(kindLabel).join(', ')}`);
  if (filter.forDescendantsOnly) clauses.push('marked for those who come after');

  if (clauses.length === 0) return '';
  return `<p class="scope-detail">What was kept: entries ${escapeHtml(clauses.join('; '))}.</p>`;
}

function renderTitlePage(ctx: ExportContext): string {
  const range = dateRange(ctx.entries);
  const parts: string[] = ['<header class="title-page">', '<h1>My Journey with God</h1>'];

  if (range) {
    const span =
      range.first === range.last
        ? escapeHtml(longDate(range.first))
        : `${escapeHtml(longDate(range.first))} &ndash; ${escapeHtml(longDate(range.last))}`;
    parts.push(`<p class="span">${span}</p>`);
  }

  parts.push(`<p class="count">${escapeHtml(plural(ctx.entries.length, 'entry', 'entries'))}</p>`);

  if (ctx.excludedCount > 0) {
    const total = ctx.entries.length + ctx.excludedCount;
    parts.push(
      `<p class="scope">This is a partial copy. It holds ${escapeHtml(plural(ctx.entries.length, 'entry', 'entries'))} of ${total}; ${escapeHtml(plural(ctx.excludedCount, 'entry was', 'entries were'))} left out when it was made.</p>`,
    );
  }
  parts.push(describeFilter(ctx));

  parts.push(`<p class="exported">Made ${escapeHtml(longDate(ctx.exportedAt.slice(0, 10)))}</p>`);
  parts.push('</header>');
  return parts.filter(Boolean).join('\n');
}

function renderForeword(ctx: ExportContext, hasLegacy: boolean): string {
  const parts: string[] = [
    '<section class="foreword" aria-labelledby="foreword-heading">',
    '<h2 id="foreword-heading">A word about this book</h2>',
    '<p>This is a journal. Someone kept it a note at a time &mdash; often on a Sunday, sometimes on a back porch &mdash; while reading the Bible and listening to people preach, and this book is everything they wrote.</p>',
    '<p>It was written in a small program called Journey that ran on their own computer and sent nothing anywhere. The program is not needed to read this. There is nothing to install, nothing to sign in to, and nothing here that has to be fetched from somewhere else. What you have is the whole thing.</p>',
    '<p>Each entry keeps two kinds of writing apart on purpose. <strong>Notes</strong> are what was said &mdash; by a preacher, or by the passage itself. <strong>Reflection</strong> is what it meant to the person writing it down. They were never mixed together, and they are not mixed here. If you read only one, read the reflection.</p>',
    '<p>The scripture each entry was about is printed with it, in full, so you never have to go and find a Bible to follow along.</p>',
  ];

  if (hasLegacy) {
    parts.push(
      '<p>The first section, <em>For those who come after</em>, holds the entries that were written with a reader like you in mind. Start there if you start anywhere.</p>',
    );
  }
  if (ctx.entries.length === 0) {
    parts.push('<p>This copy contains no entries at all. That is what the journal held when it was exported.</p>');
  }

  parts.push('</section>');
  return parts.join('\n');
}

function renderContents(ctx: ExportContext, hasLegacy: boolean, bodyIds: Map<string, string>): string {
  const parts: string[] = [
    '<nav class="contents" id="contents" aria-labelledby="contents-heading">',
    '<h2 id="contents-heading">Contents</h2>',
    '<ul class="toc-sections">',
  ];

  if (hasLegacy) parts.push('<li><a href="#for-those-who-come-after">For those who come after</a></li>');
  parts.push('<li><a href="#journal">The journal</a></li>');
  parts.push('<li><a href="#colophon">How this book was made</a></li>');
  parts.push('</ul>');

  if (ctx.entries.length > 0) {
    // Grouped by year. A long journal is easier to walk by year than as one
    // list of two hundred titles, and the grouping needs no page numbers —
    // which a browser cannot generate anyway.
    const groups: Array<{ year: string; entries: Entry[] }> = [];
    for (const entry of ctx.entries) {
      const parsed = parseDate(entry.date);
      const year = parsed ? String(parsed.year) : 'Undated';
      const last = groups[groups.length - 1];
      if (last && last.year === year) last.entries.push(entry);
      else groups.push({ year, entries: [entry] });
    }

    parts.push('<ol class="toc-years">');
    for (const group of groups) {
      parts.push(`<li><span class="toc-year">${escapeHtml(group.year)}</span><ol class="toc-entries">`);
      for (const entry of group.entries) {
        const id = bodyIds.get(entry.id) ?? '';
        parts.push(
          `<li><a href="#${escapeHtml(id)}">${escapeHtml(entryTitle(entry))}</a> <span class="toc-date">${escapeHtml(longDate(entry.date))}</span></li>`,
        );
      }
      parts.push('</ol></li>');
    }
    parts.push('</ol>');
  }

  parts.push('</nav>');
  return parts.join('\n');
}

function renderColophon(ctx: ExportContext): string {
  const parts: string[] = [
    '<footer class="colophon" id="colophon" aria-labelledby="colophon-heading">',
    '<h2 id="colophon-heading">How this book was made</h2>',
    `<p>This book was written out by a program called Journey on ${escapeHtml(longDate(ctx.exportedAt.slice(0, 10)))}. Journey was a private journal that ran on one person's own computer and kept everything there; it had no account, no server and no copy of this anywhere else.</p>`,
    '<p>The file you are reading is a single plain HTML document. Everything it needs &mdash; the text, the layout, the scripture &mdash; is inside it. It loads nothing, runs nothing, and will open in any browser. It is also meant to be printed: choose Print, and it will lay itself out as a book with the entries kept whole.</p>',
    '<h3>About the scripture</h3>',
    '<p>The passages are from the King James Version, the English translation first printed in 1611. It is old enough to be free of copyright anywhere in the world, which is exactly why it was chosen: no permission is needed to copy it, now or later. Its spelling and its "thee" and "thou" are original, not mistakes.</p>',
    '<p>Every passage an entry was written about is quoted here in full, so this book does not depend on any other book.</p>',
  ];

  if (ctx.profile === 'refs-only') {
    parts.push(
      '<p>This copy was made without the outline material the journal was originally read alongside, which was purchased and could not be included. Passages are therefore named by chapter and verse rather than by title. Nothing the journal-keeper wrote is missing.</p>',
    );
  }

  parts.push('<h3>The rest of the archive</h3>');
  parts.push(
    '<p>This book came out of a zip file, and it was not alone in there. Alongside it you should find a <code>notes</code> folder holding one plain text file per entry, named by date, which can be opened by anything that reads text; and a <code>data</code> folder holding <code>journey.json</code>, which is the same journal in a form a program can read, should anyone ever want to load it into something new.</p>',
  );
  parts.push(
    '<p>If only one of those survives, let it be the notes folder. Plain text outlives every format. This book is the one to read, though.</p>',
  );
  parts.push('</footer>');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * All of it, inline.
 *
 * System serif stacks only: a web font is a network request, and a network
 * request is a thing that stops working. Colour is carried in custom properties
 * so the dark-screen and the printed-page variants are a short override each,
 * and the print block comes last so paper is always black on white no matter
 * what the screen was doing.
 */
const STYLES = `
:root {
  --paper: #fdfcf9;
  --ink: #1c1a17;
  --ink-soft: #4a453e;
  --rule: #d6cfc2;
  --accent: #6b4a22;
  --tint: #f4efe5;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0;
  padding: 2rem 1.25rem 4rem;
  background: var(--paper);
  color: var(--ink);
  font-family: Georgia, "Iowan Old Style", "Times New Roman", Times, serif;
  font-size: 1.0625rem;
  line-height: 1.65;
}
main { max-width: 36rem; margin: 0 auto; }
h1, h2, h3, h4 { font-weight: normal; line-height: 1.25; }
h1 { font-size: 2.25rem; margin: 0 0 0.75rem; letter-spacing: 0.01em; }
h2 { font-size: 1.5rem; margin: 0 0 1rem; }
h3 { font-size: 1.25rem; margin: 0 0 0.35rem; }
h4 {
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
  margin: 1.5rem 0 0.4rem;
}
p { margin: 0 0 0.9rem; }
a { color: var(--accent); }
code { font-family: ui-monospace, "Courier New", monospace; font-size: 0.9em; }
hr { border: 0; border-top: 1px solid var(--rule); margin: 1.5rem 0; }

.skip {
  position: absolute;
  left: -9999px;
}
.skip:focus {
  position: static;
  display: inline-block;
  margin-bottom: 1rem;
}

.title-page {
  text-align: center;
  padding: 3rem 0 3.5rem;
  border-bottom: 1px solid var(--rule);
  margin-bottom: 3rem;
}
.title-page .span { font-size: 1.125rem; color: var(--ink-soft); margin-bottom: 0.25rem; }
.title-page .count,
.title-page .exported { color: var(--ink-soft); font-size: 0.9375rem; margin-bottom: 0.25rem; }
.title-page .scope,
.title-page .scope-detail {
  font-size: 0.9375rem;
  color: var(--ink);
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: 0.6rem 0.9rem;
  margin: 1.25rem auto 0;
  max-width: 28rem;
  text-align: left;
}
.title-page .scope-detail { border-top: 0; margin-top: 0; color: var(--ink-soft); }

section, .contents, .colophon { margin-bottom: 3.5rem; }

.legacy-intro { color: var(--ink-soft); font-style: italic; }

.toc-sections { list-style: none; padding: 0; margin: 0 0 1.5rem; }
.toc-sections li { margin-bottom: 0.3rem; }
.toc-years { list-style: none; padding: 0; margin: 0; }
.toc-year {
  display: block;
  font-size: 0.8125rem;
  letter-spacing: 0.1em;
  color: var(--accent);
  margin: 1.25rem 0 0.4rem;
}
.toc-entries { list-style: none; padding: 0; margin: 0; }
.toc-entries li { margin-bottom: 0.3rem; }
.toc-date { color: var(--ink-soft); font-size: 0.875rem; white-space: nowrap; }

.entry {
  padding-top: 2rem;
  margin-bottom: 2rem;
  border-top: 1px solid var(--rule);
}
.entry:first-of-type { border-top: 0; padding-top: 0; }

.meta {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem;
  font-size: 0.875rem;
  color: var(--ink-soft);
}
.meta li { display: inline; }
.meta li + li::before { content: " \\00b7 "; }

.subjects, .mentioned, .tags, .source-file, .cross-ref {
  font-size: 0.875rem;
  color: var(--ink-soft);
}

/* The reflection is the part that is the writer's own. It gets a rule down the
   side and looser, larger text so it never reads as more sermon notes. The rule
   is a border, not a background, because browsers do not print backgrounds. */
.reflection {
  border-left: 3px solid var(--accent);
  background: var(--tint);
  padding: 0.9rem 1.1rem 0.1rem;
  margin-bottom: 1rem;
  font-size: 1.09375rem;
  line-height: 1.75;
}
.reflection-heading { margin-top: 1.75rem; }

.prayer {
  border-left: 1px solid var(--rule);
  padding-left: 1.1rem;
  font-style: italic;
  color: var(--ink-soft);
}

.scripture-heading { text-transform: none; letter-spacing: 0; font-size: 1rem; font-variant: small-caps; }
.outline-title { color: var(--ink-soft); font-variant: normal; }
.passage {
  margin: 0 0 1.25rem;
  padding-left: 1.1rem;
  border-left: 1px solid var(--rule);
}
.passage p { margin: 0; }
.verse-num {
  font-size: 0.6875em;
  color: var(--accent);
  padding-right: 0.15em;
  vertical-align: super;
  line-height: 0;
}
.chapter-mark { display: block; margin: 0.75rem 0 0.25rem; font-size: 0.875rem; color: var(--ink-soft); }
.absent { font-style: italic; color: var(--ink-soft); }

.links { list-style: none; padding: 0; margin: 0 0 1rem; font-size: 0.9375rem; }
.links li { margin-bottom: 0.6rem; }
.url { font-family: ui-monospace, "Courier New", monospace; font-size: 0.8125rem; color: var(--ink-soft); word-break: break-all; }
.captured { font-size: 0.8125rem; color: var(--ink-soft); }

blockquote { margin: 0 0 0.9rem; padding-left: 1.1rem; border-left: 1px solid var(--rule); }
.md-heading { margin-bottom: 0.35rem; }

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #15140f;
    --ink: #ece7dc;
    --ink-soft: #b0a795;
    --rule: #3d382e;
    --accent: #d2a96a;
    --tint: #1e1c15;
  }
}

@media print {
  /* Paper is white and ink is black, whatever the screen was doing. */
  :root {
    --paper: #fff;
    --ink: #000;
    --ink-soft: #333;
    --rule: #999;
    --accent: #000;
    --tint: #fff;
  }
  @page { margin: 18mm 16mm; }
  body { padding: 0; font-size: 11pt; line-height: 1.5; }
  main { max-width: none; }
  h1 { font-size: 28pt; }
  h2 { font-size: 16pt; }
  h3 { font-size: 13pt; }
  h4 { font-size: 9pt; }

  .skip { display: none; }
  .title-page { padding: 25mm 0 0; border-bottom: 0; break-after: page; }
  .legacy, .contents, .colophon { break-before: page; }
  .contents a { text-decoration: none; }

  /* Keep an entry on one page where it fits. Browsers ignore this for anything
     taller than a page and break it normally, which is the right fallback; the
     rules below then stop a heading or a verse being orphaned at the fold. */
  .entry { break-inside: avoid; }
  h2, h3, h4 { break-after: avoid; }
  .meta, .subjects { break-after: avoid; }
  blockquote, li { break-inside: avoid; }
  p { orphans: 3; widows: 3; }

  /* A printed link is only as good as its address, so prose links print theirs.
     The Links list already shows every URL as text and is excluded here. */
  .notes a[href^="http"]::after,
  .reflection a[href^="http"]::after,
  .prayer a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 9pt; word-break: break-all; }
}
`.trim();

// ---------------------------------------------------------------------------
// The book
// ---------------------------------------------------------------------------

/**
 * Render the whole journal as one self-contained HTML book.
 *
 * Pure and synchronous: every passage it quotes is already in `ctx.passages`,
 * and every filename it links to is already in `ctx.noteFilenames`. The same
 * context always produces byte-identical output, so an export can be diffed.
 */
export function renderBook(ctx: ExportContext): string {
  const legacy = ctx.entries.filter((entry) => entry.forDescendants);
  const hasLegacy = legacy.length > 0;

  // Body ids first: the front section and the contents both link into the body,
  // and both need the id the body will actually use.
  const bodyIds = new Map<string, string>();
  ctx.entries.forEach((entry, index) => {
    bodyIds.set(entry.id, entryAnchorId(ctx, entry, index, 'entry'));
  });

  const parts: string[] = [];
  parts.push('<!doctype html>');
  parts.push('<html lang="en">');
  parts.push('<head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push('<title>My Journey with God</title>');
  parts.push('<meta name="generator" content="Journey">');
  parts.push(`<style>\n${STYLES}\n</style>`);
  parts.push('</head>');
  parts.push('<body>');
  parts.push('<a class="skip" href="#contents">Skip to contents</a>');
  parts.push('<main>');

  parts.push(renderTitlePage(ctx));
  parts.push(renderForeword(ctx, hasLegacy));

  if (hasLegacy) {
    // Before the body, deliberately. These entries were written to be found,
    // and a reader who opens the book and reads only the first pages should
    // land on them without having to go looking.
    parts.push('<section class="legacy" id="for-those-who-come-after" aria-labelledby="legacy-heading">');
    parts.push('<h2 id="legacy-heading">For those who come after</h2>');
    parts.push(
      '<p class="legacy-intro">These entries were marked, as they were written, as meant for whoever came later. They appear again below in their place in time; they are gathered here first because they were not meant to be come upon by accident.</p>',
    );
    legacy.forEach((entry, index) => {
      parts.push(renderEntry(ctx, entry, entryAnchorId(ctx, entry, index, 'legacy'), bodyIds.get(entry.id)));
    });
    parts.push('</section>');
  }

  parts.push(renderContents(ctx, hasLegacy, bodyIds));

  parts.push('<section class="journal" id="journal" aria-labelledby="journal-heading">');
  parts.push('<h2 id="journal-heading">The journal</h2>');
  if (ctx.entries.length === 0) {
    parts.push('<p class="absent">There are no entries in this copy of the journal.</p>');
  }
  for (const entry of ctx.entries) {
    parts.push(renderEntry(ctx, entry, bodyIds.get(entry.id) ?? entry.id));
  }
  parts.push('</section>');

  parts.push(renderColophon(ctx));
  parts.push('</main>');
  parts.push('</body>');
  parts.push('</html>');
  parts.push('');

  return parts.join('\n');
}
