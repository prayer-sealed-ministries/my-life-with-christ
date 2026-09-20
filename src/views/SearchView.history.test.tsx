/**
 * Search against real storage, over a whole life's worth of entries.
 *
 * The unit tests cover ranking; these cover the things that can only go wrong
 * once a database is involved — that the search reaches entries nobody has
 * scrolled to, that an edit really removes the old words, and that unfinished
 * writing stays out of finished history.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import SearchView from './SearchView';
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

const draftForm = (notes: string): DraftForm => ({
  kind: 'sermon', title: '', date: '2026-03-01', place: '', speaker: '', sermonSeries: '',
  notes, reflection: '', prayer: '', tagsText: '', links: [], anchors: [],
  forDescendants: false, scriptureRefs: [], sourceMaterial: null,
});

async function show(query: string, seed: (db: DexieStorageProvider) => Promise<void>) {
  const db = new DexieStorageProvider(`search-history-${(counter += 1)}`);
  await db.open();
  await seed(db);
  render(
    <RouterProvider>
      <StorageContextProvider provider={db}>
        <SearchView query={query} />
      </StorageContextProvider>
    </RouterProvider>,
  );
  return db;
}

afterEach(cleanup);

describe('searching all of history', () => {
  /**
   * The point of the lane: a journal is for decades, and the entry you are
   * looking for is usually not a recent one.
   */
  it('finds an entry buried far beyond any recent-entries page', async () => {
    await show('lighthouse', async (db) => {
      const many = Array.from({ length: 400 }, (_, i) =>
        entry({ id: `filler-${i}`, date: '2030-01-01', notes: 'ordinary sunday notes' }),
      );
      // Oldest, and last in every list the app draws.
      many.push(entry({ id: 'ancient', date: '2004-06-01', notes: 'The lighthouse sermon.' }));
      await db.putEntries(many);
    });

    expect(await screen.findByRole('link', { name: /lighthouse|Untitled/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/The lighthouse sermon/)).toBeInTheDocument());
  });
});

describe('Scripture shorthand', () => {
  it('finds an anchored entry the prose never names', async () => {
    await show('Jn 15', async (db) => {
      await db.putEntries([
        entry({
          id: 'vine',
          title: 'The vine and the branches',
          notes: 'Abiding is not striving.',
          anchors: [
            { kind: 'scripture', book: 'john', chapterStart: 15, verseStart: 1, chapterEnd: 15, verseEnd: 17 },
          ],
        }),
      ]);
    });

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /The vine and the branches/ })).toBeInTheDocument(),
    );
  });
});

describe('what an edit does to search', () => {
  it('stops finding the old words and starts finding the new ones', async () => {
    const db = await show('cormorant', async (provider) => {
      await provider.putEntries([entry({ id: 'e1', notes: 'A cormorant on the post.' })]);
    });
    await waitFor(() => expect(screen.getByText(/cormorant/)).toBeInTheDocument());
    cleanup();

    await db.updateEntry('e1', { notes: 'A kingfisher on the post.' });

    // Old word: gone. There is no index to have gone stale, because the
    // entries are the index.
    render(
      <RouterProvider>
        <StorageContextProvider provider={db}>
          <SearchView query="cormorant" />
        </StorageContextProvider>
      </RouterProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeInTheDocument());
    cleanup();

    render(
      <RouterProvider>
        <StorageContextProvider provider={db}>
          <SearchView query="kingfisher" />
        </StorageContextProvider>
      </RouterProvider>,
    );
    await waitFor(() => expect(screen.getByText(/kingfisher/)).toBeInTheDocument());
  });

  it('forgets an entry that was deleted', async () => {
    const db = await show('marigold', async (provider) => {
      await provider.putEntries([entry({ id: 'e1', notes: 'The marigold on the sill.' })]);
    });
    await waitFor(() => expect(screen.getByText(/marigold/)).toBeInTheDocument());
    cleanup();

    await db.deleteEntry('e1');

    render(
      <RouterProvider>
        <StorageContextProvider provider={db}>
          <SearchView query="marigold" />
        </StorageContextProvider>
      </RouterProvider>,
    );
    await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeInTheDocument());
  });
});

describe('unfinished writing', () => {
  /**
   * Drafts are recoverable work, not journal history. Keeping them out is
   * structural — search reads entries, and a draft is not one — but it is
   * worth a test, because the day that stops being true is the day a
   * half-sentence turns up in someone's history.
   */
  it('never appears in historical search results', async () => {
    await show('pelican', async (db) => {
      await db.putDraft({
        id: 'd1',
        form: draftForm('A pelican, in a draft nobody saved.'),
        createdAt: '2026-03-01T09:00:00.000Z',
        updatedAt: '2026-03-01T09:00:00.000Z',
      });
    });

    await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeInTheDocument());
    // The word appears once, in the "Nothing matches" echo of the query — and
    // nowhere as a result. The draft's own sentence must be absent entirely.
    expect(screen.queryByText(/in a draft nobody saved/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Untitled entry/ })).toBeNull();
  });
});

describe('provenance in the result list', () => {
  it('labels a match in a church handout as provided notes', async () => {
    await show('uncertainty', async (db) => {
      await db.putEntries([
        entry({
          id: 'e1',
          notes: 'My own words, about something else.',
          sourceMaterial: {
            body: 'Peace in the middle of uncertainty.',
            importedAt: '2026-03-01T00:00:00.000Z',
            filename: 'handout.md',
            format: 'markdown',
            parserVersion: 1,
          },
        }),
      ]);
    });

    await waitFor(() => expect(screen.getByText('Provided notes')).toBeInTheDocument());
    expect(
      screen.getByText(/Matched in provided notes, not in your own writing/),
    ).toBeInTheDocument();
  });

  it('labels the reader’s own writing by the field they wrote it in', async () => {
    await show('kingfisher', async (db) => {
      await db.putEntries([entry({ id: 'e1', reflection: 'The kingfisher again today.' })]);
    });

    // "Reflection" also names a kind filter button, so look inside the result.
    const result = await screen.findByRole('link', { name: /Untitled entry/ });
    await waitFor(() => expect(result.textContent).toContain('Reflection'));
    expect(result.textContent).toContain('The kingfisher again today.');
  });
});
