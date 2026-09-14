import { describe, expect, it } from 'vitest';

import { buildSegments, refsOverlap, segmentRef } from './passages';
import { buildIndex } from './verse-index';
import outlines from '../data/outlines.json';
import versification from '../data/kjv/versification.json';
import type { OutlineBook, OutlineEntry } from '../types';

const books = outlines as unknown as OutlineBook[];
const counts = versification as Record<string, number[]>;

/** A toy book: 3 chapters of 10, 5 and 8 verses. */
const TOY = [10, 5, 8];
const entry = (id: string, fields: Partial<OutlineEntry>): OutlineEntry =>
  ({
    id,
    ref: id,
    sourceRef: id,
    book: 'toy',
    title: id,
    displayTitle: id,
    classicStory: false,
    series: null,
    chapterStart: 1,
    chapterEnd: 1,
    ...fields,
  }) as OutlineEntry;

describe('buildSegments', () => {
  it('fills a hole between two entries with an uncovered segment', () => {
    const segments = buildSegments(
      {
        id: 'toy',
        name: 'Toy',
        entries: [
          entry('a', { chapterStart: 1, chapterEnd: 1, verseStart: 1, verseEnd: 3 }),
          entry('b', { chapterStart: 1, chapterEnd: 3, verseStart: 7, verseEnd: 8 }),
        ],
      },
      TOY,
    );

    expect(segments.map((s) => [s.kind, s.ref])).toEqual([
      ['outline', 'a'],
      ['uncovered', 'Toy 1:4-6'],
      ['outline', 'b'],
    ]);
  });

  it('leaves no verse unaccounted for', () => {
    const segments = buildSegments(
      { id: 'toy', name: 'Toy', entries: [entry('a', { chapterStart: 2, chapterEnd: 2 })] },
      TOY,
    );
    const index = buildIndex(TOY);

    const covered = new Set<number>();
    for (const segment of segments) {
      const span = { chapterStart: segment.chapterStart, chapterEnd: segment.chapterEnd, verseStart: segment.verseStart, verseEnd: segment.verseEnd };
      const start = index.offsets[span.chapterStart - 1] + span.verseStart;
      const end = index.offsets[span.chapterEnd - 1] + span.verseEnd;
      for (let i = start; i <= end; i += 1) covered.add(i);
    }

    expect(covered.size).toBe(index.total);
  });

  it('gives uncovered segments stable ids across rebuilds', () => {
    const book = { id: 'toy', name: 'Toy', entries: [entry('a', { chapterStart: 2, chapterEnd: 2 })] };
    const first = buildSegments(book, TOY).map((s) => s.id);
    const second = buildSegments(book, TOY).map((s) => s.id);
    expect(first).toEqual(second);
    expect(first).toContain('toy-1-1-10');
  });

  it('keeps overlapping entries whole rather than truncating either', () => {
    const segments = buildSegments(
      {
        id: 'toy',
        name: 'Toy',
        entries: [
          entry('a', { chapterStart: 1, chapterEnd: 1, verseStart: 1, verseEnd: 6 }),
          entry('b', { chapterStart: 1, chapterEnd: 3, verseStart: 5, verseEnd: 8 }),
        ],
      },
      TOY,
    );
    const a = segments.find((s) => s.id === 'a')!;
    const b = segments.find((s) => s.id === 'b')!;
    expect([a.verseStart, a.verseEnd]).toEqual([1, 6]);
    expect([b.verseStart, b.verseEnd]).toEqual([5, 8]);
  });

  it('skips an entry whose reference cannot resolve, without losing the rest', () => {
    const segments = buildSegments(
      {
        id: 'toy',
        name: 'Toy',
        entries: [
          entry('bad', { chapterStart: 1, chapterEnd: 1, verseStart: 8, verseEnd: 2 }),
          entry('good', { chapterStart: 1, chapterEnd: 3 }),
        ],
      },
      TOY,
    );
    expect(segments.map((s) => s.id)).toEqual(['good']);
  });

  it('covers an entirely unoutlined book with one uncovered segment', () => {
    const segments = buildSegments({ id: 'toy', name: 'Toy', entries: [] }, TOY);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ kind: 'uncovered', ref: 'Toy 1-3' });
  });
});

describe('every real book is fully reachable', () => {
  // Requirement: a reader who opens Genesis 35 and finds no way to write a note
  // has hit a product bug. So across all 66 books, every verse must belong to
  // some segment, and every segment must be journalable.
  it('accounts for all 31,102 verses across the canon', () => {
    const failures: string[] = [];
    let totalVerses = 0;

    for (const book of books) {
      const verseCounts = counts[book.id];
      const index = buildIndex(verseCounts);
      totalVerses += index.total;

      const segments = buildSegments(book, verseCounts);
      const seen = new Set<number>();

      for (const segment of segments) {
        const start = index.offsets[segment.chapterStart - 1] + segment.verseStart;
        const end = index.offsets[segment.chapterEnd - 1] + segment.verseEnd;
        for (let i = start; i <= end; i += 1) seen.add(i);
      }

      if (seen.size !== index.total) {
        failures.push(`${book.name}: ${seen.size} of ${index.total} verses in a segment`);
      }
    }

    expect(failures).toEqual([]);
    expect(totalVerses).toBe(31_102);
  });

  it('gives every segment a usable id and reference', () => {
    for (const book of books) {
      for (const segment of buildSegments(book, counts[book.id])) {
        expect(segment.id, `${book.name} ${segment.ref}`).toMatch(/\S/);
        expect(segment.ref, `${book.name} ${segment.id}`).toMatch(/\S/);
      }
    }
  });

  it('makes Genesis 35:1-15 reachable as an uncovered segment', () => {
    // The exact gap called out during adjudication.
    const genesis = books.find((book) => book.id === 'genesis')!;
    const segments = buildSegments(genesis, counts.genesis);
    const gap = segments.find((s) => s.kind === 'uncovered' && s.ref === 'Genesis 35:1-15');

    expect(gap).toBeDefined();
    expect(segmentRef(gap!, 'genesis')).toEqual({
      book: 'genesis',
      chapterStart: 35,
      verseStart: 1,
      chapterEnd: 35,
      verseEnd: 15,
    });
  });

  it('makes the Acts 6:8-7:7 cross-chapter gap one reachable segment', () => {
    const acts = books.find((book) => book.id === 'acts')!;
    const segments = buildSegments(acts, counts.acts);
    const gap = segments.find((s) => s.kind === 'uncovered' && s.ref === 'Acts 6:8-7:7');

    expect(gap).toBeDefined();
    expect(gap).toMatchObject({ chapterStart: 6, verseStart: 8, chapterEnd: 7, verseEnd: 7 });
  });
});

describe('refsOverlap', () => {
  const index = buildIndex(TOY);
  const ref = (chapterStart: number, verseStart: number, chapterEnd: number, verseEnd: number) => ({
    book: 'toy', chapterStart, verseStart, chapterEnd, verseEnd,
  });

  it('is true when two ranges share a verse', () => {
    expect(refsOverlap(index, ref(1, 1, 1, 5), ref(1, 5, 1, 9))).toBe(true);
  });

  it('is false when they merely touch', () => {
    expect(refsOverlap(index, ref(1, 1, 1, 4), ref(1, 5, 1, 9))).toBe(false);
  });

  it('is false across different books', () => {
    expect(refsOverlap(index, ref(1, 1, 1, 5), { ...ref(1, 1, 1, 5), book: 'other' })).toBe(false);
  });
});
