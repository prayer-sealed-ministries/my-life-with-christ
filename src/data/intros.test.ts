import { describe, expect, it } from 'vitest';

import intros from './intros.json';
import outlines from './outlines.json';
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
  });
});

describe('drafted prose is independent of the purchased introductions', () => {
  it('shares no sentence with any purchased introduction', () => {
    const purchased = new Set<string>();
    for (const book of outlines as Array<{ intro?: string }>) {
      for (const sentence of (book.intro ?? '').split(/(?<=[.!?])\s+/)) {
        const trimmed = sentence.trim();
        if (trimmed.length >= 24) purchased.add(trimmed);
      }
    }
    examinedAtLeast(purchased.size, 100, 'purchased sentences to compare against');

    const collisions: string[] = [];
    for (const bookId of actual) {
      for (const sentence of (intros as unknown as Record<string, string>)[bookId].split(/(?<=[.!?])\s+/)) {
        const trimmed = sentence.trim();
        if (trimmed.length >= 24 && purchased.has(trimmed)) collisions.push(`${bookId}: ${trimmed}`);
      }
    }
    expect(collisions.join('\n')).toBe('');
  });

  it('shares no long phrase with a purchased introduction', () => {
    // Sentence equality is a weak test; an eight-word run is a stronger one.
    const shingles = new Set<string>();
    for (const book of outlines as Array<{ intro?: string }>) {
      const words = (book.intro ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      for (let i = 0; i + 8 <= words.length; i += 1) shingles.add(words.slice(i, i + 8).join(' '));
    }
    examinedAtLeast(shingles.size, 500, 'eight-word phrases from the purchased intros');

    const collisions: string[] = [];
    for (const bookId of actual) {
      const words = (intros as unknown as Record<string, string>)[bookId].toLowerCase().split(/\s+/).filter(Boolean);
      for (let i = 0; i + 8 <= words.length; i += 1) {
        const phrase = words.slice(i, i + 8).join(' ');
        if (shingles.has(phrase)) collisions.push(`${bookId}: "${phrase}"`);
      }
    }
    expect(collisions.join('\n')).toBe('');
  });
});
