/**
 * The app's view of the static data that every surface may ask for cheaply.
 *
 * What this build IS arrives through `virtual:journey-data`, which the build
 * generates according to DATA_PROFILE: a handful of strings and booleans, and
 * no division data at all. The divisions THEMSELVES live behind
 * `./sections.ts`, are loaded on demand, and are the reason this file was
 * split in two — see that file for why.
 *
 * Everything here is eager and small, because the application shell and the
 * entry editor import it and neither may wait for Scripture data to arrive.
 *
 * Divisions are not verse text. Whatever arrives in either module, the words a
 * reader reads are the KJV, loaded separately from `src/data/kjv/`.
 *
 * Everything downstream reads `hasOutlineTitles` rather than assuming.
 */

import {
  DATA_PROFILE,
  divisionSource,
  hasOutlines,
  hasOutlineTitles,
} from 'virtual:journey-data';

import topicsFile from '../data/topics.json';
import versificationData from '../data/kjv/versification.json';
import { BOOK_NAMES, BOOK_ORDER, BOOK_TESTAMENT, CANON } from '../lib/canon';
import type { PassageSegment, Topic } from '../types';

export { DATA_PROFILE, divisionSource, hasOutlines, hasOutlineTitles };

export const versification: Record<string, number[]> = versificationData;
export const topics = topicsFile.topics as Topic[];
export const topicsById = new Map(topics.map((topic) => [topic.id, topic]));

/**
 * Books in canonical order, from versification alone.
 *
 * Deliberately says nothing about the outline layer. How many outline entries a
 * book has is a question about the divisions, so it is answered by
 * `entryCountFor` on the loaded section data — asking it here would have put
 * the whole dataset back on the startup path for the sake of one count in one
 * list.
 */
export const canonBooks = CANON.map((id) => ({
  id,
  name: BOOK_NAMES[id],
  testament: BOOK_TESTAMENT[id],
  order: BOOK_ORDER[id],
  chapters: versification[id]?.length ?? 0,
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
 *
 * Lives here rather than with the loaded divisions because it needs none of
 * them; `./sections.ts` is its only caller today, and that is a fact about
 * this build, not about the function.
 */
export function chapterSegments(bookId: string, counts: number[]): PassageSegment[] {
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
