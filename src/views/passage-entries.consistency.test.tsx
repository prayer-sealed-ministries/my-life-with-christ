/**
 * The passage page and the passage-history page must agree about which entries
 * belong to a passage.
 *
 * They did not. "Your entries on this passage" asked the storage primitive
 * `findEntriesForExactAnchor({kind:'scripture', ...ref})`, which matches an
 * anchor whose range is byte-for-byte the segment's. A note anchored to
 * John 15:5 was therefore absent from John 15:1-17 — the reader's own writing,
 * missing from the passage they wrote it about — while the history page,
 * which uses range overlap, listed it.
 *
 * Both now go through `entriesAnchoredTo`, so the inclusion rule is one
 * function and the two surfaces cannot drift apart again. These tests hold that
 * from the product surface: the sets are compared as rendered, not as computed.
 *
 * Fixtures are found in whatever profile is loaded, never hardcoded — three
 * division schemes divide a book differently and an id written for one does not
 * exist in the others.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import PassageView from './PassageView';
import PassageHistoryView from './PassageHistoryView';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { findSegment, segmentsForBook } from '../app/data';
import { segmentRef } from '../lib/passages';
import { refLabel } from '../lib/search';
import { ENTRY_KINDS } from '../lib/entry-kinds';
import { DexieStorageProvider } from '../storage/db';
import type { DraftForm, Entry, EntryKind, ScriptureRef } from '../types';

afterEach(cleanup);

const BOOK = 'john';
const SEGMENTS = segmentsForBook(BOOK);

/**
 * A segment covering more than one verse, so "inside it" is a real place.
 *
 * Under `refs-only` every segment is a whole chapter; under `public` they are
 * BSB section spans. Either way one of them spans several verses.
 */
const WIDE = SEGMENTS.find((segment) => {
  const ref = segmentRef(segment, BOOK);
  return ref.chapterEnd > ref.chapterStart || ref.verseEnd - ref.verseStart >= 3;
});

if (!WIDE) throw new Error('no multi-verse segment in John under this profile');

const WIDE_REF: ScriptureRef = segmentRef(WIDE, BOOK);

/** A verse comfortably inside that segment. */
const INSIDE = { chapter: WIDE_REF.chapterStart, verse: WIDE_REF.verseStart + 1 };

let dbCount = 0;
const fresh = () => new DexieStorageProvider(`passage-consistency-${(dbCount += 1)}`);

const at = (book: string, cs: number, vs: number, ce = cs, ve = vs) =>
  ({ kind: 'scripture' as const, book, chapterStart: cs, verseStart: vs, chapterEnd: ce, verseEnd: ve });

let seq = 0;
const entry = (overrides: Partial<Entry> & { id: string }): Entry => ({
  kind: 'sermon',
  title: `Entry ${(seq += 1)}`,
  date: '2026-03-01',
  anchors: [],
  scriptureRefs: [],
  notes: '',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  ...overrides,
});

/** Titles listed under "Your entries on this passage". */
async function passageEntries(storage: DexieStorageProvider, segmentId: string): Promise<string[]> {
  render(
    <RouterProvider>
      <StorageContextProvider provider={storage}>
        <PassageView bookId={BOOK} segmentId={segmentId} />
      </StorageContextProvider>
    </RouterProvider>,
  );
  await waitFor(() => expect(screen.queryAllByRole('status')).toHaveLength(0));

  const section = screen
    .getByRole('heading', { name: 'Your entries on this passage' })
    .closest('section') as HTMLElement;
  const titles = within(section)
    .queryAllByRole('article')
    .map((card) => within(card).getByRole('link').textContent ?? '');
  cleanup();
  return titles.sort();
}

/** Titles listed on "My history with …" for the same canonical passage. */
async function historyEntries(storage: DexieStorageProvider, ref: ScriptureRef): Promise<string[]> {
  const reference = refLabel(ref);
  window.location.hash = `#/history/${encodeURIComponent(reference)}`;
  render(
    <RouterProvider>
      <StorageContextProvider provider={storage}>
        <PassageHistoryView reference={reference} />
      </StorageContextProvider>
    </RouterProvider>,
  );
  await waitFor(() =>
    expect(
      screen.queryAllByRole('article').length > 0 ||
        screen.queryByText(/You haven’t written about/) !== null,
    ).toBe(true),
  );
  const titles = screen.queryAllByRole('article').map((card) => within(card).getByRole('link').textContent ?? '');
  cleanup();
  window.location.hash = '';
  return titles.sort();
}

async function seeded(entries: Entry[]): Promise<DexieStorageProvider> {
  const storage = fresh();
  await storage.open();
  await storage.putEntries(entries);
  return storage;
}

describe('a passage lists the entries that overlap it', () => {
  it('includes an entry anchored to a single verse inside the passage', async () => {
    // The exact defect: a note on one verse, invisible on the passage holding it.
    const storage = await seeded([
      entry({ id: 'inside', title: 'A verse inside', anchors: [at(BOOK, INSIDE.chapter, INSIDE.verse)] }),
    ]);
    expect(await passageEntries(storage, WIDE.id)).toEqual(['A verse inside']);
  });

  it('includes an entry whose saved range contains the whole passage', async () => {
    const storage = await seeded([
      entry({
        id: 'wider',
        title: 'A wider range',
        anchors: [at(BOOK, WIDE_REF.chapterStart, 1, WIDE_REF.chapterEnd, WIDE_REF.verseEnd + 5)],
      }),
    ]);
    expect(await passageEntries(storage, WIDE.id)).toEqual(['A wider range']);
  });

  it('includes an entry whose range only partly overlaps', async () => {
    const storage = await seeded([
      entry({
        id: 'straddle',
        title: 'Straddling the edge',
        // Starts before the segment and ends inside it.
        anchors: [at(BOOK, WIDE_REF.chapterStart, 1, WIDE_REF.chapterStart, WIDE_REF.verseStart)],
      }),
    ]);
    expect(await passageEntries(storage, WIDE.id)).toEqual(['Straddling the edge']);
  });

  it('excludes a verse in the same book that the passage does not reach', async () => {
    // Same book, no overlap — the case that proves this is not just "same book".
    const faraway = WIDE_REF.chapterStart === 1 ? 21 : 1;
    const storage = await seeded([
      entry({ id: 'elsewhere', title: 'Elsewhere in John', anchors: [at(BOOK, faraway, 1)] }),
    ]);
    expect(await passageEntries(storage, WIDE.id)).toEqual([]);
  });

  it('excludes the same chapter and verse in another book', async () => {
    const storage = await seeded([
      entry({
        id: 'mark',
        title: 'Mark, not John',
        anchors: [at('mark', INSIDE.chapter, INSIDE.verse)],
      }),
    ]);
    expect(await passageEntries(storage, WIDE.id)).toEqual([]);
  });

  it('lists an entry once when several of its anchors overlap', async () => {
    const storage = await seeded([
      entry({
        id: 'twice',
        title: 'Anchored twice',
        anchors: [
          at(BOOK, INSIDE.chapter, INSIDE.verse),
          at(BOOK, WIDE_REF.chapterStart, WIDE_REF.verseStart, WIDE_REF.chapterEnd, WIDE_REF.verseEnd),
        ],
      }),
    ]);
    // One entry, however many ways it is attached.
    expect(await passageEntries(storage, WIDE.id)).toEqual(['Anchored twice']);
  });

  it('keeps every kind of entry eligible', async () => {
    const storage = await seeded(
      ENTRY_KINDS.map((kind) =>
        entry({ id: kind, title: `A ${kind}`, kind: kind as EntryKind, anchors: [at(BOOK, INSIDE.chapter, INSIDE.verse)] }),
      ),
    );
    expect(await passageEntries(storage, WIDE.id)).toHaveLength(ENTRY_KINDS.length);
  });

  it('never lists unfinished writing', async () => {
    const storage = await seeded([
      entry({ id: 'saved', title: 'A saved one', anchors: [at(BOOK, INSIDE.chapter, INSIDE.verse)] }),
    ]);
    const form: DraftForm = {
      kind: 'prayer', title: 'Half-written', date: '2026-06-01', place: '', speaker: '',
      sermonSeries: '', notes: 'unfinished', reflection: '', prayer: '', tagsText: '',
      links: [], anchors: [at(BOOK, INSIDE.chapter, INSIDE.verse)], forDescendants: false,
      scriptureRefs: [], sourceMaterial: null,
    };
    await storage.putDraft({
      id: 'd1', form, createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z',
    });
    expect(await passageEntries(storage, WIDE.id)).toEqual(['A saved one']);
  });
});

/**
 * The regression that matters.
 *
 * Presentation differs on purpose — the history page groups by year and orders
 * oldest first — but which entries are included must not.
 */
describe('the passage page and the history page include the same entries', () => {
  const corpus = (): Entry[] => [
    entry({ id: 'c1', title: 'Verse inside', anchors: [at(BOOK, INSIDE.chapter, INSIDE.verse)] }),
    entry({
      id: 'c2', title: 'Exactly the passage',
      anchors: [at(BOOK, WIDE_REF.chapterStart, WIDE_REF.verseStart, WIDE_REF.chapterEnd, WIDE_REF.verseEnd)],
    }),
    entry({
      id: 'c3', title: 'Wider than the passage', date: '2024-01-01',
      anchors: [at(BOOK, WIDE_REF.chapterStart, 1, WIDE_REF.chapterEnd, WIDE_REF.verseEnd + 5)],
    }),
    entry({ id: 'c4', title: 'Another book', anchors: [at('mark', INSIDE.chapter, INSIDE.verse)] }),
    entry({ id: 'c5', title: 'No anchors at all' }),
    entry({
      id: 'c6', title: 'Anchored twice', date: '2029-01-01',
      anchors: [at(BOOK, INSIDE.chapter, INSIDE.verse), at(BOOK, INSIDE.chapter, INSIDE.verse + 1)],
    }),
  ];

  it('agrees for a multi-verse passage', async () => {
    const storage = await seeded(corpus());
    const fromPassage = await passageEntries(storage, WIDE.id);
    const fromHistory = await historyEntries(storage, WIDE_REF);

    expect(fromPassage).toEqual(fromHistory);
    // The floor: two empty lists agree perfectly and would prove nothing.
    expect(fromPassage.length).toBeGreaterThanOrEqual(3);
    expect(fromPassage).not.toContain('Another book');
    expect(fromPassage).not.toContain('No anchors at all');
  });

  it('agrees across every segment of the book', async () => {
    // One hand-picked passage could agree by luck. This walks the book.
    const storage = await seeded(corpus());
    let compared = 0;
    let nonEmpty = 0;

    for (const segment of SEGMENTS.slice(0, 12)) {
      const ref = segmentRef(segment, BOOK);
      const fromPassage = await passageEntries(storage, segment.id);
      const fromHistory = await historyEntries(storage, ref);
      expect(fromPassage, `segment ${segment.id}`).toEqual(fromHistory);
      compared += 1;
      if (fromPassage.length > 0) nonEmpty += 1;
    }

    expect(compared).toBe(12);
    // And at least some of them actually had entries, so the agreement is not
    // twelve comparisons of nothing with nothing.
    expect(nonEmpty).toBeGreaterThan(0);
  });

  it('agrees that a passage with nothing written on it has nothing', async () => {
    const storage = await seeded([entry({ id: 'x', title: 'Somewhere else', anchors: [at('romans', 8, 28)] })]);
    const far = SEGMENTS[SEGMENTS.length - 1];
    expect(await passageEntries(storage, far.id)).toEqual([]);
    expect(await historyEntries(storage, segmentRef(far, BOOK))).toEqual([]);
  });
});

describe('the fixtures are real', () => {
  it('found a multi-verse segment and a verse inside it', () => {
    // Every assertion above rests on these; if the profile ever stopped
    // producing them the tests would quietly compare nothing.
    expect(findSegment(BOOK, WIDE.id)).toBeTruthy();
    expect(SEGMENTS.length).toBeGreaterThan(5);
    expect(INSIDE.verse).toBeLessThanOrEqual(WIDE_REF.verseEnd);
    expect(INSIDE.verse).toBeGreaterThanOrEqual(WIDE_REF.verseStart);
  });
});
