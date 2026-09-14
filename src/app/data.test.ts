import { describe, expect, it } from 'vitest';

import { canonBooks, segmentContaining, segmentsForBook, versification } from './data';
import { hasOutlines } from 'virtual:journey-data';

describe('segmentsForBook', () => {
  it('covers every verse of every book, whatever the profile', () => {
    const failures: string[] = [];

    for (const book of canonBooks) {
      const counts = versification[book.id];
      const segments = segmentsForBook(book.id);
      const total = counts.reduce((sum, n) => sum + n, 0);

      const offsets = [0];
      for (const count of counts) offsets.push(offsets[offsets.length - 1] + count);

      const seen = new Set<number>();
      for (const segment of segments) {
        const start = offsets[segment.chapterStart - 1] + segment.verseStart;
        const end = offsets[segment.chapterEnd - 1] + segment.verseEnd;
        for (let i = start; i <= end; i += 1) seen.add(i);
      }

      if (seen.size !== total) failures.push(`${book.name}: ${seen.size}/${total}`);
    }

    expect(failures).toEqual([]);
  });

  it('returns nothing for a book that does not exist', () => {
    expect(segmentsForBook('nonesuch')).toEqual([]);
  });

  it('is stable across calls', () => {
    expect(segmentsForBook('jude')).toBe(segmentsForBook('jude'));
  });
});

describe('segmentation respects the data profile', () => {
  if (hasOutlines) {
    it('divides by outline entry under the full profile', () => {
      const matthew = segmentsForBook('matthew');
      expect(matthew.some((segment) => segment.kind === 'outline')).toBe(true);
      // Matthew 5 is divided, not whole.
      const inChapter5 = matthew.filter((s) => s.chapterStart === 5);
      expect(inChapter5.length).toBeGreaterThan(1);
    });
  } else {
    // The publishable build must not contain the author's divisions at all.
    it('divides by whole chapter under refs-only', () => {
      const matthew = segmentsForBook('matthew');
      expect(matthew).toHaveLength(versification.matthew.length);
      for (const segment of matthew) {
        expect(segment.kind).toBe('uncovered');
        expect(segment.chapterStart).toBe(segment.chapterEnd);
        expect(segment.verseStart).toBe(1);
        expect(segment.verseEnd).toBe(versification.matthew[segment.chapterStart - 1]);
      }
    });

    it('names segments by chapter alone, with no verse span', () => {
      expect(segmentsForBook('matthew')[4].ref).toBe('Matthew 5');
      expect(segmentsForBook('matthew')[4].id).toBe('matthew-5');
    });
  }
});

describe('segmentContaining', () => {
  it('finds the segment holding a given verse', () => {
    const segment = segmentContaining('matthew', 5, 3);
    expect(segment).toBeDefined();
    expect(segment!.chapterStart).toBeLessThanOrEqual(5);
    expect(segment!.chapterEnd).toBeGreaterThanOrEqual(5);
  });

  it('returns undefined for a chapter outside the book', () => {
    expect(segmentContaining('jude', 99)).toBeUndefined();
  });
});
