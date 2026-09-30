/**
 * One search over everything the app knows.
 *
 * Search used to cover journal entries and outline titles only. Under
 * `refs-only` the outline titles do not exist, so on a public first visit — an
 * empty journal, no outlines — every search returned nothing at all. That is
 * the first thing a stranger does and the first thing that failed.
 *
 * So the sources here are ordered by what is useful to someone who has just
 * arrived and written nothing: a typed reference goes straight to the passage,
 * then topics, then books, and the journal comes last because it is empty until
 * they fill it.
 *
 * Every section reports whether it was searched, so the empty state can say
 * what was looked through rather than a bare "no results".
 */

import topicsFile from '../data/topics.json';
import versificationData from '../data/kjv/versification.json';
import { ownText, providedText } from './provided-notes';
import type { Entry, OutlineBook, ScriptureRef, Topic } from '../types';
import { BOOK_NAMES } from './canon';
import { normalize, resolveBook, searchBooks } from './book-aliases';
import { buildIndex, referenceSpan } from './verse-index';

const versification: Record<string, number[]> = versificationData;
const topics = topicsFile.topics as Topic[];

export interface ReferenceHit {
  ref: ScriptureRef;
  bookName: string;
  label: string;
}

export interface TopicHit {
  topic: Topic;
  /** Which word matched, when it was an alias rather than the name. */
  matchedAlias?: string;
}

export interface BookHit {
  id: string;
  name: string;
}

export interface OutlineHit {
  id: string;
  book: string;
  ref: string;
  title: string;
}

export interface SearchResults {
  query: string;
  references: ReferenceHit[];
  topics: TopicHit[];
  books: BookHit[];
  entries: Entry[];
  /**
   * Entry ids whose only match is in sermon notes somebody else provided.
   *
   * A set rather than a flag on the hit, so a caller that does not care about
   * the distinction cannot accidentally drop it while mapping over `entries`.
   */
  providedOnly: Set<string>;
  outlines: OutlineHit[];
  /**
   * What was actually searched, and what could not be. Drives an empty state
   * that says where it looked instead of only that it found nothing.
   */
  searched: Array<{ label: string; available: boolean; reason?: string }>;
  total: number;
}

/**
 * Parse a typed scripture reference.
 *
 * Deliberately permissive, unlike the export's parser: someone typing "Ps 23"
 * into a search box means Psalm 23, and refusing to guess helps nobody. The
 * cost of being wrong is a passage they did not want, one tap from where they
 * were — not a misquotation inside their own notes.
 */
export function parseReferenceQuery(query: string): ScriptureRef | null {
  const cleaned = query.trim().replace(/[.,]$/, '');
  // <book> <chapter>[:<verse>[-<verse or chapter:verse>]]
  const match = /^(.+?)\s*(\d+)(?:\s*[:.]\s*(\d+))?(?:\s*[-–—]\s*(?:(\d+)\s*[:.]\s*)?(\d+))?$/.exec(cleaned);
  if (!match) {
    // A bare book name is still a useful jump: "Jude" -> Jude 1.
    const bookOnly = resolveBook(cleaned);
    if (bookOnly) {
      return { book: bookOnly, chapterStart: 1, verseStart: 1, chapterEnd: 1, verseEnd: versification[bookOnly][0] };
    }
    return null;
  }

  const [, rawBook, rawChapter, rawVerse, rawEndChapter, rawEnd] = match;
  const book = resolveBook(rawBook);
  if (!book) return null;

  const counts = versification[book];
  const chapter = Number(rawChapter);
  if (!counts || chapter < 1 || chapter > counts.length) return null;

  // No verse given: the whole chapter.
  if (!rawVerse) {
    return { book, chapterStart: chapter, verseStart: 1, chapterEnd: chapter, verseEnd: counts[chapter - 1] };
  }

  const verse = Number(rawVerse);
  if (verse < 1 || verse > counts[chapter - 1]) return null;

  if (!rawEnd) {
    return { book, chapterStart: chapter, verseStart: verse, chapterEnd: chapter, verseEnd: verse };
  }

  const endChapter = rawEndChapter ? Number(rawEndChapter) : chapter;
  const endVerse = Number(rawEnd);
  if (endChapter < chapter || endChapter > counts.length) return null;
  if (endVerse < 1 || endVerse > counts[endChapter - 1]) return null;

  const ranged = {
    book,
    chapterStart: chapter,
    verseStart: verse,
    chapterEnd: endChapter,
    verseEnd: endVerse,
  };

  /*
   * A range that runs backwards is not a reference.
   *
   * The bounds checks above are per-endpoint, so "John 3:18-16" passed all of
   * them: both verses exist in John 3. What it produced was a ref whose end
   * sits before its start, and every consumer then quietly disagreed about what
   * that meant — `refLabel` printed "John 3:18-16" as though it were real,
   * while `anchorOverlaps` compared `aFrom <= qTo && qFrom <= aTo` and matched
   * nothing at all, so the search said the journal was empty rather than that
   * the reference could not be read.
   *
   * Checked with `referenceSpan`, which is the same function the archive's
   * stricter parser validates through and the same one the browse model uses,
   * rather than a second opinion written here. Returning null lets the query
   * fall through to an ordinary text search, which is the honest answer.
   */
  return referenceSpan(buildIndex(counts), ranged) ? ranged : null;
}

/** Render a ref the way a person would write it. */
export function refLabel(ref: ScriptureRef): string {
  const name = BOOK_NAMES[ref.book] ?? ref.book;
  const wholeChapter =
    ref.verseStart === 1 && ref.verseEnd === (versification[ref.book]?.[ref.chapterEnd - 1] ?? -1);

  if (ref.chapterStart === ref.chapterEnd) {
    if (wholeChapter) return `${name} ${ref.chapterStart}`;
    if (ref.verseStart === ref.verseEnd) return `${name} ${ref.chapterStart}:${ref.verseStart}`;
    return `${name} ${ref.chapterStart}:${ref.verseStart}-${ref.verseEnd}`;
  }
  return `${name} ${ref.chapterStart}:${ref.verseStart}-${ref.chapterEnd}:${ref.verseEnd}`;
}

/** Topics whose name, alias or curated notes match. */
export function searchTopics(query: string, limit = 10): TopicHit[] {
  const needle = normalize(query);
  if (needle.length < 2) return [];

  const exact: TopicHit[] = [];
  const aliased: TopicHit[] = [];
  const loose: TopicHit[] = [];

  for (const topic of topics) {
    const name = normalize(topic.name);
    if (name === needle || name.startsWith(needle)) {
      exact.push({ topic });
      continue;
    }

    const alias = topic.aliases.find((value) => {
      const normalized = normalize(value);
      return normalized === needle || normalized.startsWith(needle);
    });
    if (alias) {
      aliased.push({ topic, matchedAlias: alias });
      continue;
    }

    // Last resort: the description, and the curated note on each passage.
    const haystack = [topic.description, ...topic.refs.map((ref) => ref.note ?? '')].join(' ').toLowerCase();
    if (haystack.includes(needle)) loose.push({ topic });
  }

  return [...exact, ...aliased, ...loose].slice(0, limit);
}

export interface SearchSources {
  entries: Entry[];
  outlineBooks: OutlineBook[];
  hasOutlines: boolean;
}

/** Search everything. Pure: the caller supplies the journal. */
export function search(query: string, sources: SearchSources): SearchResults {
  const trimmed = query.trim();

  const empty: SearchResults = {
    query: trimmed,
    references: [],
    topics: [],
    books: [],
    entries: [],
    outlines: [],
    searched: [],
    providedOnly: new Set<string>(),
    total: 0,
  };
  if (trimmed.length < 2) return empty;

  const needle = trimmed.toLowerCase();

  const parsed = parseReferenceQuery(trimmed);
  const references: ReferenceHit[] = parsed
    ? [{ ref: parsed, bookName: BOOK_NAMES[parsed.book] ?? parsed.book, label: refLabel(parsed) }]
    : [];

  const topicHits = searchTopics(trimmed);

  const bookHits: BookHit[] = searchBooks(trimmed).map((id) => ({ id, name: BOOK_NAMES[id] }));

  /*
   * The journal, in two parts.
   *
   * Provided sermon notes are searchable — someone who remembers a phrase from
   * a handout should be able to find the Sunday it belongs to. But a result is
   * an answer to "where did I write that", and an entry surfaced only because
   * a church's outline matched is not that answer. So the two texts are
   * searched separately and the difference is carried out of here for the view
   * to say out loud. The split itself lives in `provided-notes.ts`, shared
   * with the storage-backed search the journal view actually runs.
   */
  const providedOnly = new Set<string>();
  const entryHits = sources.entries.filter((entry) => {
    if (ownText(entry).includes(needle)) return true;
    if (providedText(entry).includes(needle)) {
      providedOnly.add(entry.id);
      return true;
    }
    return false;
  });

  const outlineHits: OutlineHit[] = sources.hasOutlines
    ? sources.outlineBooks.flatMap((book) =>
        book.entries
          .filter((entry) =>
            `${entry.displayTitle ?? ''} ${entry.title ?? ''} ${entry.series ?? ''}`.toLowerCase().includes(needle),
          )
          .map((entry) => ({
            id: entry.id,
            book: book.id,
            ref: entry.ref,
            title: entry.displayTitle || entry.title,
          })),
      ).slice(0, 25)
    : [];

  return {
    query: trimmed,
    references,
    topics: topicHits,
    books: bookHits,
    entries: entryHits,
    /** Ids whose only match is in material somebody else provided. */
    providedOnly,
    outlines: outlineHits,
    // Named in the order the UI shows them, so the empty state reads top down.
    searched: [
      { label: 'Scripture references', available: true },
      { label: 'Topics', available: true },
      { label: 'Books of the Bible', available: true },
      { label: 'Your journal', available: true },
      {
        label: 'Outline passage titles',
        available: sources.hasOutlines,
        reason: sources.hasOutlines ? undefined : 'not included in this version of the site',
      },
    ],
    total: references.length + topicHits.length + bookHits.length + entryHits.length + outlineHits.length,
  };
}
