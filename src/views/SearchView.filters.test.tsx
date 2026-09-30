/**
 * Advanced search, from the reader's side.
 *
 * The engine tests own which entries survive a filter. These own the part a
 * person actually touches: that the control is closed until wanted, that it
 * says so when it is narrowing, that ticking a box does not cost them the
 * words they typed, and that an empty list explains itself rather than
 * implying the journal does not contain what it contains.
 *
 * Driven through the real view with real storage, because the filter now lives
 * in the route: a test that called `searchJournal` directly would pass with the
 * checkboxes wired to nothing at all.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import SearchView from './SearchView';
import { RouterProvider, useRouter } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { ENTRY_KINDS, ENTRY_KIND_LABELS } from '../lib/entry-kinds';
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

/**
 * The filter now lives in the route, so the test has to drive the route rather
 * than the prop — exactly as App.tsx does. Passing `kinds` in directly would
 * let every assertion below pass with the checkboxes wired to nothing.
 */
function Harness({ initial }: { initial: string }) {
  const { route } = useRouter();
  if (route.name !== 'search') return <SearchView query={initial} />;
  return <SearchView query={route.query} kinds={route.kinds} />;
}

async function show(query: string, seed: (db: DexieStorageProvider) => Promise<void>) {
  window.location.hash = `#/search?q=${encodeURIComponent(query)}`;
  const db = new DexieStorageProvider(`search-filters-${(counter += 1)}`);
  await db.open();
  await seed(db);
  render(
    <RouterProvider>
      <StorageContextProvider provider={db}>
        <Harness initial={query} />
      </StorageContextProvider>
    </RouterProvider>,
  );
  return db;
}

/** The search box writes the route on a timer; nothing else here waits on one. */
const settleDebounce = () => act(async () => { await new Promise((done) => setTimeout(done, 260)); });

/** Wait until the journal section reports the count this case expects. */
const ready = (count: number) =>
  waitFor(() => expect(journalHeading()).toHaveTextContent(`Your journal (${count})`));

/**
 * A result, by its link.
 *
 * Not `getByText`: a title matches twice on the page, once as the result's own
 * name and once inside the snippet the provenance line quotes back.
 */
const result = (title: string) =>
  within(journalSection()).getByRole('link', { name: new RegExp(title, 'i') });

const missing = (title: string) =>
  screen.queryByRole('link', { name: new RegExp(title, 'i') }) === null;

const disclosure = () => screen.getByText(/^Advanced search/).closest('details') as HTMLDetailsElement;
const journalHeading = () => screen.getByRole('heading', { name: /Your journal/ });
const journalSection = () => journalHeading().closest('section') as HTMLElement;

/** The mixed corpus every case below narrows. */
const MIXED = [
  entry({ id: 'a-sermon', kind: 'sermon', title: 'Sermon on kestrel' }),
  entry({ id: 'a-prayer', kind: 'prayer', title: 'Prayer about kestrel' }),
  entry({ id: 'a-reflection', kind: 'reflection', title: 'Reflection on kestrel' }),
  entry({ id: 'a-letter', kind: 'letter', title: 'Letter mentioning kestrel' }),
];

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('the control stays out of the way', () => {
  it('is collapsed until the reader opens it', async () => {
    await show('kestrel', async (db) => db.putEntries(MIXED));
    await ready(4);

    expect(disclosure().open).toBe(false);
    // Closed says only what it is. No filter names until there are some.
    expect(screen.getByText(/^Advanced search/).textContent).toBe('Advanced search');
  });

  it('offers every canonical kind, and only those', async () => {
    await show('kestrel', async (db) => db.putEntries(MIXED));
    await ready(4);
    fireEvent.click(screen.getByText(/^Advanced search/));

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(ENTRY_KINDS.length);
    for (const kind of ENTRY_KINDS) {
      // A real label, on a real checkbox — not a chip with aria-pressed.
      expect(screen.getByRole('checkbox', { name: ENTRY_KIND_LABELS[kind] })).toBeInTheDocument();
    }
  });

  it('searches every kind while nothing is ticked', async () => {
    await show('kestrel', async (db) => db.putEntries(MIXED));
    await waitFor(() => expect(journalHeading()).toHaveTextContent('Your journal (4)'));
  });
});

describe('narrowing', () => {
  it('shows only the selected kind, and says so while closed', async () => {
    await show('kestrel', async (db) => db.putEntries(MIXED));
    await ready(4);
    fireEvent.click(screen.getByText(/^Advanced search/));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Prayer' }));

    await waitFor(() => expect(journalHeading()).toHaveTextContent('Your journal (1)'));
    expect(result('Prayer about kestrel')).toBeInTheDocument();
    expect(missing('Sermon on kestrel')).toBe(true);
    // Visible without opening anything: this list is not everything.
    expect(screen.getByText(/^Advanced search/).textContent).toContain('· Prayer');
  });

  it('adds a second kind rather than replacing the first', async () => {
    await show('kestrel', async (db) => db.putEntries(MIXED));
    await ready(4);
    fireEvent.click(screen.getByText(/^Advanced search/));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Prayer' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reflection' }));

    await waitFor(() => expect(journalHeading()).toHaveTextContent('Your journal (2)'));
    expect(screen.getByRole('checkbox', { name: 'Prayer' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Reflection' })).toBeChecked();
    expect(screen.getByText(/^Advanced search/).textContent).toContain('· Prayer, Reflection');
  });

  it('counts rather than lists once the summary would become a queue', async () => {
    await show('kestrel', async (db) => db.putEntries(MIXED));
    await ready(4);
    fireEvent.click(screen.getByText(/^Advanced search/));
    for (const label of ['Sermon', 'Bible reading', 'Prayer', 'Reflection']) {
      fireEvent.click(screen.getByRole('checkbox', { name: label }));
    }
    await waitFor(() =>
      expect(screen.getByText(/^Advanced search/).textContent).toContain('· 4 types'),
    );
  });

  it('unticking the last box searches everything again', async () => {
    await show('kestrel', async (db) => db.putEntries(MIXED));
    await ready(4);
    fireEvent.click(screen.getByText(/^Advanced search/));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Prayer' }));
    await waitFor(() => expect(journalHeading()).toHaveTextContent('Your journal (1)'));

    fireEvent.click(screen.getByRole('checkbox', { name: 'Prayer' }));
    await waitFor(() => expect(journalHeading()).toHaveTextContent('Your journal (4)'));
  });
});

describe('clearing', () => {
  it('clears every filter in one action and keeps the query', async () => {
    await show('kestrel', async (db) => db.putEntries(MIXED));
    await ready(4);
    fireEvent.click(screen.getByText(/^Advanced search/));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Prayer' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reflection' }));
    await waitFor(() => expect(journalHeading()).toHaveTextContent('Your journal (2)'));

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]);

    await waitFor(() => expect(journalHeading()).toHaveTextContent('Your journal (4)'));
    // The query is not a filter. Clearing must never empty the box.
    expect(screen.getByRole('searchbox')).toHaveValue('kestrel');
    expect(screen.getByRole('checkbox', { name: 'Prayer' })).not.toBeChecked();
  });

  it('offers nothing to clear when nothing is filtering', async () => {
    await show('kestrel', async (db) => db.putEntries(MIXED));
    await ready(4);
    fireEvent.click(screen.getByText(/^Advanced search/));
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });
});

describe('typing and filtering do not undo each other', () => {
  it('keeps the selected kinds when the query changes', async () => {
    await show('kestrel', async (db) =>
      db.putEntries([
        ...MIXED,
        entry({ id: 'b-prayer', kind: 'prayer', title: 'Prayer about heron' }),
        entry({ id: 'b-sermon', kind: 'sermon', title: 'Sermon on heron' }),
      ]),
    );
    await ready(4);
    fireEvent.click(screen.getByText(/^Advanced search/));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Prayer' }));
    await waitFor(() => expect(journalHeading()).toHaveTextContent('Your journal (1)'));

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'heron' } });
    await settleDebounce();

    await waitFor(() =>
      expect(result('Prayer about heron')).toBeInTheDocument(),
    );
    expect(missing('Sermon on heron')).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Prayer' })).toBeChecked();
  });
});

describe('an empty list explains itself', () => {
  it('names the filter, and admits the words are found elsewhere', async () => {
    await show('kestrel', async (db) =>
      db.putEntries([
        entry({ id: 'only-sermon', kind: 'sermon', title: 'Sermon on kestrel' }),
        entry({ id: 'also-sermon', kind: 'sermon', title: 'Another kestrel sermon' }),
      ]),
    );
    await ready(2);
    fireEvent.click(screen.getByText(/^Advanced search/));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Prayer' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reflection' }));

    // No topic or book matches "kestrel" either, so the WHOLE page reports
    // nothing found — the branch where the filter used to go unmentioned.
    await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeInTheDocument());
    // Named, so the reader knows what to undo...
    expect(screen.getByText('No matches in Prayer or Reflection.')).toBeInTheDocument();
    // ...and told the truth about the rest of the journal.
    expect(screen.getByText('2 entries of other kinds match.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0);
  });

  it('does not blame the filter when nothing matches at all', async () => {
    await show('kestrel', async (db) =>
      db.putEntries([entry({ id: 'p', kind: 'prayer', title: 'Prayer about kestrel' })]),
    );
    await waitFor(() => expect(journalHeading()).toHaveTextContent('Your journal (1)'));
    fireEvent.click(screen.getByText(/^Advanced search/));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Prayer' }));

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzzznothing' } });
    await settleDebounce();

    await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeInTheDocument());
    // The filter is on, so it is still named — but nothing claims other kinds
    // hold the answer, because they do not.
    expect(screen.getByText('No matches in Prayer.')).toBeInTheDocument();
    expect(screen.queryByText(/entries of other kinds match/)).not.toBeInTheDocument();
  });
});

describe('drafts', () => {
  it('stay out of search however the filters are set', async () => {
    const form: DraftForm = {
      kind: 'prayer', title: '', date: '2026-03-01', place: '', speaker: '', sermonSeries: '',
      notes: 'An unfinished kestrel prayer.', reflection: '', prayer: '', tagsText: '',
      links: [], anchors: [], forDescendants: false, scriptureRefs: [], sourceMaterial: null,
    };
    await show('kestrel', async (db) => {
      await db.putEntries(MIXED);
      await db.putDraft({
        id: 'draft-1', form,
        createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T10:00:00.000Z',
      });
    });
    await ready(4);
    fireEvent.click(screen.getByText(/^Advanced search/));
    // Selecting the draft's own kind is the case that would expose a leak.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Prayer' }));

    await waitFor(() => expect(journalHeading()).toHaveTextContent('Your journal (1)'));
    expect(screen.queryByText(/unfinished kestrel prayer/)).not.toBeInTheDocument();
  });
});
