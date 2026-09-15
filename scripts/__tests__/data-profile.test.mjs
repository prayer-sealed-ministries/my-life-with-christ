import { describe, expect, it } from 'vitest';

import {
  DIVISION_SOURCE,
  OUTLINE_FREE,
  outlinesForProfile,
  resolveProfile,
  withIntros,
} from '../vite-plugin-data-profile.mjs';
import sections from '../../src/data/sections.json';
import books from '../../src/data/outlines.json';
import topicsFile from '../../src/data/topics.json';
import frozen from '../probe-baseline.json';
import { GUARDED_COUNTS, compareToBaseline, measureProbes } from '../lib/probes.mjs';

const { topics } = topicsFile;

describe('resolveProfile', () => {
  it('defaults to full when nothing selects a profile', () => {
    // resolveProfile falls back to process.env.DATA_PROFILE, so the environment
    // has to be cleared to test the default. Without this the test asserted
    // "the default is full" and actually asserted "the env var happens to be
    // unset", which passed in CI and failed the moment the suite was run under
    // another profile.
    const previous = process.env.DATA_PROFILE;
    delete process.env.DATA_PROFILE;
    try {
      expect(resolveProfile(undefined)).toBe('full');
    } finally {
      if (previous === undefined) delete process.env.DATA_PROFILE;
      else process.env.DATA_PROFILE = previous;
    }
  });

  it('takes the profile from the environment when one is set', () => {
    const previous = process.env.DATA_PROFILE;
    process.env.DATA_PROFILE = 'public';
    try {
      expect(resolveProfile(undefined)).toBe('public');
    } finally {
      if (previous === undefined) delete process.env.DATA_PROFILE;
      else process.env.DATA_PROFILE = previous;
    }
  });

  it('accepts the three known profiles', () => {
    expect(resolveProfile('full')).toBe('full');
    expect(resolveProfile('public')).toBe('public');
    expect(resolveProfile('refs-only')).toBe('refs-only');
  });

  it('refuses anything else rather than guessing', () => {
    expect(() => resolveProfile('publik')).toThrow(/must be one of/);
    expect(() => resolveProfile('all')).toThrow(/must be one of/);
    expect(() => resolveProfile('')).toThrow(/must be one of/);
  });

  it('names where each profile draws its divisions from', () => {
    expect(DIVISION_SOURCE).toEqual({
      full: 'outlines',
      public: 'sections',
      'refs-only': 'none',
    });
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

describe('the public profile ships owned content only', () => {
  // The whole point of the lane: a publishable build whose divisions this
  // project owns outright, so no gate is needed for licensing reasons.
  it('ships the BSB sections, not the purchased outlines', () => {
    expect(sections).toHaveLength(66);
    const total = sections.reduce((n, b) => n + b.entries.length, 0);
    expect(total).toBeGreaterThan(2500);
  });

  it('merges hand-written intros into the sections', () => {
    const merged = withIntros(sections, { jonah: 'Written here.' });
    expect(merged.find((b) => b.id === 'jonah').intro).toBe('Written here.');
    // A book with no intro written yet simply renders without one.
    expect(merged.find((b) => b.id === 'nahum').intro).toBe('');
  });

  it('leaves the original untouched when merging', () => {
    withIntros(sections, { jonah: 'Mutation check.' });
    expect(sections.find((b) => b.id === 'jonah').intro).toBe('');
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
