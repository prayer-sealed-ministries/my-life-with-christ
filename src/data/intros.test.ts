import { describe, expect, it } from 'vitest';

import intros from './intros.json';
import versification from './kjv/versification.json';
import { examinedAtLeast } from '../testing/floor';

const provenance = intros._provenance as {
  reserved_for_owner: { count: number; books: Record<string, string>; how: Record<string, string> };
  drafted: { books: string[] };
};
// Each reserved book names the exposure that caused it, not just its id — a
// count is not a provenance record.
const reservedExposure = provenance.reserved_for_owner.books;
const reserved = Object.keys(reservedExposure);
const claimed = provenance.drafted.books;
const actual = Object.keys(intros).filter((key) => !key.startsWith('_'));
const counts = versification as Record<string, number[]>;

describe('introductions', () => {
  it('has some to check', () => {
    examinedAtLeast(actual.length, 5, 'drafted introductions');
  });

  it('names a real book and says something substantial', () => {
    for (const bookId of actual) {
      expect(counts[bookId], `${bookId} is not a book id`).toBeDefined();
      const text = (intros as unknown as Record<string, string>)[bookId];
      expect(text.split(/\s+/).length, bookId).toBeGreaterThan(80);
      expect(text.split('\n\n').length, `${bookId} should be more than one paragraph`).toBeGreaterThan(1);
    }
  });
});

describe('the provenance record matches reality', () => {
  // The record went stale the moment a batch was added, and the staleness was
  // invisible — it still read as an accurate account of who wrote what. A
  // provenance record nobody checks is a claim, not a record.
  it('declares exactly the introductions that exist', () => {
    expect([...claimed].sort()).toEqual([...actual].sort());
  });

  it('never drafts a book reserved for the owner', () => {
    const violations = actual.filter((bookId) => reserved.includes(bookId));
    expect(
      violations,
      `these were reserved because the purchased intro was read: ${violations.join(', ')}`,
    ).toEqual([]);
  });

  it('names every reserved book and the exposure that caused it', () => {
    // First recorded as eight and wrong: Song of Solomon and Psalms had been
    // read in full, and Isaiah's opening, in output from a different command.
    // Both were one batch from being drafted.
    examinedAtLeast(reserved.length, 11, 'books recorded as exposed');
    expect(provenance.reserved_for_owner.count).toBe(reserved.length);

    for (const bookId of reserved) {
      expect(counts[bookId], `${bookId} is not a book id`).toBeDefined();
      expect(
        reservedExposure[bookId],
        `${bookId} is reserved with no exposure recorded`,
      ).toMatch(/read/);
    }

    // The three added on correction must stay named, with how they were seen.
    for (const bookId of ['song-of-solomon', 'psalms', 'isaiah']) {
      expect(reserved, `${bookId} was read but is not reserved`).toContain(bookId);
    }
    expect(Object.keys(provenance.reserved_for_owner.how).length).toBeGreaterThan(1);
  });

  it('accounts for every book exactly once', () => {
    const overlap = claimed.filter((bookId) => reserved.includes(bookId));
    expect(overlap, 'a book is both reserved and claimed as drafted').toEqual([]);

    // The drafting is finished, so the two lists now have to cover the canon
    // between them. Until they did, a book could sit with no introduction and
    // no recorded reason, which is indistinguishable from one that was
    // forgotten. Either it is drafted, or it is reserved and the exposure that
    // reserved it is named.
    const canon = Object.keys(counts);
    examinedAtLeast(canon.length, 66, 'books in the canon');
    const unaccounted = canon.filter(
      (bookId) => !claimed.includes(bookId) && !reserved.includes(bookId),
    );
    expect(
      unaccounted,
      `no introduction and no recorded reason: ${unaccounted.join(', ')}`,
    ).toEqual([]);
    expect(claimed.length + reserved.length).toBe(canon.length);
  });
});

/*
 * The independence check that used to live here has been removed, not
 * disabled.
 *
 * It compared every sentence and every eight-word phrase of these intros
 * against the introductions in a licensed third-party compilation, to prove
 * nothing had been copied or paraphrased. That compilation is not in this
 * repository and cannot be read by anything in it, so the comparison has no
 * left-hand side: it would have had to be skipped, and a skipped check is one
 * that examines nothing.
 *
 * What replaces it is the provenance the file states about itself, asserted
 * above, and the fact that there is no longer any licensed prose here to copy
 * from. See DATA-LICENSE.md.
 */
