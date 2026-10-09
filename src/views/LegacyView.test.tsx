/**
 * The print view, tested for the things a printed book would lose silently:
 * the front section coming first, both orderings keeping every entry, and the
 * three kinds of writing staying separate on the page.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import type { StorageProvider } from '../storage/StorageProvider';
import type { Entry } from '../types';
import LegacyView from './LegacyView';

/**
 * A journal that will not open: private browsing, or blocked site data.
 *
 * The distinction that matters here is between "you have written nothing" and
 * "your writing could not be read". Getting that wrong tells someone with ten
 * years of entries that they have none.
 */
const brokenStorage = (): StorageProvider => {
  const fail = () => Promise.reject(new Error('site data is blocked'));
  return {
    open: fail,
    getEntry: fail,
    listEntries: fail,
    listEntriesChronological: fail,
    createEntry: fail,
    updateEntry: fail,
    deleteEntry: fail,
    findEntriesForExactAnchor: fail,
    putEntries: fail,
    replaceEntries: fail,
    mergeJournal: fail,
    replaceJournal: fail,
    clearEntries: fail,
    putDraft: fail,
    getDraft: fail,
    getDraftForEntry: fail,
    listDrafts: fail,
    deleteDraft: fail,
    getSettings: fail,
    updateSettings: fail,
    listTags: fail,
    listSpeakers: fail,
    listPlaces: fail,
  };
};

const entry = (overrides: Partial<Entry> & { id: string }): Entry => ({
  kind: 'sermon',
  title: 'Untitled',
  date: '2026-03-15',
  anchors: [],
  scriptureRefs: [],
  notes: '',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-03-15T10:00:00.000Z',
  updatedAt: '2026-03-15T10:00:00.000Z',
  ...overrides,
});

const ROMANS = entry({
  id: 'entry-romans',
  title: 'Nothing can separate',
  date: '2026-03-15',
  place: 'First Baptist, Tallahassee, FL',
  speaker: 'Pastor James Whitfield',
  anchors: [
    { kind: 'scripture', book: 'romans', chapterStart: 8, verseStart: 31, chapterEnd: 8, verseEnd: 39 },
  ],
  notes: 'He walked the list: death, life, angels, principalities.',
  reflection: 'I have been living as though the list were still open.',
  prayer: 'Lord, close the list.',
});

const GENESIS = entry({
  id: 'entry-genesis',
  title: 'Back porch, Genesis 35',
  kind: 'reading',
  date: '2026-06-02',
  createdAt: '2026-06-02T10:00:00.000Z',
  updatedAt: '2026-06-02T10:00:00.000Z',
  anchors: [
    { kind: 'scripture', book: 'genesis', chapterStart: 35, verseStart: 1, chapterEnd: 35, verseEnd: 15 },
  ],
  notes: 'Jacob buries the foreign gods under the oak.',
});

const LETTER = entry({
  id: 'entry-letter',
  title: 'For Hannah, one day',
  kind: 'letter',
  date: '2026-04-20',
  createdAt: '2026-04-20T10:00:00.000Z',
  updatedAt: '2026-04-20T10:00:00.000Z',
  anchors: [{ kind: 'topic', topicId: 'humility' }],
  notes: 'What I would want her to know.',
  forDescendants: true,
});

/**
 * Grouped under Romans by its first anchor, but carrying a Genesis reference
 * too — the case where reading the book from one anchor and the position from
 * another files it in the wrong place inside its own section.
 */
const WHOLE_ROMANS = entry({
  id: 'entry-whole-romans',
  title: 'The whole letter, at once',
  date: '2026-05-10',
  createdAt: '2026-05-10T10:00:00.000Z',
  updatedAt: '2026-05-10T10:00:00.000Z',
  anchors: [
    { kind: 'book', book: 'romans' },
    { kind: 'scripture', book: 'genesis', chapterStart: 35, verseStart: 1, chapterEnd: 35, verseEnd: 15 },
  ],
});

const LONG_URL =
  'https://example.org/sermons/2026/the-whole-counsel-of-god-part-three-a-very-long-unbroken-path';

/** No date, an unknown topic, an unknown book, and an unbreakable word. */
const STRANGE = entry({
  id: 'entry-strange',
  title: 'Written on a plane',
  date: '',
  anchors: [
    { kind: 'topic', topicId: 'not-a-topic' },
    { kind: 'book', book: 'book-of-eli' },
  ],
  notes: LONG_URL,
});

let db: DexieStorageProvider;
let counter = 0;

const renderView = () =>
  render(
    <RouterProvider>
      <StorageContextProvider provider={db}>
        <LegacyView />
      </StorageContextProvider>
    </RouterProvider>,
  );

const headingText = (level: number) =>
  screen.getAllByRole('heading', { level }).map((node) => node.textContent);

beforeEach(async () => {
  counter += 1;
  db = new DexieStorageProvider(`journey-legacy-${counter}`);
  await db.open();
});

// Vitest globals are off in this project, so Testing Library never registers
// its own cleanup; without this, one test's DOM is still on the page in the next.
afterEach(cleanup);

describe('LegacyView', () => {
  it('prints the whole journal under one heading, oldest first', async () => {
    await db.putEntries([GENESIS, ROMANS]);
    renderView();

    expect(await screen.findByRole('heading', { level: 1, name: 'My Journey With Christ' })).toBeInTheDocument();

    const titles = await screen.findAllByRole('heading', { level: 3 });
    expect(titles.map((node) => node.textContent)).toEqual([
      'Nothing can separate',
      'Back porch, Genesis 35',
    ]);

    // Date, place and speaker all reach the page.
    expect(screen.getByText(/First Baptist, Tallahassee, FL/)).toBeInTheDocument();
    expect(screen.getByText(/Speaker: Pastor James Whitfield/)).toBeInTheDocument();
    expect(screen.getByText(/Romans 8:31-39/)).toBeInTheDocument();
  });

  it('keeps notes, reflection and prayer as three separate, labelled parts', async () => {
    await db.putEntries([ROMANS]);
    renderView();

    await screen.findByRole('heading', { level: 3, name: 'Nothing can separate' });
    expect(headingText(4)).toEqual(['Notes', 'Reflection', 'Prayer']);

    const reflection = screen.getByText('I have been living as though the list were still open.');
    // Set apart by shape, so the distinction survives a black-and-white print.
    //
    // Asserted on the block that carries the shape rather than on the text node
    // itself: the body is rendered as Markdown now, so the words sit in a
    // paragraph inside that block. The claim is the same one — an indent rule
    // and italics, neither of which is a colour.
    const shaped = reflection.closest('div');
    expect(shaped?.className).toMatch(/italic/);
    expect(shaped?.className).toMatch(/border-l-4/);
  });

  it('puts the entries marked for descendants in a front section, before the body', async () => {
    await db.putEntries([ROMANS, LETTER, GENESIS]);
    renderView();

    // Wait for the journal itself, not just the page heading, which renders first.
    await screen.findByRole('heading', { level: 3, name: 'Back porch, Genesis 35' });
    expect(headingText(2)).toEqual(['For those who come after', 'The journal']);

    // It appears twice on purpose: gathered at the front, and again in its place.
    expect(screen.getAllByRole('heading', { level: 3, name: 'For Hannah, one day' })).toHaveLength(2);
  });

  it('reorders by book of the Bible without losing an entry', async () => {
    await db.putEntries([ROMANS, GENESIS, LETTER]);
    renderView();

    await screen.findByRole('heading', { level: 3, name: 'Back porch, Genesis 35' });
    fireEvent.click(screen.getByRole('radio', { name: 'Where it falls in the Bible' }));

    expect(headingText(2)).toEqual([
      'For those who come after',
      'Genesis',
      'Romans',
      'Not tied to a book of the Bible',
    ]);
    // Three entries in the body, plus the one repeated at the front.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(4);
  });

  it('hands the page to the browser to print', async () => {
    const print = vi.fn();
    Object.defineProperty(window, 'print', { value: print, writable: true, configurable: true });
    await db.putEntries([ROMANS]);
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'Print or save as PDF' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('says so plainly when there is nothing to print', async () => {
    renderView();
    expect(await screen.findByText('There is nothing to print yet')).toBeInTheDocument();
  });

  it('files an entry by the same anchor it takes its position from', async () => {
    await db.putEntries([ROMANS, WHOLE_ROMANS]);
    renderView();

    await screen.findByRole('heading', { level: 3, name: 'Nothing can separate' });
    fireEvent.click(screen.getByRole('radio', { name: 'Where it falls in the Bible' }));

    // Both are Romans entries. The whole-book one leads its book; reading its
    // position from the Genesis anchor it also carries would push it last.
    expect(headingText(2)).toEqual(['Romans']);
    expect(headingText(3)).toEqual(['The whole letter, at once', 'Nothing can separate']);
  });

  it('prints an entry with no date, an unknown topic and an unknown book', async () => {
    await db.putEntries([STRANGE]);
    const { container } = renderView();

    await screen.findByRole('heading', { level: 3, name: 'Written on a plane' });
    expect(screen.getByText('No date recorded')).toBeInTheDocument();
    // An empty datetime is not a date; nothing should claim otherwise.
    expect(container.querySelector('time[datetime=""]')).toBeNull();

    // Unknown ids fall back to themselves rather than vanishing from the page.
    expect(screen.getByText('On: Topic: not-a-topic; book-of-eli')).toBeInTheDocument();
  });

  it('breaks an unbreakable word so a 360px page does not scroll sideways', async () => {
    await db.putEntries([STRANGE]);
    renderView();

    const notes = await screen.findByText(LONG_URL);
    // whitespace-pre-wrap alone breaks at spaces only, and a pasted URL has none.
    expect(notes.className).toMatch(/break-words/);
  });

  it('reports an unreadable journal rather than saying that it is empty', async () => {
    render(
      <RouterProvider>
        <StorageContextProvider provider={brokenStorage()}>
          <LegacyView />
        </StorageContextProvider>
      </RouterProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be (?:opened|read)/i);
    expect(screen.queryByText('There is nothing to print yet')).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 entries/)).not.toBeInTheDocument();
  });
});
