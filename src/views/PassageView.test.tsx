/**
 * PassageView behaviour, against the real data and a real (in-memory) database.
 *
 * Nothing here is mocked: the segments come from the shipped outlines, the text
 * comes from the vendored KJV, and the entries go through Dexie on
 * fake-indexeddb. That is deliberate — the failures worth catching here are
 * "this segment id does not resolve" and "the anchor lookup misses", and a stub
 * would hide both.
 *
 * It runs under both data profiles. `npm test` covers `full`;
 * `DATA_PROFILE=refs-only npm test` covers the profile GitHub Pages deploys,
 * where there is no outline layer at all and every segment is a whole chapter.
 * Fixtures are therefore taken from the data rather than written down, and the
 * few assertions that only mean something under one profile say so.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import PassageView from './PassageView';
import { findSegment, hasOutlineTitles, segmentTitle, segmentsForBook } from '../app/data';
import { StorageContextProvider } from '../app/storage';
import { segmentRef } from '../lib/passages';
import { DexieStorageProvider } from '../storage/db';
import versification from '../data/kjv/versification.json';
import type { StorageProvider } from '../storage/StorageProvider';
import type { Entry, NewEntry, PassageSegment, ScriptureRef } from '../types';

afterEach(cleanup);

const GENESIS = segmentsForBook('genesis');

/**
 * Fixtures are FOUND in whatever profile is loaded, never hardcoded.
 *
 * Three division schemes can be built — the purchased outlines, the BSB
 * sections, whole chapters — and they divide Genesis 78, 135 and 50 ways
 * respectively. An id written for one does not exist in the others, and this
 * file previously hardcoded ids that only `full` and `refs-only` carry. Under
 * `public`, the profile actually deployed, every fixture threw and 23 tests
 * failed — which nobody saw, because CI only ever ran `full`.
 */
const chapterVerses = (chapter: number): number => versification.genesis[chapter - 1];

/** A segment covering exactly one whole chapter. Present in every profile. */
const WHOLE_CHAPTER =
  GENESIS.find(
    (segment) =>
      segment.chapterStart === segment.chapterEnd &&
      segment.verseStart === 1 &&
      segment.verseEnd === chapterVerses(segment.chapterStart),
  )?.id ?? '';

/** Whatever this profile titles that segment — the assertion target, derived. */
const WHOLE_CHAPTER_TITLE = WHOLE_CHAPTER ? segmentTitle(findSegment('genesis', WHOLE_CHAPTER)!) : '';

/**
 * A segment spanning a chapter boundary. Only `full` has one in Genesis, so
 * tests that need it are gated rather than assuming it exists.
 */
const CROSS_CHAPTER = GENESIS.find((segment) => segment.chapterEnd > segment.chapterStart)?.id ?? '';

// Found rather than hardcoded: under `refs-only` every segment is uncovered.
const UNCOVERED = GENESIS.find((segment) => segment.kind === 'uncovered')?.id ?? '';

/** Any other segment, for asserting that entries do not bleed between them. */
const OTHER_SEGMENT = GENESIS.find((segment) => segment.id !== WHOLE_CHAPTER)?.id ?? '';

/** An id no profile divides Genesis at, so the stale-link path is exercised. */
const STALE = (() => {
  const ids = new Set(GENESIS.map((segment) => segment.id));
  for (let verse = 2; verse < 30; verse += 1) {
    const candidate = `genesis-1-${verse}-${verse}`;
    if (!ids.has(candidate)) return candidate;
  }
  throw new Error('no stale id available — every candidate is a real segment');
})();

let dbCount = 0;
const freshStorage = () => new DexieStorageProvider(`passage-view-${(dbCount += 1)}`);

/** A fixture segment, or a loud failure naming the id that has gone missing. */
function fixture(segmentId: string): PassageSegment {
  const segment = findSegment('genesis', segmentId);
  if (!segment) throw new Error(`fixture segment ${segmentId} is missing from the data`);
  return segment;
}

const refFor = (segmentId: string): ScriptureRef => segmentRef(fixture(segmentId), 'genesis');

/** Seed an entry anchored to a segment, the way the editor would. */
async function seedEntry(
  storage: StorageProvider,
  segmentId: string,
  fields: NewEntry,
): Promise<Entry> {
  await storage.open();
  return storage.createEntry({
    title: 'Untitled',
    date: '2026-09-13',
    kind: 'sermon',
    // A passage anchor always carries the resolved ref; the outline id is only
    // ever an addition to it.
    anchors: [{ kind: 'scripture', outlineEntryId: segmentId, ...refFor(segmentId) }],
    ...fields,
  });
}

function renderPassage(
  segmentId: string,
  storage: StorageProvider = freshStorage(),
  bookId = 'genesis',
) {
  return render(
    <StorageContextProvider provider={storage}>
      <PassageView bookId={bookId} segmentId={segmentId} />
    </StorageContextProvider>,
  );
}

/** Render and wait out both loads — the scripture and the journal. */
async function renderSettled(segmentId: string, storage?: StorageProvider) {
  const view = renderPassage(segmentId, storage);
  // Every Spinner is a role="status"; when none are left, both reads are done.
  await waitFor(() => expect(screen.queryAllByRole('status')).toHaveLength(0));
  return view;
}

describe('PassageView — the passage itself', () => {
  it('takes its heading from segmentTitle, never from an assumed outline title', async () => {
    const segment = fixture(WHOLE_CHAPTER);
    renderPassage(WHOLE_CHAPTER);

    const heading = await screen.findByRole('heading', { level: 1 });
    // Under `refs-only` there is no title and this is the reference instead.
    expect(heading).toHaveTextContent(segmentTitle(segment));
    expect(heading).toHaveTextContent(WHOLE_CHAPTER_TITLE);
  });

  it('shows the canonical reference exactly once', async () => {
    await renderSettled(WHOLE_CHAPTER);

    const shown = screen.getAllByText('Genesis 1');
    expect(shown).toHaveLength(1);
    // Under `full` the heading is the outline's title, so the reference is
    // printed beneath it. Under `refs-only` the heading already is the
    // reference, and printing it again would be noise.
    expect(shown[0].tagName === 'H1').toBe(!hasOutlineTitles);
  });

  // `public` has no uncovered spans at all — the BSB sections partition the
  // whole canon — so this shape exists only under `full` and `refs-only`.
  it.skipIf(!UNCOVERED)('titles an uncovered span with its reference, and does not repeat it underneath', async () => {
    const reference = fixture(UNCOVERED).ref;
    renderPassage(UNCOVERED);

    expect(await screen.findByRole('heading', { level: 1, name: reference })).toBeInTheDocument();
    // The heading already is the reference; printing it twice is noise.
    expect(screen.getAllByText(reference)).toHaveLength(1);
  });

  it('labels the text as the King James Version', async () => {
    renderPassage(WHOLE_CHAPTER);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'King James Version' }),
    ).toBeInTheDocument();
  });

  it('renders every verse of the passage with a superscript number', async () => {
    const { container } = renderPassage(WHOLE_CHAPTER);

    expect(
      await screen.findByText(/^In the beginning God created the heaven and the earth\.$/),
    ).toBeInTheDocument();

    const numbers = [...container.querySelectorAll('sup')].map((sup) => sup.textContent);
    expect(numbers).toHaveLength(31); // Genesis 1 has 31 verses.
    expect(numbers[0]).toBe('1');
    expect(numbers[30]).toBe('31');
  });

  it('numbers the verses in words for a screen reader, not just in superscript', async () => {
    const { container } = await renderSettled(WHOLE_CHAPTER);

    // A bare superscript is read straight into the first word — "1In the
    // beginning" — so the spoken number is its own short sentence, and the
    // decorative one is hidden to stop it being announced twice.
    expect(screen.getByText('Verse 1.')).toBeInTheDocument();
    for (const sup of container.querySelectorAll('sup')) {
      expect(sup).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('announces that scripture is loading before it arrives', () => {
    renderPassage(WHOLE_CHAPTER);

    // role="status" — the reader is told, not left on a blank page. Both the
    // scripture and the entry list report their own loading.
    const statuses = screen.getAllByRole('status').map((node) => node.textContent);
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Loading Genesis 1/),
        expect.stringMatching(/Loading your entries/),
      ]),
    );
  });

  it('announces the outcome of both loads, since a spinner leaving is silent', async () => {
    await renderSettled(WHOLE_CHAPTER);

    expect(screen.getByText('Genesis 1 loaded, 31 verses.')).toBeInTheDocument();
    expect(screen.getByText('No entries yet for Genesis 1.')).toBeInTheDocument();
  });

  // Gated on the shape, not the profile name: only `full` divides Genesis
  // across a chapter boundary. `public` (BSB sections) and `refs-only` have no
  // such segment, so there is nothing here for them to assert.
  /*
   * The cross-chapter test that stood here has been removed, for the same
   * reason as its sibling in BookView.test.tsx: no shipped division crosses a
   * chapter boundary any more. The BSB sections never do, and `refs-only`
   * segments are whole chapters by construction, so it was skipped under every
   * profile and measured nothing.
   *
   * The view still marks each chapter in a multi-chapter passage; the case
   * below — that it marks none in a single-chapter one — is the half that can
   * still be exercised against real data.
   */

  it('does not mark chapters on a passage that stays inside one', async () => {
    renderPassage(WHOLE_CHAPTER);

    await screen.findByText(/^In the beginning God created/);
    expect(screen.queryByRole('heading', { name: /^Genesis chapter/ })).toBeNull();
  });

  it('keeps heading levels in order and never skips one', async () => {
    // The cross-chapter passage is the shape that adds an h3, so it is the one
    // worth checking where it exists; under `refs-only` no segment crosses a
    // chapter, and the h1/h2 order still has to hold.
    await renderSettled(CROSS_CHAPTER || WHOLE_CHAPTER);

    const levels = screen.getAllByRole('heading').map((node) => Number(node.tagName.slice(1)));
    expect(levels[0]).toBe(1);
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]).toBeLessThanOrEqual(levels[i - 1] + 1);
    }
  });
});

describe('PassageView — writing', () => {
  it('offers an Add entry action anchored by segment id', async () => {
    renderPassage(WHOLE_CHAPTER);

    const links = await screen.findAllByRole('link', { name: 'Add entry for this passage' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      // The segment id is what the editor reads to pre-fill the scripture anchor.
      expect(link).toHaveAttribute('href', `#/entry/new?anchor=${WHOLE_CHAPTER}`);
    }
  });

  it.skipIf(!UNCOVERED)('offers the same action on an uncovered span', async () => {
    renderPassage(UNCOVERED);

    const links = await screen.findAllByRole('link', { name: 'Add entry for this passage' });
    expect(links[0]).toHaveAttribute('href', `#/entry/new?anchor=${UNCOVERED}`);
  });

  it('keeps Add entry reachable below the entries already written here', async () => {
    const storage = freshStorage();
    await seedEntry(storage, WHOLE_CHAPTER, { title: 'Sunday morning' });
    await renderSettled(WHOLE_CHAPTER, storage);

    // One above the passage and one below the notes: on a phone the only other
    // way back to writing is scrolling past a whole chapter of scripture.
    const [, below] = screen.getAllByRole('link', { name: 'Add entry for this passage' });
    const entryLink = screen.getByRole('link', { name: 'Sunday morning' });
    expect(entryLink.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('PassageView — entries already written here', () => {
  it('lists the entries anchored to this passage, with date, kind, speaker and place', async () => {
    const storage = freshStorage();
    const entry = await seedEntry(storage, WHOLE_CHAPTER, {
      title: 'Sunday morning',
      kind: 'sermon',
      date: '2026-09-13',
      speaker: 'Rico Tice',
      place: 'All Souls, London',
    });
    const { container } = renderPassage(WHOLE_CHAPTER, storage);

    const link = await screen.findByRole('link', { name: 'Sunday morning' });
    expect(link).toHaveAttribute('href', `#/entry/${entry.id}`);
    expect(screen.getByText('Sermon')).toBeInTheDocument();
    expect(screen.getByText('Rico Tice')).toBeInTheDocument();
    expect(screen.getByText('All Souls, London')).toBeInTheDocument();
    expect(container.querySelector('time')).toHaveAttribute('datetime', '2026-09-13');
  });

  it('does not list entries anchored to a different passage', async () => {
    const storage = freshStorage();
    await seedEntry(storage, WHOLE_CHAPTER, { title: 'Belongs here' });
    await seedEntry(storage, OTHER_SEGMENT, { title: 'Belongs elsewhere' });
    renderPassage(WHOLE_CHAPTER, storage);

    expect(await screen.findByText('Belongs here')).toBeInTheDocument();
    expect(screen.queryByText('Belongs elsewhere')).toBeNull();
  });

  it('invites the first note when nothing is anchored here', async () => {
    renderPassage(WHOLE_CHAPTER);

    expect(await screen.findByText('Nothing written here yet')).toBeInTheDocument();
    expect(screen.getByText(/The first note on Genesis 1 can be yours\./)).toBeInTheDocument();
  });

  it('is untroubled by an entry that is anchored to nothing at all', async () => {
    const storage = freshStorage();
    await storage.open();
    // Anchors are optional: an entry written from the timeline has none, and it
    // must neither appear here nor break the read that looks for them.
    await storage.createEntry({ title: 'Anchored to nothing', anchors: [] });
    await renderSettled(WHOLE_CHAPTER, storage);

    expect(screen.queryByText('Anchored to nothing')).toBeNull();
    expect(screen.getByText('Nothing written here yet')).toBeInTheDocument();
  });
});

describe('PassageView — moving through the book', () => {
  it('links to the previous and next segments and back to the book', async () => {
    // Ids differ by profile; the second segment of Genesis exists under both.
    const [first, second, third] = GENESIS;
    renderPassage(second.id);

    expect(await screen.findByRole('link', { name: /^Previous/ })).toHaveAttribute(
      'href',
      `#/passage/genesis/${first.id}`,
    );
    expect(screen.getByRole('link', { name: /^Next/ })).toHaveAttribute(
      'href',
      `#/passage/genesis/${third.id}`,
    );
    expect(screen.getByRole('link', { name: 'All of Genesis' })).toHaveAttribute(
      'href',
      '#/book/genesis',
    );
  });

  it('never shows the previous passage under the next passage heading', async () => {
    const [first, second] = GENESIS;
    const storage = freshStorage();
    await seedEntry(storage, first.id, { title: 'Written on the first passage' });

    const view = (segmentId: string) => (
      <StorageContextProvider provider={storage}>
        <PassageView bookId="genesis" segmentId={segmentId} />
      </StorageContextProvider>
    );

    const { rerender } = render(view(first.id));
    await waitFor(() => expect(screen.queryAllByRole('status')).toHaveLength(0));
    expect(screen.getByText('Written on the first passage')).toBeInTheDocument();

    rerender(view(second.id));

    // Moving through the book re-renders this same component instance, so both
    // reads are still holding the first passage's answer. Neither the scripture
    // nor the notes may be shown under the new heading: a note filed against
    // Genesis 1 appearing under Genesis 2 is a lie about the journal.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(segmentTitle(second));
    expect(screen.queryByText('Written on the first passage')).toBeNull();
    expect(screen.queryByText(/^In the beginning God created/)).toBeNull();
  });

  it('omits the previous link on the first segment of a book', async () => {
    renderPassage(GENESIS[0].id);

    await screen.findByRole('link', { name: /^Next/ });
    expect(screen.queryByRole('link', { name: /^Previous/ })).toBeNull();
  });
});

describe('PassageView — a segment that does not exist', () => {
  it('says so plainly and offers the way back to the book', () => {
    renderPassage('genesis-does-not-exist');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Passage not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse all of Genesis' })).toHaveAttribute(
      'href',
      '#/book/genesis',
    );
    // Nothing to guess from, so nothing is guessed.
    expect(screen.queryByRole('link', { name: /^Read / })).toBeNull();
  });

  it('offers the passage that contains the reference the stale id named', () => {
    // A verse range is no division in either profile — the shape of a link from
    // a journal written before a re-ingest, or under the other data profile.
    renderPassage(STALE);

    const rescue = screen.getByRole('link', { name: /^Read / });
    expect(rescue).toHaveAttribute('href', `#/passage/genesis/${WHOLE_CHAPTER}`);
    expect(rescue).toHaveTextContent(segmentTitle(fixture(WHOLE_CHAPTER)));
  });

  it('does not crash on a book id that is not a book', () => {
    renderPassage('nope-1', freshStorage(), 'nope');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Passage not found' }),
    ).toBeInTheDocument();
    // No book to browse, so the offer is the whole Bible instead.
    expect(screen.getByRole('link', { name: 'Browse the Bible' })).toHaveAttribute(
      'href',
      '#/browse',
    );
  });
});
