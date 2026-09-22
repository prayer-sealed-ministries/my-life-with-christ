/**
 * What this costs, and what it leaves in the archive.
 *
 * The cost question is narrow on purpose: the read itself is `listEntries()`,
 * the same whole-journal read the search view already makes and already
 * measured at 5,000 entries. What is NEW here is the pass over those entries,
 * so that is what is measured — and it is measured rather than asserted to be
 * cheap.
 */

import { describe, expect, it } from 'vitest';

import { recentDetails } from './recent-details';
import { buildJourneyJson } from '../export/archive';
import type { Entry } from '../types';

const journal = (count: number): Entry[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `e${index}`,
    kind: 'sermon' as const,
    title: `Sunday ${index}`,
    // Newest first, as `listEntries()` hands them over.
    date: `2026-01-01`,
    anchors: [],
    scriptureRefs: [],
    notes: 'Notes.',
    reflection: '',
    links: [],
    tags: [],
    forDescendants: false,
    visibility: 'private' as const,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    // A realistic spread: a handful of churches and preachers, many Sundays.
    place: `Church ${index % 7}`,
    speaker: `Speaker ${index % 11}`,
    sermonSeries: `Series ${index % 5}`,
  }));

describe('the cost of deriving suggestions', () => {
  it.each([100, 1_000, 5_000])('is small over %i entries', (count) => {
    const entries = journal(count);

    const started = performance.now();
    const details = recentDetails(entries);
    const elapsed = performance.now() - started;

    // The floor: it really did the work being timed.
    expect(details.speaker.length, 'nothing was derived, so nothing was measured').toBeGreaterThan(
      0,
    );
    // Generous on purpose — this is a guard against an accidental quadratic,
    // not a benchmark. A scan of 5,000 entries is single-digit milliseconds.
    expect(elapsed, `deriving from ${count} entries took ${elapsed.toFixed(1)}ms`).toBeLessThan(150);
  });

  it('stops reading once every field is full', () => {
    /*
     * Proved by making the rest of the journal unreadable rather than by
     * timing it. A clock says a scan was fast; an entry that throws when its
     * fields are touched says the scan never reached it, which is the actual
     * claim.
     */
    const enough = journal(40);
    const poisoned = Array.from({ length: 5_000 }, (_, index) => {
      const entry = { ...journal(1)[0], id: `poison-${index}` };
      for (const field of ['place', 'speaker', 'sermonSeries'] as const) {
        Object.defineProperty(entry, field, {
          get() {
            throw new Error(`read ${field} of an entry past the point of usefulness`);
          },
        });
      }
      return entry;
    });

    expect(() => recentDetails([...enough, ...poisoned])).not.toThrow();

    /*
     * And it stops PULLING them, not merely stops reading their fields.
     *
     * Those are two different guards — an inner one that skips a field once
     * its list is full, and an outer one that gives up on the journal — and
     * the poison above only proves the first. Counting what the iterator
     * hands over proves the second, which is otherwise invisible.
     */
    let pulled = 0;
    const counting = {
      *[Symbol.iterator]() {
        for (const entry of [...enough, ...poisoned]) {
          pulled += 1;
          yield entry;
        }
      },
    } as unknown as Entry[];

    recentDetails(counting);
    expect(pulled, 'the whole journal was walked after the answer was known').toBeLessThan(
      enough.length + 5,
    );
    // And the floor: the readable head really did fill every field, so the
    // early exit is what stopped it rather than there being nothing to find.
    const details = recentDetails(enough);
    for (const values of Object.values(details)) expect(values.length).toBeGreaterThan(0);
  });
});

describe('what the archive carries', () => {
  it('carries no suggestions, because there are none to carry', () => {
    const context = {
      exportedAt: '2026-03-01T10:00:00.000Z',
      entries: journal(3),
      drafts: [],
    } as unknown as Parameters<typeof buildJourneyJson>[0];

    const envelope = buildJourneyJson(context);

    // Suggestions are derived from the entries the archive already holds.
    // Anything cached, ranked or remembered about them would be a second copy
    // of the truth, and the archive is the truth.
    expect(Object.keys(envelope).sort()).toEqual(['entries', 'exportedAt', 'format', 'version']);
  });

  it('offers the restored journal’s own details after a restore', () => {
    // A restore replaces the entries; suggestions follow from those, with no
    // separate state to rebuild or to go stale.
    const restored = [
      { ...journal(1)[0], id: 'r1', speaker: 'Pastor John', place: 'City Gate Church' },
    ];
    expect(recentDetails(restored)).toEqual({
      place: ['City Gate Church'],
      speaker: ['Pastor John'],
      sermonSeries: ['Series 0'],
    });
  });
});
