import { describe, expect, it } from 'vitest';

import {
  DIVISION_SOURCE,
  OUTLINE_FREE,
  outlinesForProfile,
  resolveProfile,
  withIntros,
} from '../vite-plugin-data-profile.mjs';
import sections from '../../src/data/sections.json';

describe('resolveProfile', () => {
  it('defaults to the profile that is deployed', () => {
    // resolveProfile falls back to process.env.DATA_PROFILE, so the environment
    // has to be cleared to test the default. Without this the test asserted
    // "the default is X" and actually asserted "the env var happens to be
    // unset", which passed in CI and failed the moment the suite was run under
    // another profile.
    const previous = process.env.DATA_PROFILE;
    delete process.env.DATA_PROFILE;
    try {
      expect(resolveProfile(undefined)).toBe('public');
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

  it('accepts the two known profiles', () => {
    expect(resolveProfile('public')).toBe('public');
    expect(resolveProfile('refs-only')).toBe('refs-only');
  });

  it('refuses the retired licensed-data profile by name', () => {
    // `full` read a licensed third-party compilation. It is gone, and a build
    // that still asks for it must stop rather than quietly produce something
    // else — an old script, an old CI job, an old shell history entry.
    expect(() => resolveProfile('full')).toThrow(/must be one of/);
  });

  it('refuses anything else rather than guessing', () => {
    expect(() => resolveProfile('publik')).toThrow(/must be one of/);
    expect(() => resolveProfile('all')).toThrow(/must be one of/);
    expect(() => resolveProfile('')).toThrow(/must be one of/);
  });

  it('names where each profile draws its divisions from', () => {
    expect(DIVISION_SOURCE).toEqual({
      public: 'sections',
      'refs-only': 'none',
    });
  });
});

describe('outlinesForProfile', () => {
  it('ships the division scheme under public', () => {
    const shipped = outlinesForProfile(sections, 'public');
    expect(shipped).toHaveLength(66);
    expect(shipped.reduce((n, book) => n + book.entries.length, 0)).toBeGreaterThan(2500);
  });

  // The important one. A refs-only build must carry no division data at all,
  // not a copy with the titles deleted: in a compilation the selection and
  // arrangement is the part that matters, whoever made it.
  it('ships NOTHING of any division scheme under refs-only', () => {
    expect(outlinesForProfile(sections, 'refs-only')).toEqual([]);
    expect(OUTLINE_FREE).toEqual([]);
  });

  it('carries no verse-span division under refs-only', () => {
    const serialized = JSON.stringify(outlinesForProfile(sections, 'refs-only'));
    for (const book of sections) {
      for (const entry of book.entries) {
        if (entry.verseStart === undefined) continue;
        expect(serialized).not.toContain(entry.id);
        expect(serialized).not.toContain(`"verseStart":${entry.verseStart}`);
      }
    }
  });

  it('carries no title or intro prose under refs-only', () => {
    const serialized = JSON.stringify(outlinesForProfile(sections, 'refs-only'));
    for (const book of sections) {
      if (book.intro) expect(serialized).not.toContain(book.intro);
      for (const entry of book.entries) {
        if (entry.title.length >= 24) expect(serialized).not.toContain(entry.title);
      }
    }
  });
});

describe('the public profile ships owned content only', () => {
  // A publishable build whose divisions this
  // project owns outright, so no gate is needed for licensing reasons.
  it('ships the BSB sections under the deployed profile', () => {
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

/*
 * The probe-baseline describe that used to follow has been removed.
 *
 * It guarded a set of search probes derived from a licensed third-party
 * compilation at verify time, so that the compilation shrinking could not
 * quietly weaken the gate that kept it out of a build. There is no such
 * compilation in this repository, nothing reads one, and no profile can ask
 * for one — so the probe set it guarded does not exist to erode.
 *
 * What protects the same property now is `npm run verify:no-private-data`,
 * which fails closed if licensed material is tracked at all, and has floors of
 * its own so it cannot pass by examining nothing.
 */
