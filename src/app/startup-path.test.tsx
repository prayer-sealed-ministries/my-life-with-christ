/**
 * Which surfaces need the Scripture divisions, asserted rather than assumed.
 *
 * The lane's claim is not only "Fast Capture is fast". It is that the
 * divisions are needed by the surfaces that are about Scripture and by no
 * others — and a claim like that rots quietly. One `import` added to a shared
 * module, and Home is waiting on three quarters of a megabyte again with every
 * test still green, because nothing was ever asserting the absence.
 *
 * So the loader is HELD here: a promise that never settles. A surface that
 * needs the divisions hangs, visibly and on every machine. A surface that does
 * not, does its whole job. There is no timing in any of it.
 *
 * Where a surface legitimately does need them, that is recorded here too — as
 * a positive assertion that it ASKS. A separation that worked by quietly
 * dropping a feature would pass every absence test in this file.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { __setSectionsLoader, sectionsIfLoaded } from './sections';
import { RouterProvider } from './router';
import { StorageContextProvider } from './storage';
import { DexieStorageProvider } from '../storage/db';
import type { Entry } from '../types';
import HomeView from '../views/HomeView';
import PassageHistoryView from '../views/PassageHistoryView';
import SearchView from '../views/SearchView';
import EntryEditor from '../views/EntryEditor';

let counter = 0;

/** A loader that never settles, and a count of how often it was asked. */
function heldLoader() {
  const state = { asked: 0 };
  __setSectionsLoader(() => {
    state.asked += 1;
    return new Promise(() => {});
  });
  return state;
}

function freshDb(): DexieStorageProvider {
  return new DexieStorageProvider(`journey-startup-${(counter += 1)}`);
}

function show(ui: ReactNode, db: DexieStorageProvider, hash: string) {
  window.location.hash = hash;
  return render(
    <RouterProvider>
      <StorageContextProvider provider={db}>{ui}</StorageContextProvider>
    </RouterProvider>,
  );
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

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  __setSectionsLoader();
});

describe('Home does not wait for Scripture data', () => {
  /**
   * Section 8 of the brief, and the regression it names by hand: a startup
   * that used to be "shell, Home" must not become "shell, loading Scripture
   * data…, Home" merely because a module went asynchronous.
   */
  it('renders in full while the loader never resolves', async () => {
    const held = heldLoader();
    const db = freshDb();
    await db.open();

    show(<HomeView />, db, '#/');

    // The whole page, not just a heading: what a reader opens the app to see.
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByLabelText('Loading')).toBeNull();
      expect(screen.getAllByRole('link').length).toBeGreaterThan(2);
    });

    expect(held.asked).toBe(0);
    expect(sectionsIfLoaded()).toBeNull();
  });
});

describe('Passage History does not wait for Scripture data', () => {
  /**
   * Section 10. The history is built from entry anchors and reference
   * parsing — neither of which is a section heading — so opening
   * "My history with John 15" shows the reader's own writing immediately.
   */
  it('shows the reader their entries while the loader never resolves', async () => {
    const held = heldLoader();
    const db = freshDb();
    await db.open();
    await db.putEntries([
      entry({
        id: 'vine',
        title: 'The vine and the branches',
        notes: 'He stayed on abiding for twenty minutes.',
        anchors: [
          {
            kind: 'scripture',
            book: 'john',
            chapterStart: 15,
            verseStart: 1,
            chapterEnd: 15,
            verseEnd: 17,
          },
        ],
      }),
    ]);

    show(<PassageHistoryView reference="John 15" />, db, '#/history/John%2015');

    await waitFor(() => expect(screen.queryByText(/Loading your history/)).toBeNull());
    expect(screen.getByText(/The vine and the branches/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('My history with John 15');

    // It does ask — the "Read John 15" link has to know how this build divides
    // the chapter — but the reader's own history did not wait for the answer.
    await waitFor(() => expect(held.asked).toBe(1));
    expect(screen.queryByRole('link', { name: /^Read John 15$/ })).toBeNull();
  });
});

describe('Search does not wait for Scripture data to show journal results', () => {
  /**
   * Section 11. Typing "anxiety" is answered from the journal, which is
   * indexed storage and nothing to do with headings.
   *
   * What this file will NOT claim is that an ordinary word search never needs
   * the divisions at all. Under `public` a typed word is matched against
   * outline titles too, so it genuinely does — see the audit in the lane
   * report. What is asserted is the part that is true: the journal answers
   * first, and opening the view asks for nothing.
   */
  it('asks for nothing until something is typed', async () => {
    const held = heldLoader();
    const db = freshDb();
    await db.open();

    show(<SearchView query="" />, db, '#/search');
    await screen.findByRole('heading', { level: 1 });

    expect(held.asked).toBe(0);
  });

  it('shows a journal match while the loader never resolves', async () => {
    heldLoader();
    const db = freshDb();
    await db.open();
    await db.putEntries([
      entry({ id: 'anx', title: 'On anxiety', notes: 'Be careful for nothing.' }),
    ]);

    show(<SearchView query="anxiety" />, db, '#/search?q=anxiety');

    // The title shows on the result row and again in its excerpt.
    expect((await screen.findAllByText(/On anxiety/)).length).toBeGreaterThan(0);
  });

  /**
   * A link must never point somewhere other than where it says.
   *
   * "Read it in the King James Version" goes to the span holding the verse.
   * Working that out IS the divisions, and without them `passageRouteFor`
   * falls back to the whole book — correct for a verse that genuinely has no
   * segment, and a silent lie while one is still on its way. So the row does
   * not appear until it can be right.
   *
   * Found by CI, not by a local run: locally the chunk always won the race.
   * That is the whole argument for holding the loader instead of hoping.
   */
  it('does not offer a passage link while the divisions are still coming', async () => {
    heldLoader();
    const db = freshDb();
    await db.open();

    show(<SearchView query="John 15:5" />, db, '#/search?q=John%2015%3A5');
    await screen.findByRole('heading', { level: 1 });

    // The reference parsed — that needs no divisions — but the door to it is
    // not opened until the destination is known.
    await waitFor(() => {
      expect(screen.queryByText(/Read it in the King James Version/)).toBeNull();
    });
  });

  /**
   * And the same row DOES appear, pointing at a passage, once they arrive.
   *
   * Without this the test above would pass against a search view that had
   * simply lost the feature.
   */
  it('offers it, pointing at a passage, once they arrive', async () => {
    __setSectionsLoader();
    const db = freshDb();
    await db.open();

    show(<SearchView query="John 15:5" />, db, '#/search?q=John%2015%3A5');

    const link = await screen.findByText(/Read it in the King James Version/);
    const href = link.closest('a')?.getAttribute('href');
    expect(href).toMatch(/^#\/passage\/john\//);
  });

  /**
   * And the thing it must never do while waiting: claim there is nothing.
   *
   * A false "nothing found" is the failure a reader acts on — they stop
   * looking. It is also exactly what an empty division set produces if the
   * view forgets that "not yet" and "not there" are different answers.
   */
  it('never says nothing was found while the divisions are still coming', async () => {
    heldLoader();
    const db = freshDb();
    await db.open();

    show(<SearchView query="samaritan" />, db, '#/search?q=samaritan');
    await screen.findByRole('heading', { level: 1 });

    await waitFor(() => {
      expect(screen.queryByText(/Nothing in your journal/i)).toBeNull();
      expect(screen.queryByText(/No results/i)).toBeNull();
    });
  });
});

describe('remembered sermon details stay off the critical path', () => {
  /**
   * Section 7, and the specific trap it names: this lane must not remove the
   * section dependency and replace it with a scan of five thousand entries
   * before Notes can be focused.
   *
   * The suggestions belong to Details, which is shut. Nothing about them may
   * happen before the reader can type.
   */
  it('does not read the journal for suggestions before Notes is focused', async () => {
    heldLoader();
    const db = freshDb();
    await db.open();
    await db.putEntries(
      Array.from({ length: 40 }, (_, n) =>
        entry({ id: `past-${n}`, title: `Sermon ${n}`, place: 'St Luke’s' } as Partial<Entry> & { id: string }),
      ),
    );

    let listed = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'listEntries') {
          return (...args: unknown[]) => {
            listed += 1;
            return (target.listEntries as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as DexieStorageProvider;

    show(<EntryEditor />, counting, '#/entry/new?kind=sermon');

    const notes = await screen.findByLabelText('Notes');
    await waitFor(() => expect(document.activeElement).toBe(notes));
    fireEvent.change(notes, { target: { value: 'First line.' } });

    // The floor: this proves the counter was wired to something real, so a
    // zero above cannot be a proxy that was never consulted.
    expect(listed).toBe(0);
    fireEvent.click(screen.getByText(/Date, place, speaker/));
    await waitFor(() => expect(listed).toBeGreaterThan(0));
  });
});
