/**
 * The app's view of the static data.
 *
 * Divisions arrive through the `virtual:journey-data` module, which the build
 * generates according to DATA_PROFILE. Three schemes can arrive there — the
 * purchased outlines, the public-domain BSB sections, or nothing at all — and
 * the app deliberately does not care which: a titled span of verses renders the
 * same either way. `divisionSource` is available for the places that must say
 * so out loud, such as attribution.
 *
 * Everything downstream reads `hasOutlineTitles` rather than assuming.
 */

import {
  DATA_PROFILE,
  divisionSource,
  hasOutlines,
  hasOutlineTitles,
  outlines,
} from 'virtual:journey-data';

import topicsFile from '../data/topics.json';
import versificationData from '../data/kjv/versification.json';
import { BOOK_NAMES, BOOK_ORDER, BOOK_TESTAMENT, CANON } from '../lib/canon';
import { buildSegments } from '../lib/passages';
import type { OutlineBook, PassageSegment, Topic } from '../types';

export { DATA_PROFILE, divisionSource, hasOutlines, hasOutlineTitles };

export const versification: Record<string, number[]> = versificationData;
export const topics = topicsFile.topics as Topic[];
export const topicsById = new Map(topics.map((topic) => [topic.id, topic]));

export const outlineBooks = outlines as OutlineBook[];
export const outlineBooksById = new Map(outlineBooks.map((book) => [book.id, book]));

export const outlineEntriesById = new Map(
  outlineBooks.flatMap((book) => book.entries.map((entry) => [entry.id, entry] as const)),
);

/** Books in canonical order, including any the outline layer does not cover. */
export const canonBooks = CANON.map((id) => ({
  id,
  name: BOOK_NAMES[id],
  testament: BOOK_TESTAMENT[id],
  order: BOOK_ORDER[id],
  chapters: versification[id]?.length ?? 0,
  entryCount: outlineBooksById.get(id)?.entries.length ?? 0,
}));

export type CanonBook = (typeof canonBooks)[number];

/**
 * Whole-chapter segments, derived only from KJV versification.
 *
 * This is what `refs-only` browses by. The outline's verse-span divisions are
 * the author's arrangement and are the protected part of the compilation, so a
 * publishable build must not contain them — not even stripped of their titles.
 * Chapter boundaries are canonical scripture, factual, and nobody's editorial
 * work, so they are always safe to ship.
 */
function chapterSegments(bookId: string, counts: number[]): PassageSegment[] {
  const name = BOOK_NAMES[bookId] ?? bookId;
  return counts.map((verseCount, index) => {
    const chapter = index + 1;
    return {
      kind: 'uncovered',
      id: `${bookId}-${chapter}`,
      ref: `${name} ${chapter}`,
      chapterStart: chapter,
      verseStart: 1,
      chapterEnd: chapter,
      verseEnd: verseCount,
    };
  });
}

/**
 * Segments for a book, computed once and cached.
 *
 * Every verse belongs to exactly one segment, so there is never a passage the
 * reader can reach but not write against. What the segments ARE depends on the
 * data profile: outline entries plus the gaps between them under `full`, whole
 * chapters under `refs-only`.
 */
const segmentCache = new Map<string, PassageSegment[]>();

export function segmentsForBook(bookId: string): PassageSegment[] {
  const cached = segmentCache.get(bookId);
  if (cached) return cached;

  const counts = versification[bookId];
  if (!counts) return [];

  const book = outlineBooksById.get(bookId);
  const segments =
    hasOutlines && book
      ? buildSegments({ id: bookId, name: BOOK_NAMES[bookId] ?? bookId, entries: book.entries }, counts)
      : chapterSegments(bookId, counts);

  segmentCache.set(bookId, segments);
  return segments;
}

/**
 * Find the segment containing a chapter/verse position.
 *
 * Used when a link arrives carrying a segment id this build does not have —
 * a journal written under `full` and read under `refs-only`, say. The passage
 * is still reachable; only the division it was filed under has gone.
 */
export function segmentContaining(bookId: string, chapter: number, verse = 1): PassageSegment | undefined {
  return segmentsForBook(bookId).find(
    (segment) =>
      (chapter > segment.chapterStart || (chapter === segment.chapterStart && verse >= segment.verseStart)) &&
      (chapter < segment.chapterEnd || (chapter === segment.chapterEnd && verse <= segment.verseEnd)),
  );
}

/**
 * How to describe a segment that carries no outline entry.
 *
 * The wording differs by profile, and getting it wrong is confusing: under
 * `refs-only` there is no outline layer at all, so "no outline entry for this
 * passage" would imply something is missing that was never meant to be there.
 */
export function segmentNote(segment: PassageSegment): string | null {
  if (segment.kind === 'outline') return null;
  return hasOutlines
    ? 'No outline entry — read it and add your own note'
    : 'Read it and add your own note';
}

export function findSegment(bookId: string, segmentId: string): PassageSegment | undefined {
  return segmentsForBook(bookId).find((segment) => segment.id === segmentId);
}

/** The title to show for a segment, whatever the data profile. */
export function segmentTitle(segment: PassageSegment): string {
  if (segment.kind === 'uncovered') return segment.ref;
  if (!hasOutlineTitles) return segment.ref;
  return segment.entry.displayTitle || segment.entry.title || segment.ref;
}
