/**
 * The app's view of the static data.
 *
 * Outlines arrive through the `virtual:journey-data` module, which the build
 * generates according to DATA_PROFILE — under `refs-only` the titles and intros
 * are simply not there. Everything downstream reads `hasOutlineTitles` rather
 * than assuming.
 */

import { DATA_PROFILE, hasOutlineTitles, outlines } from 'virtual:journey-data';

import topicsFile from '../data/topics.json';
import versificationData from '../data/kjv/versification.json';
import { BOOK_NAMES, BOOK_ORDER, BOOK_TESTAMENT, CANON } from '../lib/canon';
import { buildSegments } from '../lib/passages';
import type { OutlineBook, PassageSegment, Topic } from '../types';

export { DATA_PROFILE, hasOutlineTitles };

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
 * Segments for a book, computed once and cached.
 *
 * Every verse belongs to exactly one segment, outline-backed or not, so there is
 * never a passage the reader can reach but not write against.
 */
const segmentCache = new Map<string, PassageSegment[]>();

export function segmentsForBook(bookId: string): PassageSegment[] {
  const cached = segmentCache.get(bookId);
  if (cached) return cached;

  const counts = versification[bookId];
  if (!counts) return [];

  const book = outlineBooksById.get(bookId);
  const segments = buildSegments(
    { id: bookId, name: BOOK_NAMES[bookId] ?? bookId, entries: book?.entries ?? [] },
    counts,
  );
  segmentCache.set(bookId, segments);
  return segments;
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
