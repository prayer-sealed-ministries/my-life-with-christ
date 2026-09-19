/**
 * The browse model: how a book's text is divided for reading and journalling.
 *
 * The outline set covers most of the Bible but not all of it — 286 verses across
 * 46 gaps are untouched, and a dozen places have two entries claiming the same
 * verses. Neither is a defect in the ingest; it is the shape of the source. What
 * matters for the product is that browsing a book shows *every* chapter, and
 * that a reader who opens an uncovered passage can still write a note there.
 *
 * So a book is modelled as a gapless sequence of segments: every verse belongs
 * to exactly one segment, outline-backed or not, and both kinds journal through
 * the identical action.
 */

import type { OutlineBook, OutlineEntry, PassageSegment, ScriptureRef, Topic } from '../types';
import {
  buildIndex,
  formatSpan,
  fromOrdinal,
  referenceSpan,
  spanId,
  type Span,
  type VerseIndex,
} from './verse-index';

/**
 * Divide a book into a gapless run of segments.
 *
 * Outline entries are laid down first, in reference order. Wherever they leave a
 * hole, an `uncovered` segment fills it with a synthesized but stable id, so a
 * journal entry anchored there keeps resolving across re-ingests.
 *
 * Overlapping entries are kept whole rather than truncated — the reader should
 * see the passage each entry actually names. Overlaps therefore do not create
 * holes, and are not silently resolved here; the sections ingest report lists
 * them for deliberate decision.
 */
export function buildSegments(
  book: Pick<OutlineBook, 'id' | 'name' | 'entries'>,
  verseCounts: readonly number[],
): PassageSegment[] {
  const index = buildIndex(verseCounts);

  const placed: Array<{ entry: OutlineEntry; span: Span }> = [];
  for (const entry of book.entries) {
    const span = referenceSpan(index, entry);
    // An unadjudicated impossible reference resolves nowhere. It stays visible
    // via its entry, but it cannot claim verses.
    if (span) placed.push({ entry, span });
  }
  placed.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);

  const segments: PassageSegment[] = [];
  let cursor = 1;

  const addUncovered = (start: number, end: number) => {
    const from = fromOrdinal(index, start);
    const to = fromOrdinal(index, end);
    segments.push({
      kind: 'uncovered',
      id: spanId(book.id, from, to),
      ref: formatSpan(index, book.name, start, end),
      chapterStart: from.chapter,
      verseStart: from.verse,
      chapterEnd: to.chapter,
      verseEnd: to.verse,
    });
  };

  for (const { entry, span } of placed) {
    if (span.start > cursor) addUncovered(cursor, span.start - 1);

    const from = fromOrdinal(index, span.start);
    const to = fromOrdinal(index, span.end);
    segments.push({
      kind: 'outline',
      id: entry.id,
      ref: entry.ref,
      entry,
      chapterStart: from.chapter,
      verseStart: from.verse,
      chapterEnd: to.chapter,
      verseEnd: to.verse,
    });

    cursor = Math.max(cursor, span.end + 1);
  }

  if (cursor <= index.total) addUncovered(cursor, index.total);

  return segments;
}

/** Turn a segment into the portable scripture ref an entry anchors to. */
export function segmentRef(segment: PassageSegment, bookId: string): ScriptureRef {
  return {
    book: bookId,
    chapterStart: segment.chapterStart,
    verseStart: segment.verseStart,
    chapterEnd: segment.chapterEnd,
    verseEnd: segment.verseEnd,
  };
}

/** Do two references share at least one verse? */
export function refsOverlap(index: VerseIndex, a: ScriptureRef, b: ScriptureRef): boolean {
  if (a.book !== b.book) return false;
  const spanA = referenceSpan(index, a);
  const spanB = referenceSpan(index, b);
  if (!spanA || !spanB) return false;
  return spanA.start <= spanB.end && spanB.start <= spanA.end;
}

/**
 * Resolve a topic's scripture refs to the outline entries they overlap.
 *
 * This is the enhancement direction, and it only ever runs one way: topics do
 * not know about outlines, so under `refs-only` this simply returns nothing and
 * the topic still browses by scripture.
 */
export function resolveTopicEntries(
  topic: Topic,
  booksById: Map<string, Pick<OutlineBook, 'id' | 'name' | 'entries'>>,
  versification: Record<string, number[]>,
): OutlineEntry[] {
  const found = new Map<string, OutlineEntry>();

  for (const ref of topic.refs) {
    const book = booksById.get(ref.book);
    const counts = versification[ref.book];
    if (!book || !counts) continue;

    const index = buildIndex(counts);
    const target = referenceSpan(index, ref);
    if (!target) continue;

    for (const entry of book.entries) {
      if (found.has(entry.id)) continue;
      const span = referenceSpan(index, entry);
      if (span && span.start <= target.end && target.start <= span.end) {
        found.set(entry.id, entry);
      }
    }
  }

  return [...found.values()];
}

/** Render a scripture ref for display, without needing the book's text. */
export function formatRef(ref: ScriptureRef, bookName: string, verseCounts: readonly number[]): string {
  const index = buildIndex(verseCounts);
  const span = referenceSpan(index, ref);
  if (!span) return bookName;
  return formatSpan(index, bookName, span.start, span.end);
}
