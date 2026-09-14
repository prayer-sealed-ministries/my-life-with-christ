/**
 * Which passages do the outlines actually cover?
 *
 * The outline set is not a partition of the Bible: it skips passages, and in a
 * few places two entries claim the same verses. Both matter to the product.
 * Gaps matter because a user who opens Genesis 35 must still be able to write a
 * note there; overlaps matter because the same verse resolving to two different
 * outline entries is a browse-UI ambiguity that has to be decided deliberately.
 *
 * Everything works in a per-book flat verse index: chapter/verse pairs collapse
 * to a single ordinal, so a span that crosses a chapter boundary is just a
 * range like any other, with no special cases.
 */

/** Cumulative verse offsets for a book, so chapter/verse <-> ordinal is O(1). */
export function buildIndex(verseCounts) {
  const offsets = [0];
  for (const count of verseCounts) offsets.push(offsets[offsets.length - 1] + count);
  return { verseCounts, offsets, total: offsets[offsets.length - 1] };
}

/** chapter/verse -> 1-based ordinal within the book. */
export function toOrdinal(index, chapter, verse) {
  return index.offsets[chapter - 1] + verse;
}

/** 1-based ordinal -> {chapter, verse}. */
export function fromOrdinal(index, ordinal) {
  let chapter = 1;
  while (chapter < index.verseCounts.length && ordinal > index.offsets[chapter]) chapter += 1;
  return { chapter, verse: ordinal - index.offsets[chapter - 1] };
}

/**
 * The verse range an outline entry claims.
 *
 * @returns {{start: number, end: number} | {error: string}}
 */
export function entrySpan(index, entry) {
  const { chapterStart, chapterEnd, verseStart, verseEnd } = entry;
  const chapterCount = index.verseCounts.length;

  if (!chapterStart || chapterStart < 1 || chapterStart > chapterCount) {
    return { error: `chapter ${chapterStart} is outside the book` };
  }
  const lastChapter = chapterEnd ?? chapterStart;
  if (lastChapter < 1 || lastChapter > chapterCount) {
    return { error: `chapter ${lastChapter} is outside the book` };
  }

  // No verses named: the whole chapter span.
  if (verseStart === undefined) {
    return {
      start: toOrdinal(index, chapterStart, 1),
      end: toOrdinal(index, lastChapter, index.verseCounts[lastChapter - 1]),
    };
  }

  if (verseStart < 1 || verseStart > index.verseCounts[chapterStart - 1]) {
    return { error: `verse ${chapterStart}:${verseStart} does not exist` };
  }
  if (verseEnd < 1 || verseEnd > index.verseCounts[lastChapter - 1]) {
    return { error: `verse ${lastChapter}:${verseEnd} does not exist` };
  }

  const start = toOrdinal(index, chapterStart, verseStart);
  const end = toOrdinal(index, lastChapter, verseEnd);
  if (end < start) return { error: `range ends before it starts` };
  return { start, end };
}

/** Render an ordinal range as a readable reference, e.g. "Genesis 35:1-15". */
export function formatSpan(index, bookName, start, end) {
  const from = fromOrdinal(index, start);
  const to = fromOrdinal(index, end);

  if (from.chapter === to.chapter) {
    const whole = from.verse === 1 && to.verse === index.verseCounts[from.chapter - 1];
    if (whole) return `${bookName} ${from.chapter}`;
    if (from.verse === to.verse) return `${bookName} ${from.chapter}:${from.verse}`;
    return `${bookName} ${from.chapter}:${from.verse}-${to.verse}`;
  }

  const wholeSpan =
    from.verse === 1 && to.verse === index.verseCounts[to.chapter - 1];
  if (wholeSpan) return `${bookName} ${from.chapter}-${to.chapter}`;
  return `${bookName} ${from.chapter}:${from.verse}-${to.chapter}:${to.verse}`;
}

/**
 * Analyse one book's coverage.
 *
 * @returns {{total: number, covered: number, gaps: object[], overlaps: object[], errors: object[]}}
 */
export function analyseBook(book, verseCounts) {
  const index = buildIndex(verseCounts);

  /** @type {Array<{id: string, ref: string, title: string, start: number, end: number}>} */
  const spans = [];
  const errors = [];

  for (const entry of book.entries) {
    const span = entrySpan(index, entry);
    if ('error' in span) {
      errors.push({ id: entry.id, ref: entry.sourceRef ?? entry.ref, title: entry.title, reason: span.error });
      continue;
    }
    spans.push({ id: entry.id, ref: entry.ref, title: entry.title, ...span });
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);

  // Overlaps: compare each span against every later span that can still reach it.
  const overlaps = [];
  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      if (spans[j].start > spans[i].end) break;
      const start = Math.max(spans[i].start, spans[j].start);
      const end = Math.min(spans[i].end, spans[j].end);
      if (start > end) continue;
      overlaps.push({
        a: spans[i],
        b: spans[j],
        shared: formatSpan(index, book.name, start, end),
        verses: end - start + 1,
      });
    }
  }

  // Gaps: the complement of the merged spans across the whole book.
  const gaps = [];
  let cursor = 1;
  for (const span of spans) {
    if (span.start > cursor) {
      gaps.push({
        ref: formatSpan(index, book.name, cursor, span.start - 1),
        start: cursor,
        end: span.start - 1,
        verses: span.start - cursor,
      });
    }
    cursor = Math.max(cursor, span.end + 1);
  }
  if (cursor <= index.total) {
    gaps.push({
      ref: formatSpan(index, book.name, cursor, index.total),
      start: cursor,
      end: index.total,
      verses: index.total - cursor + 1,
    });
  }

  const covered = index.total - gaps.reduce((sum, gap) => sum + gap.verses, 0);
  return { total: index.total, covered, gaps, overlaps, errors };
}
