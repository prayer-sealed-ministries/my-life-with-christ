/**
 * The set of kinds, and the one that was taken out of it.
 *
 * `service` was removed because it earned nothing: the same editor as `sermon`,
 * the same fields, and no copy anywhere in the app saying what set them apart.
 * See the note on `EntryKind` in src/types.
 *
 * The reason this file exists is that removing it is not self-enforcing. Every
 * surface — the editor dropdown, the search filters, the export headings, the
 * route parser — derives its list from ENTRY_KINDS, which is exactly what makes
 * re-adding one string enough to put Service back on six screens at once. Every
 * other test in the repo would still pass, because they all loop over whatever
 * ENTRY_KINDS happens to contain. A list-derived test cannot notice a change to
 * the list.
 *
 * So this asserts the membership directly, in both directions: the five that
 * belong are present, and the retired one is absent. Same shape as
 * scripts/__tests__/branding.test.mjs, and for the same reason — a guard that
 * only forbade the old value would be satisfied by deleting all of them.
 */

import { describe, expect, it } from 'vitest';

import type { EntryKind } from '../types';
import {
  ENTRY_KINDS,
  ENTRY_KIND_LABELS,
  RETIRED_ENTRY_KINDS,
  isEntryKind,
  resolveEntryKind,
} from './entry-kinds';

describe('the canonical set', () => {
  it('is exactly the five kinds a reader can choose', () => {
    expect([...ENTRY_KINDS]).toEqual(['sermon', 'reading', 'prayer', 'reflection', 'letter']);
  });

  it('does not offer service, in the list or in the labels', () => {
    expect((ENTRY_KINDS as readonly string[]).includes('service')).toBe(false);
    expect(Object.keys(ENTRY_KIND_LABELS)).not.toContain('service');
    // The guard from the outside too: nothing may accept it as a kind, so a
    // hash somebody bookmarked while it existed cannot reintroduce one.
    expect(isEntryKind('service')).toBe(false);
  });

  it('gives every kind a label, and no label an em-dash or a sentence', () => {
    // The floor: a loop over an empty list proves nothing.
    expect(ENTRY_KINDS.length).toBe(5);
    for (const kind of ENTRY_KINDS) {
      const label = ENTRY_KIND_LABELS[kind];
      expect(label, `${kind} needs a label`).toBeTruthy();
      // The chooser is a <select>. A description belongs in the product, not
      // crammed into an option, and an option long enough to clip is the bug
      // tests/e2e/focus.spec.ts measures.
      expect(label.length, `${kind}: "${label}" is too long for an option`).toBeLessThan(20);
    }
  });
});

describe('a kind this build no longer offers', () => {
  it('reads service as a sermon, not as the generic fallback', () => {
    // Not a coin toss: a service entry carries a speaker, a place and notes on
    // what was taught. Reading it as a reflection would file somebody's Easter
    // morning under the wrong heading in their own book.
    expect(RETIRED_ENTRY_KINDS.service).toBe('sermon');
    expect(resolveEntryKind('service')).toBe('sermon');
  });

  it('keeps a kind this build does know', () => {
    for (const kind of ENTRY_KINDS) expect(resolveEntryKind(kind)).toBe(kind);
  });

  it('says null for something that was never a kind, rather than guessing', () => {
    // Null and 'reflection' are different answers. The callers apply their own
    // fallback and warn about it; a resolver that quietly returned a kind would
    // make an archive's unknown-kind warning impossible to raise.
    for (const value of ['worship', 'communion', 'SERMON', '', 'sermons', null, 7, {}]) {
      expect(resolveEntryKind(value), `${JSON.stringify(value)}`).toBeNull();
    }
  });

  it('retires to a kind that still exists', () => {
    // A mapping to a kind that was itself later removed would send an archive
    // through a rename into nothing.
    const targets = Object.values(RETIRED_ENTRY_KINDS);
    expect(targets.length).toBeGreaterThan(0);
    for (const target of targets) expect(isEntryKind(target satisfies EntryKind)).toBe(true);
  });
});
