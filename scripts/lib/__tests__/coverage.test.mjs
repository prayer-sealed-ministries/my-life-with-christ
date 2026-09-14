import { describe, expect, it } from 'vitest';

import { analyseBook, buildIndex, entrySpan, formatSpan, fromOrdinal, toOrdinal } from '../coverage.mjs';

/** A toy book: 3 chapters of 10, 5 and 8 verses. */
const COUNTS = [10, 5, 8];
const index = buildIndex(COUNTS);

const entry = (id, fields) => ({ id, ref: id, title: id, ...fields });

describe('the flat verse index', () => {
  it('totals every verse in the book', () => {
    expect(index.total).toBe(23);
  });

  it('round-trips chapter/verse through an ordinal', () => {
    for (let chapter = 1; chapter <= COUNTS.length; chapter += 1) {
      for (let verse = 1; verse <= COUNTS[chapter - 1]; verse += 1) {
        expect(fromOrdinal(index, toOrdinal(index, chapter, verse))).toEqual({ chapter, verse });
      }
    }
  });

  it('places the first and last verse at the ends', () => {
    expect(toOrdinal(index, 1, 1)).toBe(1);
    expect(toOrdinal(index, 3, 8)).toBe(23);
  });
});

describe('entrySpan', () => {
  it('spans a whole chapter when no verses are named', () => {
    expect(entrySpan(index, entry('a', { chapterStart: 2, chapterEnd: 2 }))).toEqual({ start: 11, end: 15 });
  });

  it('spans a chapter range', () => {
    expect(entrySpan(index, entry('a', { chapterStart: 1, chapterEnd: 2 }))).toEqual({ start: 1, end: 15 });
  });

  it('spans a verse range inside one chapter', () => {
    expect(
      entrySpan(index, entry('a', { chapterStart: 1, chapterEnd: 1, verseStart: 3, verseEnd: 5 })),
    ).toEqual({ start: 3, end: 5 });
  });

  it('spans a verse range across a chapter boundary', () => {
    expect(
      entrySpan(index, entry('a', { chapterStart: 1, chapterEnd: 2, verseStart: 9, verseEnd: 2 })),
    ).toEqual({ start: 9, end: 12 });
  });

  it('refuses a verse that does not exist', () => {
    expect(entrySpan(index, entry('a', { chapterStart: 2, chapterEnd: 2, verseStart: 1, verseEnd: 99 })))
      .toHaveProperty('error');
  });

  it('refuses a range that ends before it starts', () => {
    // Matthew 9:18-6 in the real data.
    expect(entrySpan(index, entry('a', { chapterStart: 1, chapterEnd: 1, verseStart: 8, verseEnd: 2 })))
      .toHaveProperty('error');
  });

  it('refuses a chapter outside the book', () => {
    expect(entrySpan(index, entry('a', { chapterStart: 9, chapterEnd: 9 }))).toHaveProperty('error');
  });
});

describe('formatSpan', () => {
  it('names a whole chapter without verse numbers', () => {
    expect(formatSpan(index, 'Toy', 11, 15)).toBe('Toy 2');
  });

  it('names a whole chapter range', () => {
    expect(formatSpan(index, 'Toy', 1, 15)).toBe('Toy 1-2');
  });

  it('names a partial range inside a chapter', () => {
    expect(formatSpan(index, 'Toy', 3, 5)).toBe('Toy 1:3-5');
  });

  it('names a single verse', () => {
    expect(formatSpan(index, 'Toy', 3, 3)).toBe('Toy 1:3');
  });

  it('names a partial range across chapters', () => {
    expect(formatSpan(index, 'Toy', 9, 12)).toBe('Toy 1:9-2:2');
  });
});

describe('analyseBook', () => {
  it('reports full coverage with no gaps', () => {
    const result = analyseBook(
      { name: 'Toy', entries: [entry('all', { chapterStart: 1, chapterEnd: 3 })] },
      COUNTS,
    );
    expect(result.covered).toBe(23);
    expect(result.gaps).toEqual([]);
    expect(result.overlaps).toEqual([]);
  });

  it('finds a gap between two entries', () => {
    const result = analyseBook(
      {
        name: 'Toy',
        entries: [
          entry('a', { chapterStart: 1, chapterEnd: 1, verseStart: 1, verseEnd: 3 }),
          entry('b', { chapterStart: 1, chapterEnd: 1, verseStart: 7, verseEnd: 10 }),
          entry('c', { chapterStart: 2, chapterEnd: 3 }),
        ],
      },
      COUNTS,
    );
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({ ref: 'Toy 1:4-6', verses: 3 });
    expect(result.covered).toBe(20);
  });

  it('finds a leading and a trailing gap', () => {
    const result = analyseBook(
      { name: 'Toy', entries: [entry('a', { chapterStart: 2, chapterEnd: 2 })] },
      COUNTS,
    );
    expect(result.gaps.map((gap) => gap.ref)).toEqual(['Toy 1', 'Toy 3']);
  });

  it('merges a gap that runs across a chapter boundary', () => {
    // The real Acts 6:8-7:7 shape: contiguous uncovered verses spanning chapters
    // must report as one gap, not two.
    const result = analyseBook(
      {
        name: 'Toy',
        entries: [
          entry('a', { chapterStart: 1, chapterEnd: 1, verseStart: 1, verseEnd: 7 }),
          entry('b', { chapterStart: 2, chapterEnd: 3, verseStart: 3, verseEnd: 8 }),
        ],
      },
      COUNTS,
    );
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({ ref: 'Toy 1:8-2:2', verses: 5 });
  });

  it('detects an overlap and names the shared verses', () => {
    const result = analyseBook(
      {
        name: 'Toy',
        entries: [
          entry('a', { chapterStart: 1, chapterEnd: 1, verseStart: 1, verseEnd: 6 }),
          entry('b', { chapterStart: 1, chapterEnd: 1, verseStart: 5, verseEnd: 10 }),
          entry('c', { chapterStart: 2, chapterEnd: 3 }),
        ],
      },
      COUNTS,
    );
    expect(result.overlaps).toHaveLength(1);
    expect(result.overlaps[0]).toMatchObject({ shared: 'Toy 1:5-6', verses: 2 });
    expect(result.gaps).toEqual([]);
  });

  it('counts an overlapped verse once toward coverage', () => {
    const result = analyseBook(
      {
        name: 'Toy',
        entries: [
          entry('a', { chapterStart: 1, chapterEnd: 2 }),
          entry('b', { chapterStart: 1, chapterEnd: 3 }),
        ],
      },
      COUNTS,
    );
    expect(result.covered).toBe(23);
    expect(result.gaps).toEqual([]);
  });

  it('excludes an unresolvable entry from coverage but records it', () => {
    const result = analyseBook(
      {
        name: 'Toy',
        entries: [
          entry('bad', { chapterStart: 1, chapterEnd: 1, verseStart: 8, verseEnd: 2 }),
          entry('good', { chapterStart: 1, chapterEnd: 3 }),
        ],
      },
      COUNTS,
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].id).toBe('bad');
    expect(result.covered).toBe(23);
  });

  it('reports an empty book as entirely uncovered', () => {
    const result = analyseBook({ name: 'Toy', entries: [] }, COUNTS);
    expect(result.covered).toBe(0);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].verses).toBe(23);
  });
});
