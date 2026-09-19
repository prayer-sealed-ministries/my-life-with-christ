import { describe, expect, it } from 'vitest';

import { buildSegments, refsOverlap, segmentRef } from './passages';
import { buildIndex } from './verse-index';
import outlines from '../data/sections.json';
import versification from '../data/kjv/versification.json';
import type { OutlineBook, OutlineEntry } from '../types';
import { examinedAtLeast } from '../testing/floor';

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
    let segmentsChecked = 0;

    for (const book of books) {
      for (const segment of buildSegments(book, counts[book.id])) {
        segmentsChecked += 1;
        expect(segment.id, `${book.name} ${segment.ref}`).toMatch(/\S/);
        expect(segment.ref, `${book.name} ${segment.id}`).toMatch(/\S/);
      }
    }

    examinedAtLeast(segmentsChecked, 1000, 'segments across the canon');
  });

  /*
   * A division scheme with a deliberate hole in it.
   *
   * These two cases used to name real gaps in a purchased scheme — Genesis
   * 35:1-15 and the Acts 6:8-7:7 cross-chapter span. That scheme is not in
   * this repository, and the BSB sections that replaced it partition the canon
   * completely, so there is no real gap left to point at. The behaviour still
   * has to hold: rule 3 says every passage is reachable and journalable, and a
   * reader who opens a chapter nobody divided must still find a way to write.
   *
   * So the gap is made here instead of borrowed. A synthetic book with one
   * missing span tests the same code and does not depend on whose arrangement
   * happens to ship.
   */
  it('makes a single-chapter hole reachable as an uncovered segment', () => {
    const book = {
      id: 'toy', name: 'Toy', testament: 'OT' as const, order: 1, intro: '',
      entries: [
        entry('toy-1', { chapterStart: 1, chapterEnd: 1, verseStart: 1, verseEnd: 10 }),
        // Chapter 2 is left out entirely.
        entry('toy-3', { chapterStart: 3, chapterEnd: 3, verseStart: 1, verseEnd: 8 }),
      ],
    };
    const segments = buildSegments(book, TOY);
    const gap = segments.find((s) => s.kind === 'uncovered');

    expect(gap, 'the hole is not reachable at all').toBeDefined();
    expect(segmentRef(gap!, 'toy')).toEqual({
      book: 'toy', chapterStart: 2, verseStart: 1, chapterEnd: 2, verseEnd: 5,
    });
  });

  it('makes a cross-chapter hole one reachable segment', () => {
    const book = {
      id: 'toy', name: 'Toy', testament: 'OT' as const, order: 1, intro: '',
      entries: [
        entry('toy-a', { chapterStart: 1, chapterEnd: 1, verseStart: 1, verseEnd: 7 }),
        // 1:8 through 2:3 is nobody's section.
        entry('toy-b', { chapterStart: 2, chapterEnd: 2, verseStart: 4, verseEnd: 5 }),
      ],
    };
    const gap = buildSegments(book, TOY).find((s) => s.kind === 'uncovered');

    expect(gap, 'the cross-chapter hole is not reachable').toBeDefined();
    expect(gap).toMatchObject({ chapterStart: 1, verseStart: 8, chapterEnd: 2, verseEnd: 3 });
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
