/**
 * Per-book flat verse indexing.
 *
 * Chapter/verse pairs collapse to a single ordinal within a book, so a passage
 * that crosses a chapter boundary is just a range like any other and needs no
 * special casing. Shared by the browse model and the ingest's coverage report,
 * so the two can never disagree about what a reference spans.
 */

export interface VerseIndex {
  readonly verseCounts: readonly number[];
  readonly offsets: readonly number[];
  readonly total: number;
}

export interface Span {
  start: number;
  end: number;
}

export interface ChapterVerse {
  chapter: number;
  verse: number;
}

/** Build the cumulative offsets that make chapter/verse <-> ordinal O(1). */
export function buildIndex(verseCounts: readonly number[]): VerseIndex {
  const offsets = [0];
  for (const count of verseCounts) offsets.push(offsets[offsets.length - 1] + count);
  return { verseCounts, offsets, total: offsets[offsets.length - 1] };
}

/** chapter/verse -> 1-based ordinal within the book. */
export function toOrdinal(index: VerseIndex, chapter: number, verse: number): number {
  return index.offsets[chapter - 1] + verse;
}

/** 1-based ordinal -> chapter/verse. */
export function fromOrdinal(index: VerseIndex, ordinal: number): ChapterVerse {
  let chapter = 1;
  while (chapter < index.verseCounts.length && ordinal > index.offsets[chapter]) chapter += 1;
  return { chapter, verse: ordinal - index.offsets[chapter - 1] };
}

/** A reference as the outline data stores it. */
export interface ReferenceLike {
  chapterStart: number;
  chapterEnd: number;
  verseStart?: number;
  verseEnd?: number;
}

/**
 * The verse range a reference claims.
 *
 * Returns null when the reference cannot resolve — an impossible range left
 * unadjudicated, or a chapter outside the book. Callers must handle null rather
 * than assume every outline entry lands somewhere real.
 */
export function referenceSpan(index: VerseIndex, reference: ReferenceLike): Span | null {
  const { chapterStart, chapterEnd, verseStart, verseEnd } = reference;
  const chapterCount = index.verseCounts.length;

  if (!chapterStart || chapterStart < 1 || chapterStart > chapterCount) return null;
  const lastChapter = chapterEnd ?? chapterStart;
  if (lastChapter < 1 || lastChapter > chapterCount || lastChapter < chapterStart) return null;

  if (verseStart === undefined || verseEnd === undefined) {
    return {
      start: toOrdinal(index, chapterStart, 1),
      end: toOrdinal(index, lastChapter, index.verseCounts[lastChapter - 1]),
    };
  }

  if (verseStart < 1 || verseStart > index.verseCounts[chapterStart - 1]) return null;
  if (verseEnd < 1 || verseEnd > index.verseCounts[lastChapter - 1]) return null;

  const start = toOrdinal(index, chapterStart, verseStart);
  const end = toOrdinal(index, lastChapter, verseEnd);
  return end < start ? null : { start, end };
}

/** Render an ordinal range as a readable reference, e.g. "Genesis 35:1-15". */
export function formatSpan(index: VerseIndex, bookName: string, start: number, end: number): string {
  const from = fromOrdinal(index, start);
  const to = fromOrdinal(index, end);
  const endsChapter = to.verse === index.verseCounts[to.chapter - 1];

  if (from.chapter === to.chapter) {
    if (from.verse === 1 && endsChapter) return `${bookName} ${from.chapter}`;
    if (from.verse === to.verse) return `${bookName} ${from.chapter}:${from.verse}`;
    return `${bookName} ${from.chapter}:${from.verse}-${to.verse}`;
  }
  if (from.verse === 1 && endsChapter) return `${bookName} ${from.chapter}-${to.chapter}`;
  return `${bookName} ${from.chapter}:${from.verse}-${to.chapter}:${to.verse}`;
}

/** A stable, collision-free id for a synthesized (uncovered) span. */
export function spanId(bookId: string, from: ChapterVerse, to: ChapterVerse): string {
  if (from.chapter === to.chapter) return `${bookId}-${from.chapter}-${from.verse}-${to.verse}`;
  return `${bookId}-${from.chapter}-${from.verse}-${to.chapter}-${to.verse}`;
}
