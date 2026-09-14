import { describe, expect, it } from 'vitest';

import { BOOKS } from '../../scripts/lib/books.mjs';
import { BOOK_NAMES, BOOK_ORDER, BOOK_TESTAMENT, CANON, byCanonicalOrder } from './canon';

describe('the canon table', () => {
  // canon.ts is duplicated from the ingest's table so the app need not import
  // build scripts. This is the guard that keeps them identical.
  it('matches the table the ingest parses with', () => {
    expect(Object.keys(BOOK_NAMES)).toHaveLength(66);
    for (const book of BOOKS) {
      expect(BOOK_NAMES[book.id], book.id).toBe(book.name);
      expect(BOOK_ORDER[book.id], book.id).toBe(book.order);
      expect(BOOK_TESTAMENT[book.id], book.id).toBe(book.testament);
    }
  });

  it('lists the canon in order, Genesis to Revelation', () => {
    expect(CANON[0]).toBe('genesis');
    expect(CANON[65]).toBe('revelation');
    expect(CANON).toHaveLength(66);
  });

  it('sorts by canonical order, not alphabetically', () => {
    const shuffled = ['revelation', 'genesis', 'matthew', 'exodus'];
    expect([...shuffled].sort(byCanonicalOrder)).toEqual(['genesis', 'exodus', 'matthew', 'revelation']);
  });
});
