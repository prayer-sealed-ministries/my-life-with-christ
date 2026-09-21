/**
 * The passage-history page, against real storage.
 *
 * The pure tests own overlap, order and excerpt choice. These own the things
 * that can only go wrong once a database and a route are involved: that the
 * page is derived from the entries and therefore cannot go stale, that
 * unfinished writing never reaches it, and that the URL settles on one
 * spelling of a passage.
 */

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import PassageHistoryView from './PassageHistoryView';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import type { DraftForm, Entry } from '../types';

let counter = 0;

const entry = (overrides: Partial<Entry> & { id: string }): Entry => ({
  kind: 'sermon',
  title: '',
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

const at = (book: string, cs: number, vs: number, ce = cs, ve = vs) =>
  ({ kind: 'scripture', book, chapterStart: cs, verseStart: vs, chapterEnd: ce, verseEnd: ve }) as const;

async function show(reference: string, seed: (db: DexieStorageProvider) => Promise<void>) {
  window.location.hash = `#/history/${encodeURIComponent(reference)}`;
  const db = new DexieStorageProvider(`passage-history-${(counter += 1)}`);
  await db.open();
  await seed(db);
  const view = render(
    <RouterProvider>
      <StorageContextProvider provider={db}>
        <PassageHistoryView reference={reference} />
      </StorageContextProvider>
    </RouterProvider>,
  );
  return { db, view };
}

/** Re-render after storage changed, the way a route revisit would. */
async function again(db: DexieStorageProvider, reference: string) {
  cleanup();
  render(
    <RouterProvider>
      <StorageContextProvider provider={db}>
        <PassageHistoryView reference={reference} />
      </StorageContextProvider>
    </RouterProvider>,
  );
  // The heading renders before storage answers, so waiting for it alone would
  // read the page mid-load and see an empty list either way.
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
  await waitFor(() => expect(screen.queryByText(/Loading your history/)).not.toBeInTheDocument());
  await waitFor(() =>
    expect(
      screen.queryAllByRole('listitem').length > 0 ||
        screen.queryByText(/You haven’t written about/) !== null,
    ).toBe(true),
  );
}

const moments = () => screen.queryAllByRole('listitem');
const titles = () => moments().map((item) => within(item).getByRole('link').textContent);

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('page identity', () => {
  it('is personal, and names the passage', async () => {
    await show('John 15', async (db) => db.putEntries([entry({ id: 'a', title: 'Abiding', anchors: [at('john', 15, 5)] })]));
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('My history with John 15');
    // Not a study aid, not commentary. The wording is the product decision.
    for (const banned of [/commentary/i, /study/i, /insight/i, /analysis/i]) {
      expect(document.body.textContent ?? '').not.toMatch(banned);
    }
  });

  it('settles the URL on one spelling of the passage', async () => {
    await show('Jn 15', async (db) => db.putEntries([entry({ id: 'a', anchors: [at('john', 15, 5)] })]));
    // "Jn 15" and "John 15" are one passage and must be one address, so a link
    // someone keeps says what it means.
    await waitFor(() => expect(window.location.hash).toBe('#/history/John%2015'));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('My history with John 15');
  });

  it('keeps a verse reference as a verse', async () => {
    await show('John 15:5', async (db) => db.putEntries([entry({ id: 'a', anchors: [at('john', 15, 5)] })]));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('My history with John 15:5');
  });

  it('refuses a reference it cannot resolve, without reaching storage', async () => {
    await show('Nowhere 3', async (db) => db.putEntries([entry({ id: 'a', anchors: [at('john', 15, 5)] })]));
    expect(await screen.findByText(/is not a passage this app recognises/)).toBeInTheDocument();
    expect(moments()).toHaveLength(0);
  });
});

describe('the states a history can be in', () => {
  it('is calm when there is nothing yet, and offers a way in', async () => {
    await show('John 15', async () => {});
    expect(await screen.findByText(/You haven’t written about John 15 yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start a Bible reading' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write a reflection' })).toBeInTheDocument();
    // No verdict on how they have spent their time.
    for (const banned of [/should/i, /haven’t studied/i, /progress/i, /streak/i]) {
      expect(document.body.textContent ?? '').not.toMatch(banned);
    }
  });

  it('does not build scaffolding around a single moment', async () => {
    await show('John 15', async (db) =>
      db.putEntries([entry({ id: 'one', title: 'The vine', date: '2026-04-01', anchors: [at('john', 15, 5)] })]),
    );
    await screen.findByText('The vine');
    expect(screen.getByText('1 saved moment')).toBeInTheDocument();

    // One entry in one year needs no year heading over it.
    const headings = screen.getAllByRole('heading').map((h) => h.textContent ?? '');
    expect(headings.filter((text) => /^\d{4}$/.test(text))).toEqual([]);

    // And with no year heading, the card must step up to h2 rather than
    // leaving a gap below the h1 — which is what a reader navigating by
    // heading would hit.
    expect(screen.getByRole('heading', { level: 2, name: 'The vine' })).toBeInTheDocument();
  });

  it('nests the cards under their year when there are several', async () => {
    await show('John 15', async (db) =>
      db.putEntries([
        entry({ id: 'a', title: 'Older', date: '2026-05-05', anchors: [at('john', 15, 5)] }),
        entry({ id: 'b', title: 'Newer', date: '2028-05-05', anchors: [at('john', 15, 5)] }),
      ]),
    );
    await screen.findByText('Older');
    // h1 -> h2 (year) -> h3 (moment). No level skipped in either layout.
    expect(screen.getByRole('heading', { level: 2, name: '2026' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Older' })).toBeInTheDocument();
  });

  it('groups by year once the history spans more than one', async () => {
    await show('John 15', async (db) =>
      db.putEntries([
        entry({ id: 'c', title: 'Third', date: '2028-02-02', kind: 'prayer', anchors: [at('john', 15, 1, 15, 8)] }),
        entry({ id: 'a', title: 'First', date: '2026-05-05', kind: 'reading', anchors: [at('john', 15, 1, 15, 27)] }),
        entry({ id: 'b', title: 'Second', date: '2027-09-09', anchors: [at('john', 15, 5)] }),
      ]),
    );
    await screen.findByText('First');

    expect(screen.getByText('3 saved moments')).toBeInTheDocument();
    // Oldest first — this is a story, not a search.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(
      ['2026', '2027', '2028'],
    );
    expect(titles()).toEqual(['First', 'Second', 'Third']);
    // And 2029 was never written in, so it is not a heading over nothing.
    expect(screen.queryByText('2029')).not.toBeInTheDocument();
  });
});

describe('what a moment shows', () => {
  it('shows the day, the kind, the anchor and the reader’s own words', async () => {
    await show('John 15', async (db) =>
      db.putEntries([
        entry({
          id: 'a',
          kind: 'sermon',
          title: 'Abiding in Christ',
          date: '2027-10-08',
          speaker: 'Rev. Dana Okonkwo',
          anchors: [at('john', 15, 5)],
          notes: 'He preached on the vine.',
          reflection: 'I have been striving where I was asked to abide.',
        }),
      ]),
    );
    const card = (await screen.findByText('Abiding in Christ')).closest('article') as HTMLElement;

    expect(within(card).getByText('Sermon')).toBeInTheDocument();
    expect(within(card).getByText('John 15:5')).toBeInTheDocument();
    expect(within(card).getByText('Rev. Dana Okonkwo')).toBeInTheDocument();
    // Their reflection, not the notes: this page asks what it meant to them.
    expect(within(card).getByText(/I have been striving/)).toBeInTheDocument();
    expect(within(card).queryByText(/He preached on the vine/)).not.toBeInTheDocument();
  });

  it('labels a handout as a handout', async () => {
    await show('John 15', async (db) =>
      db.putEntries([
        entry({
          id: 'a',
          title: 'Sunday with a handout',
          anchors: [at('john', 15, 5)],
          sourceMaterial: {
            body: 'Point three: abiding is not striving.',
            importedAt: '2026-03-01T00:00:00.000Z',
            filename: 'h.md',
            format: 'markdown',
            parserVersion: 1,
          },
        }),
      ]),
    );
    const card = (await screen.findByText('Sunday with a handout')).closest('article') as HTMLElement;
    expect(within(card).getByText('Provided notes')).toBeInTheDocument();
    expect(within(card).getByText(/abiding is not striving/)).toBeInTheDocument();
  });

  it('opens the saved entry', async () => {
    await show('John 15', async (db) =>
      db.putEntries([entry({ id: 'target', title: 'The vine', anchors: [at('john', 15, 5)] })]),
    );
    const link = await screen.findByRole('link', { name: 'The vine' });
    expect(link).toHaveAttribute('href', '#/entry/target');
  });
});

describe('unfinished writing stays unfinished', () => {
  it('keeps a draft anchored to the passage off the page', async () => {
    const form: DraftForm = {
      kind: 'prayer', title: 'Half-written prayer', date: '2026-06-01', place: '', speaker: '',
      sermonSeries: '', notes: 'An unfinished thought about the vine.', reflection: '', prayer: '',
      tagsText: '', links: [], anchors: [at('john', 15, 5)], forDescendants: false,
      scriptureRefs: [], sourceMaterial: null,
    };
    await show('John 15', async (db) => {
      await db.putEntries([entry({ id: 'saved', title: 'A saved one', anchors: [at('john', 15, 5)] })]);
      await db.putDraft({
        id: 'd1', form,
        createdAt: '2026-06-01T10:00:00.000Z', updatedAt: '2026-06-01T10:00:00.000Z',
      });
    });
    await screen.findByText('A saved one');

    expect(screen.getByText('1 saved moment')).toBeInTheDocument();
    expect(screen.queryByText('Half-written prayer')).not.toBeInTheDocument();
    expect(screen.queryByText(/unfinished thought/)).not.toBeInTheDocument();
  });
});

/**
 * The page is a view over the entries, so there is nothing to invalidate.
 * These prove it by changing the journal and looking again.
 */
describe('nothing here can go stale', () => {
  it('an entry appears when it gains the anchor, and goes when it loses it', async () => {
    const { db } = await show('John 15', async (database) =>
      database.putEntries([entry({ id: 'x', title: 'Moved around', anchors: [] })]),
    );
    await screen.findByText(/You haven’t written about John 15 yet/);

    await act(async () => { await db.updateEntry('x', { anchors: [at('john', 15, 5)] }); });
    await again(db, 'John 15');
    expect(screen.getByText('Moved around')).toBeInTheDocument();

    await act(async () => { await db.updateEntry('x', { anchors: [] }); });
    await again(db, 'John 15');
    expect(screen.queryByText('Moved around')).not.toBeInTheDocument();
  });

  it('editing the range changes which passages it belongs to', async () => {
    const { db } = await show('John 15:20', async (database) =>
      database.putEntries([entry({ id: 'x', title: 'Narrow then wide', anchors: [at('john', 15, 1, 15, 8)] })]),
    );
    await screen.findByText(/You haven’t written about John 15:20 yet/);

    await act(async () => { await db.updateEntry('x', { anchors: [at('john', 15, 1, 15, 27)] }); });
    await again(db, 'John 15:20');
    expect(screen.getByText('Narrow then wide')).toBeInTheDocument();
  });

  it('a deleted entry leaves no trace', async () => {
    const { db } = await show('John 15', async (database) =>
      database.putEntries([entry({ id: 'x', title: 'Here for now', anchors: [at('john', 15, 5)] })]),
    );
    await screen.findByText('Here for now');

    await act(async () => { await db.deleteEntry('x'); });
    await again(db, 'John 15');
    expect(screen.queryByText('Here for now')).not.toBeInTheDocument();
    expect(screen.getByText(/You haven’t written about John 15 yet/)).toBeInTheDocument();
  });

  it('a restored archive is reflected immediately', async () => {
    const { db } = await show('John 15', async () => {});
    await screen.findByText(/You haven’t written about John 15 yet/);

    // replaceEntries is what a replace-mode restore uses.
    await act(async () => {
      await db.replaceEntries([
        entry({ id: 'r1', title: 'Restored early', date: '2026-01-01', anchors: [at('john', 15, 2)] }),
        entry({ id: 'r2', title: 'Restored later', date: '2027-01-01', anchors: [at('john', 15, 3)] }),
      ]);
    });
    await again(db, 'John 15');
    expect(titles()).toEqual(['Restored early', 'Restored later']);
  });

  it('a merge import is reflected immediately', async () => {
    const { db } = await show('John 15', async (database) =>
      database.putEntries([entry({ id: 'own', title: 'Already mine', date: '2026-01-01', anchors: [at('john', 15, 2)] })]),
    );
    await screen.findByText('Already mine');

    await act(async () => {
      await db.putEntries([
        entry({ id: 'merged', title: 'Merged in', date: '2027-01-01', anchors: [at('john', 15, 4)] }),
      ]);
    });
    await again(db, 'John 15');
    expect(titles()).toEqual(['Already mine', 'Merged in']);
  });
});

describe('moving between chapter and verse', () => {
  it('offers the chapter from a verse, and not from the chapter itself', async () => {
    await show('John 15:5', async (db) => db.putEntries([entry({ id: 'a', anchors: [at('john', 15, 5)] })]));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByRole('link', { name: 'My history with John 15' })).toHaveAttribute(
      'href',
      '#/history/John%2015',
    );

    cleanup();
    await show('John 15', async (db) => db.putEntries([entry({ id: 'a', anchors: [at('john', 15, 5)] })]));
    await screen.findByRole('heading', { level: 1 });
    // On the chapter page that link would point at the page you are on.
    expect(screen.queryByRole('link', { name: 'My history with John 15' })).not.toBeInTheDocument();
  });
});
