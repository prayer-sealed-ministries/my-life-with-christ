import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Entry, OutlineBook } from '../types';

/**
 * The division data is substituted here on purpose, and only the DATA.
 *
 * `hasOutlineTitles` is a build constant, so the real module can only ever show
 * one data profile per run. Overriding it is the only way to prove, in the
 * default run, that the outline section is present under `public` and gone
 * entirely under `refs-only` — the branch most likely to rot unnoticed. It also
 * keeps these assertions off whichever headings happen to be ingested today.
 *
 * The divisions themselves go in through `__setSectionsLoader`, which is the
 * seam the product's own loader is built around, so this file exercises the
 * real `useSectionsOptional`, the real segmentation and the real caching. An
 * earlier version handed the view a hand-written `segmentsForBook` instead;
 * that made the test host and the product two different implementations, which
 * is the trap the PDF lane fell into.
 *
 * `luke-15-20-6` prints a reference that runs backwards, so it claims no verses
 * and real segmentation gives it no segment — the shape of the live
 * `matthew-9-18-6`. That behaviour is now produced rather than asserted by
 * hand, which is the point.
 */
const profile = vi.hoisted(() => ({ hasOutlineTitles: true }));

vi.mock('../app/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../app/data')>();
  return {
    ...actual,
    // Both, and together: `hasOutlines` is what decides whether a book is
    // divided at all, and a build cannot have titles without divisions.
    get hasOutlines() {
      return profile.hasOutlineTitles;
    },
    get hasOutlineTitles() {
      return profile.hasOutlineTitles;
    },
  };
});

const outlineFixture = (() => {
  /*
   * The verse span is carried, not implied.
   *
   * It used to be left off, because a hand-written `segmentsForBook` decided
   * which entries had segments and the data never had to be right. Real
   * segmentation asks the entry, so an entry with no verses is a whole chapter
   * — and the "impossible reference" below quietly became a perfectly good
   * one. The fixture has to be true now, which is the improvement.
   */
  const outlineEntry = (
    id: string,
    ref: string,
    title: string,
    displayTitle: string,
    verseStart: number,
    verseEnd: number,
  ) => ({
    id,
    ref,
    sourceRef: ref,
    book: 'luke',
    chapterStart: 15,
    chapterEnd: 15,
    verseStart,
    verseEnd,
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
        outlineEntry('luke-15-11-32', 'Luke 15:11-32', 'THE PRODIGALL SON', 'The Prodigal Son', 11, 32),
        outlineEntry('luke-15-1-7', 'Luke 15:1-7', 'The Lost Sheep', 'The Lost Sheep', 1, 7),
        // 20 to 6 runs backwards, so it resolves to no span and real
        // segmentation gives it no segment — the shape of the live
        // `matthew-9-18-6`.
        outlineEntry('luke-15-20-6', 'Luke 15:20-6', 'A Prodigal Aside', 'A Prodigal Aside', 20, 6),
      ],
    },
  ];

  return books;
})();

import { RouterProvider, useRouter } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import SearchView from './SearchView';
import { __setSectionsLoader } from '../app/sections';

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
  // The fixture goes in through the product's own loader. Resolved already, so
  // these tests see the divisions on the tick after the query is typed rather
  // than waiting on anything — and they go in fresh each time, because the
  // loader caches both the promise and the segments built from it.
  __setSectionsLoader(async () => ({ outlines: outlineFixture }));
});

// Vitest does not run with `globals: true`, so Testing Library's automatic
// cleanup never registers. Without this, every render stacks up in one document.
afterEach(() => {
  cleanup();
  __setSectionsLoader();
});

describe('SearchView', () => {
  it('invites a search before anything is typed', async () => {
    const provider = freshProvider();
    await provider.open();

    renderSearch(provider);

    expect(await screen.findByText('What are you looking for?')).toBeInTheDocument();
    const input = screen.getByLabelText(/^Search your journal, topics and the Bible/);
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
      // The announcement now leads with a total across every source, because
      // topics and books are searched too.
      expect(live).toHaveTextContent(/results?: 1 in your journal/);
      expect(live).toHaveTextContent(/1 outline passage\./);
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
    //
    // This used to also expect a "Searching" state, because each query was its
    // own read from storage. The journal is now read once and ranked in
    // memory, so switching queries resolves synchronously — there is no window
    // in which the previous query's results could be shown under the new one,
    // which is a stronger guarantee than the one this test was written to get.
    expect(screen.queryByRole('link', { name: /The prodigal son/ })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Your journal (1)' }),
      'the previous query’s result count survived the switch',
    ).not.toBeInTheDocument();

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

  it('names the outline as absent rather than silently omitting it', async () => {
    // Under refs-only there are no outline titles to search. Saying nothing
    // would leave a reader unable to tell whether their passage is missing or
    // was simply never searched, so the empty state lists it as unavailable.
    profile.hasOutlineTitles = false;
    const provider = freshProvider();
    await provider.open();
    window.location.hash = '#/search?q=zzzznothing';

    renderSearch(provider);

    await screen.findByText(/Nothing matches/);
    expect(screen.getByText(/Outline passage titles/)).toHaveTextContent(
      /not included in this version of the site/,
    );
    // And no outline results section is rendered at all.
    expect(screen.queryByRole('heading', { name: /Bible outline/ })).not.toBeInTheDocument();
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
