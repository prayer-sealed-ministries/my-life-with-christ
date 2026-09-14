/**
 * Lazy access to the vendored KJV text.
 *
 * The whole Bible is 4.2 MB, so it is never bundled as one unit. Each book is
 * its own module, imported on demand and cached for the session. Reading a
 * chapter of Mark pulls Mark and nothing else.
 *
 * All local. No network call anywhere in this file.
 */

import type { BibleBook, ScriptureRef, Verse } from '../types';
import versificationData from '../data/kjv/versification.json';
import { buildIndex, formatSpan, fromOrdinal, referenceSpan } from './verse-index';

export const versification: Record<string, number[]> = versificationData;

/** Vite resolves this at build time into one lazy chunk per book. */
const bookLoaders = import.meta.glob<{ default: BibleBook }>('../data/kjv/*.json');

const cache = new Map<string, BibleBook>();

/** Load one book of scripture, caching it for the session. */
export async function loadBook(bookId: string): Promise<BibleBook> {
  const cached = cache.get(bookId);
  if (cached) return cached;

  const loader = bookLoaders[`../data/kjv/${bookId}.json`];
  if (!loader) throw new Error(`No scripture text for book "${bookId}"`);

  const module = await loader();
  const book = module.default;
  cache.set(bookId, book);
  return book;
}

/** The verses of one chapter, numbered. */
export async function loadChapter(bookId: string, chapter: number): Promise<Verse[]> {
  const book = await loadBook(bookId);
  const verses = book.chapters[chapter - 1];
  if (!verses) throw new Error(`${bookId} has no chapter ${chapter}`);
  return verses.map((text, index) => ({ number: index + 1, text }));
}

/** A verse carrying its chapter, for passages that cross a chapter boundary. */
export interface PassageVerse extends Verse {
  chapter: number;
}

/**
 * The verses a reference names, in order, across chapter boundaries.
 *
 * Returns an empty array for a reference that does not resolve — an
 * unadjudicated impossible range, say — rather than throwing, so one bad
 * reference cannot fail a whole export.
 */
export async function loadPassage(ref: ScriptureRef): Promise<PassageVerse[]> {
  const counts = versification[ref.book];
  if (!counts) return [];

  const index = buildIndex(counts);
  const span = referenceSpan(index, ref);
  if (!span) return [];

  const book = await loadBook(ref.book);
  const out: PassageVerse[] = [];
  for (let ordinal = span.start; ordinal <= span.end; ordinal += 1) {
    const { chapter, verse } = fromOrdinal(index, ordinal);
    const text = book.chapters[chapter - 1]?.[verse - 1];
    if (text !== undefined) out.push({ chapter, number: verse, text });
  }
  return out;
}

/** How many verses a reference spans, without loading the text. */
export function passageLength(ref: ScriptureRef): number {
  const counts = versification[ref.book];
  if (!counts) return 0;
  const span = referenceSpan(buildIndex(counts), ref);
  return span ? span.end - span.start + 1 : 0;
}

/** Render a reference for display, e.g. "Genesis 35:1-15". */
export function refToString(ref: ScriptureRef, bookName: string): string {
  const counts = versification[ref.book];
  if (!counts) return bookName;
  const index = buildIndex(counts);
  const span = referenceSpan(index, ref);
  return span ? formatSpan(index, bookName, span.start, span.end) : bookName;
}
