import { describe, expect, it } from 'vitest';

import { OUTLINE_FREE, outlinesForProfile, resolveProfile } from '../vite-plugin-data-profile.mjs';
import books from '../../src/data/outlines.json';
import topicsFile from '../../src/data/topics.json';
import frozen from '../probe-baseline.json';
import { GUARDED_COUNTS, compareToBaseline, measureProbes } from '../lib/probes.mjs';

const { topics } = topicsFile;

describe('resolveProfile', () => {
  it('defaults to full', () => {
    expect(resolveProfile(undefined)).toBe('full');
  });

  it('accepts the two known profiles', () => {
    expect(resolveProfile('full')).toBe('full');
    expect(resolveProfile('refs-only')).toBe('refs-only');
  });

  it('refuses anything else rather than guessing', () => {
    expect(() => resolveProfile('public')).toThrow(/must be one of/);
    expect(() => resolveProfile('')).toThrow(/must be one of/);
  });
});

describe('outlinesForProfile', () => {
  it('ships the whole compilation under full', () => {
    const shipped = outlinesForProfile(books, 'full');
    expect(shipped).toHaveLength(66);
    expect(shipped.reduce((n, book) => n + book.entries.length, 0)).toBeGreaterThan(1300);
  });

  // The important one. What is protected in a compilation is the selection and
  // arrangement, not only the prose — so a publishable build must carry no
  // outline data at all, not a copy with the titles deleted.
  it('ships NOTHING of the compilation under refs-only', () => {
    expect(outlinesForProfile(books, 'refs-only')).toEqual([]);
    expect(OUTLINE_FREE).toEqual([]);
  });

  it('carries no verse-span division under refs-only', () => {
    const shipped = outlinesForProfile(books, 'refs-only');
    const serialized = JSON.stringify(shipped);

    // Every division in the source, absent from what ships.
    for (const book of books) {
      for (const entry of book.entries) {
        if (entry.verseStart === undefined) continue;
        expect(serialized).not.toContain(entry.id);
        expect(serialized).not.toContain(`"verseStart":${entry.verseStart}`);
      }
    }
  });

  it('carries no title or intro prose under refs-only', () => {
    const serialized = JSON.stringify(outlinesForProfile(books, 'refs-only'));
    for (const book of books) {
      if (book.intro) expect(serialized).not.toContain(book.intro);
      for (const entry of book.entries) {
        if (entry.title.length >= 24) expect(serialized).not.toContain(entry.title);
      }
    }
  });
});

describe('the probe set cannot erode unnoticed', () => {
  const baseline = { books: 66, outlineEntries: 1312, proseProbes: 1323, divisionProbes: 867 };

  it('reports nothing when the set is unchanged', () => {
    const { shrunk, grown } = compareToBaseline({ ...baseline }, baseline);
    expect(shrunk).toEqual([]);
    expect(grown).toEqual([]);
  });

  it('flags every count that shrank, with both numbers', () => {
    const { shrunk } = compareToBaseline({ ...baseline, outlineEntries: 1200, proseProbes: 1100 }, baseline);
    expect(shrunk).toEqual([
      { field: 'outlineEntries', was: 1312, now: 1200 },
      { field: 'proseProbes', was: 1323, now: 1100 },
    ]);
  });

  it('treats growth as fine — a larger probe set is a stronger gate', () => {
    const { shrunk, grown } = compareToBaseline({ ...baseline, proseProbes: 1400 }, baseline);
    expect(shrunk).toEqual([]);
    expect(grown).toEqual([{ field: 'proseProbes', was: 1323, now: 1400 }]);
  });

  it('notices changed content at unchanged size', () => {
    const withDigests = { ...baseline, proseDigest: 'aaa', divisionDigest: 'bbb' };
    const { shrunk, digestsChanged } = compareToBaseline(
      { ...withDigests, proseDigest: 'ccc' },
      withDigests,
    );
    expect(shrunk).toEqual([]);
    expect(digestsChanged).toEqual(['proseDigest']);
  });

  it('measures the real dataset at or above the frozen baseline', () => {
    const measured = measureProbes(books, topics);
    for (const field of GUARDED_COUNTS) {
      expect(measured[field], field).toBeGreaterThanOrEqual(frozen[field]);
    }
  });
});
