import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entry, OutlineBook, PassageSegment } from '../types';

/**
 * The outline data is mocked here on purpose.
 *
 * `hasOutlineTitles` is a build constant, so the real module can only ever show
 * one data profile per run. Mocking it is the only way to prove, in the default
 * run, that the outline section is present under `full` and gone entirely under
 * `refs-only` — the branch most likely to rot unnoticed. It also keeps these
 * assertions off the purchased dataset, whose titles may be re-ingested.
 *
 * `segmentsForBook` is mocked to the same shape the real one produces: an entry
 * whose printed reference is impossible claims no verses, so buildSegments gives
 * it no segment. The live data has exactly one such entry today, and the view
 * has to stay right when it is adjudicated or when another appears.
 */
const profile = vi.hoisted(() => ({ hasOutlineTitles: true }));

vi.mock('../app/data', () => {
  const outlineEntry = (id: string, ref: string, title: string, displayTitle: string) => ({
    id,
    ref,
    sourceRef: ref,
    book: 'luke',
    chapterStart: 15,
    chapterEnd: 15,
    title,
    displayTitle,
    classicStory: true,
    series: null,
  });

  const books: OutlineBook[] = [
    {
      id: 'luke',
      name: 'Luke',
      testament: 'NT',
      order: 42,
      intro: '',
      entries: [
        outlineEntry('luke-15-11-32', 'Luke 15:11-32', 'THE PRODIGALL SON', 'The Prodigal Son'),
        outlineEntry('luke-15-1-7', 'Luke 15:1-7', 'The Lost Sheep', 'The Lost Sheep'),
        // Reference runs backwards, so it resolves to no span and gets no
        // segment — the shape of the real `matthew-9-18-6`.
        outlineEntry('luke-15-20-6', 'Luke 15:20-6', 'A Prodigal Aside', 'A Prodigal Aside'),
      ],
    },
  ];

  const segments: PassageSegment[] = books[0].entries
    .filter((entry) => entry.id !== 'luke-15-20-6')
    .map((entry): PassageSegment => ({
      kind: 'outline',
      id: entry.id,
      ref: entry.ref,
      entry,
      chapterStart: 15,
      verseStart: 1,
      chapterEnd: 15,
      verseEnd: 32,
    }));

  return {
    get hasOutlineTitles() {
      return profile.hasOutlineTitles;
    },
    outlineBooks: books,
    segmentsForBook: (bookId: string) => (bookId === 'luke' ? segments : []),
  };
});

import { RouterProvider, useRouter } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import SearchView from './SearchView';

let dbCounter = 0;

function freshProvider(): DexieStorageProvider {
  dbCounter += 1;
  return new DexieStorageProvider(`journey-search-test-${dbCounter}`);
}

function entry(overrides: Partial<Entry> & { id: string }): Entry {
  return {
    kind: 'sermon',
    title: 'Untitled',
    date: '2026-01-01',
    anchors: [],
    scriptureRefs: [],
    notes: '',
    reflection: '',
    links: [],
    tags: [],
    forDescendants: false,
    visibility: 'private',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Every query the route has held, so debouncing is observable. */
const routeQueries: string[] = [];

/** Wires the view to the real router the way the app does. */
function SearchHarness() {
  const { route } = useRouter();
  const query = route.name === 'search' ? route.query : '';

  useEffect(() => {
    routeQueries.push(query);
  }, [query]);

  return <SearchView query={query} />;
}

function renderSearch(provider: DexieStorageProvider) {
  return render(
    <RouterProvider>
      <StorageContextProvider provider={provider}>
        <SearchHarness />
      </StorageContextProvider>
    </RouterProvider>,
  );
}

/** The day as the app prints it, so assertions are not locale-bound. */
const dayName = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))),
  );

beforeEach(() => {
  profile.hasOutlineTitles = true;
  routeQueries.length = 0;
  window.location.hash = '#/search';
});

// Vitest does not run with `globals: true`, so Testing Library's automatic
// cleanup never registers. Without this, every render stacks up in one document.
afterEach(cleanup);

describe('SearchView', () => {
  it('invites a search before anything is typed', async () => {
    const provider = freshProvider();
    await provider.open();

    renderSearch(provider);

    expect(await screen.findByText('What are you looking for?')).toBeInTheDocument();
    const input = screen.getByLabelText(/Search your journal/);
    expect(input).toHaveAttribute('type', 'search');
    expect(input).toHaveValue('');
  });

  it('searches journal entries and outline titles as two counted sections', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([
      entry({ id: 'a', title: 'The prodigal son', date: '2026-02-01' }),
      entry({ id: 'b', title: 'Unrelated', date: '2026-02-02', notes: 'Nothing to see.' }),
    ]);
    window.location.hash = '#/search?q=prodigal';

    renderSearch(provider);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Your journal (1)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Bible outline (2)' })).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /The prodigal son/ })).toHaveAttribute(
      'href',
      '#/entry/a',
    );
    // The readable wording is shown; the verbatim source spelling is searched.
    expect(screen.getByRole('link', { name: /The Prodigal Son/ })).toHaveAttribute(
      'href',
      '#/passage/luke/luke-15-11-32',
    );
    expect(screen.queryByRole('link', { name: /Unrelated/ })).not.toBeInTheDocument();
  });

  it('sends an outline entry with an unresolved reference to the book, and says so', async () => {
    const provider = freshProvider();
    await provider.open();
    window.location.hash = '#/search?q=prodigal';

    renderSearch(provider);

    const link = await screen.findByRole('link', { name: /A Prodigal Aside/ });
    // Not #/passage/luke/luke-15-20-6, which is a page that does not exist.
    expect(link).toHaveAttribute('href', '#/book/luke');
    expect(link).toHaveTextContent('This reference has not been resolved — opens all of Luke.');
  });

  it('matches an outline entry by its verbatim source title too', async () => {
    const provider = freshProvider();
    await provider.open();
    window.location.hash = '#/search?q=prodigall';

    renderSearch(provider);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Bible outline (1)' }),
    ).toBeInTheDocument();
  });

  it('announces the counts politely', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'The lost sheep', date: '2026-02-01' })]);
    window.location.hash = '#/search?q=lost+sheep';

    renderSearch(provider);

    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      expect(live).toHaveTextContent('1 entry, 1 outline passage.');
    });
  });

  it('writes the entry date out rather than showing a raw ISO string', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([
      entry({ id: 'a', title: 'The prodigal son', date: '2026-02-01', speaker: 'Pastor Ada' }),
    ]);
    window.location.hash = '#/search?q=prodigal';

    renderSearch(provider);

    const link = await screen.findByRole('link', { name: /The prodigal son/ });
    expect(link).toHaveTextContent(dayName('2026-02-01'));
    expect(link).not.toHaveTextContent('2026-02-01');
    expect(link).toHaveTextContent('Pastor Ada');
  });

  it('updates the route as you type, debounced and without flooding history', async () => {
    const provider = freshProvider();
    await provider.open();

    renderSearch(provider);

    const input = await screen.findByLabelText(/Search your journal/);
    fireEvent.change(input, { target: { value: 'p' } });
    fireEvent.change(input, { target: { value: 'pr' } });
    fireEvent.change(input, { target: { value: 'prodigal' } });

    await waitFor(() => expect(window.location.hash).toContain('q=prodigal'));

    // One route change for the whole burst, not one per keystroke.
    expect(routeQueries).toEqual(['', 'prodigal']);
  });

  /**
   * The query changes a render before the read for it is scheduled. Without the
   * results carrying the needle they were read for, that render shows the
   * previous search's entries under the new term — and announces its count.
   */
  it('never shows one query’s results under another query', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'The prodigal son', date: '2026-02-01' })]);

    const { rerender } = render(
      <RouterProvider>
        <StorageContextProvider provider={provider}>
          <SearchView query="prodigal" />
        </StorageContextProvider>
      </RouterProvider>,
    );
    await screen.findByRole('heading', { level: 2, name: 'Your journal (1)' });

    rerender(
      <RouterProvider>
        <StorageContextProvider provider={provider}>
          <SearchView query="zzzznothing" />
        </StorageContextProvider>
      </RouterProvider>,
    );

    // Straight after the switch, with nothing awaited: the old result must
    // already be gone rather than lingering for a paint.
    expect(screen.queryByRole('link', { name: /The prodigal son/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Your journal/ })).not.toBeInTheDocument();
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('');
    expect(screen.getByRole('status')).toHaveTextContent('Searching');

    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
  });

  it('settles instead of spinning forever when the journal cannot be read', async () => {
    const provider = freshProvider();
    await provider.open();
    vi.spyOn(provider, 'listEntries').mockRejectedValue(new Error('storage unavailable'));
    window.location.hash = '#/search?q=zzzznothing';

    renderSearch(provider);

    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('drops the outline section entirely under the refs-only profile', async () => {
    profile.hasOutlineTitles = false;
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'The prodigal son', date: '2026-02-01' })]);
    window.location.hash = '#/search?q=prodigal';

    renderSearch(provider);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Your journal (1)' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Bible outline/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /The Prodigal Son/ })).not.toBeInTheDocument();
  });

  it('does not offer to search an outline this build does not carry', async () => {
    profile.hasOutlineTitles = false;
    const provider = freshProvider();
    await provider.open();

    renderSearch(provider);

    const input = await screen.findByLabelText('Search your journal');
    expect(input).toBeInTheDocument();
    expect(screen.queryByLabelText(/Bible outline/)).not.toBeInTheDocument();
  });

  it('shows one empty state when nothing at all matches', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'The prodigal son', date: '2026-02-01' })]);
    window.location.hash = '#/search?q=zzzznothing';

    renderSearch(provider);

    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Your journal/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Bible outline/ })).not.toBeInTheDocument();
  });

  it('trims a pasted query when echoing it back, so the layout cannot be blown out', async () => {
    const provider = freshProvider();
    await provider.open();
    const long = 'z'.repeat(300);
    window.location.hash = `#/search?q=${long}`;

    renderSearch(provider);

    const empty = await screen.findByText(/Nothing matches/);
    expect(empty.textContent?.length).toBeLessThan(100);
    expect(empty).toHaveTextContent('…');
  });

  it('keeps exactly one h1 and never skips a heading level', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'The prodigal son', date: '2026-02-01' })]);
    window.location.hash = '#/search?q=prodigal';

    renderSearch(provider);

    await screen.findByRole('heading', { level: 2, name: 'Your journal (1)' });

    const levels = screen.getAllByRole('heading').map((heading) => Number(heading.tagName.slice(1)));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Search');
  });
});
