/**
 * What happens when the local chunk will not load.
 *
 * Section 15 of the lane brief, and the reason it exists: making data lazy
 * creates a failure mode that did not exist before. When the sections were in
 * the startup chunk, "the chunk failed" meant a white page and there was
 * nothing to design. Now one chunk can fail while the rest of the application
 * is perfectly alive, and what the reader gets in that moment is a decision
 * somebody has to make on purpose.
 *
 * The decisions, asserted below:
 *
 *   - the shell survives, so there is a way out
 *   - the journal survives, because it is the reader's own writing and has
 *     nothing to do with which chunk failed
 *   - nothing is written to storage, ever, in response to a render failing
 *   - the Scripture surface says so honestly, once, and offers a retry
 *   - the retry actually retries
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __setSectionsLoader } from './sections';
import { SectionsBoundary } from './SectionsBoundary';
import { RouterProvider } from './router';
import { StorageContextProvider } from './storage';
import { DexieStorageProvider } from '../storage/db';
import BookView from '../views/BookView';
import App from '../App';
import { PlatformProvider } from '../platform/provider';
import { ThemeProvider } from './theme';
import { NoticeProvider } from './notice';

let counter = 0;

function failingLoader(times = Number.POSITIVE_INFINITY) {
  const state = { asked: 0 };
  __setSectionsLoader(() => {
    state.asked += 1;
    return state.asked <= times
      ? Promise.reject(new Error('chunk unavailable'))
      : import('virtual:journey-outlines');
  });
  return state;
}

function show(db: DexieStorageProvider) {
  window.location.hash = '#/book/john';
  return render(
    <RouterProvider>
      <StorageContextProvider provider={db}>
        {/* The same nesting App uses. A failed load is THROWN by useSections
            during render, which is what an error boundary is for; a load that
            is merely slow returns null and the view shows its own wait. */}
        <SectionsBoundary>
          <BookView bookId="john" />
        </SectionsBoundary>
      </StorageContextProvider>
    </RouterProvider>,
  );
}

beforeEach(() => {
  // The boundary reports to the console on purpose. Silenced so a deliberate
  // failure does not look like a broken test run, and restored afterwards.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Past the first-visit dialog, which jsdom cannot open. This test is about
  // the shell surviving a failed chunk, not about the welcome.
  localStorage.setItem('journey:welcomed', '1');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  __setSectionsLoader();
});

/** The whole application, as `main.tsx` assembles it. */
function renderApp(db: DexieStorageProvider) {
  return render(
    <PlatformProvider>
      <ThemeProvider>
        <StorageContextProvider provider={db}>
          <RouterProvider>
            <NoticeProvider>
              <App />
            </NoticeProvider>
          </RouterProvider>
        </StorageContextProvider>
      </ThemeProvider>
    </PlatformProvider>,
  );
}

/**
 * The wiring, not just the unit.
 *
 * Every test below this renders the boundary by hand, and all of them would
 * pass with `SectionsBoundary` deleted from `App.tsx` — which is precisely the
 * shape of the attribution bug this repository shipped: written, exported,
 * unit-tested, passing, and called by nothing. So one test drives the real
 * application, at a real Scripture route, and asks whether the shell is still
 * standing.
 */
describe('the application survives a Scripture chunk it cannot load', () => {
  it('keeps the shell and the way out', async () => {
    failingLoader();
    const db = new DexieStorageProvider(`journey-fail-${(counter += 1)}`);
    await db.open();
    window.location.hash = '#/book/john';

    renderApp(db);

    // The failure is reported...
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    // ...and the application is still there around it. Without the boundary in
    // App, the throw reaches the root and takes all of this with it.
    expect(screen.getByRole('navigation', { name: /main/i })).toBeInTheDocument();
    // A way to somewhere that is not this page. `My journey` is the reader's
    // own entries, which have nothing to do with the chunk that failed.
    expect(screen.getByRole('link', { name: 'My journey' })).toBeInTheDocument();
  });
});

describe('a section chunk that will not load', () => {
  it('gives an honest failure with a retry, and does not take the tree with it', async () => {
    failingLoader();
    const db = new DexieStorageProvider(`journey-fail-${(counter += 1)}`);
    await db.open();

    show(db);

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
    // Honest about scope: the reader needs to know their writing is not involved.
    expect(screen.getByText(/Nothing in your journal was changed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });

  it('writes nothing to storage', async () => {
    failingLoader();
    const db = new DexieStorageProvider(`journey-fail-${(counter += 1)}`);
    await db.open();

    show(db);
    await screen.findByText(/could not be loaded/i);

    expect(await db.listEntries()).toHaveLength(0);
    expect(await db.listDrafts()).toHaveLength(0);
  });

  it('reports once, not once per render', async () => {
    failingLoader();
    const db = new DexieStorageProvider(`journey-fail-${(counter += 1)}`);
    await db.open();

    show(db);
    await screen.findByText(/could not be loaded/i);

    // The console is the only channel — no banner, no repeat, and nothing that
    // could become a loop of notices while the reader is trying to read.
    const reports = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (call) => String(call[0]).includes('A view failed to render'),
    );
    expect(reports.length).toBeLessThanOrEqual(1);
  });

  it('recovers when the retry succeeds', async () => {
    // Fails once, then the bundled loader answers — which is what a retry of a
    // local chunk actually looks like.
    const state = failingLoader(1);
    const db = new DexieStorageProvider(`journey-fail-${(counter += 1)}`);
    await db.open();

    show(db);
    await screen.findByText(/could not be loaded/i);

    fireEvent.click(screen.getByRole('button', { name: /Try again/i }));

    // The real book renders, from the real divisions.
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('John');
    await waitFor(() => expect(state.asked).toBe(2));
  });

  /**
   * The floor.
   *
   * Every assertion above is of the form "the failure state appeared". All of
   * them would pass against a boundary that showed the failure state
   * unconditionally, so this is the one that proves the failure had to be
   * caused: the same tree, the same boundary, a loader that works.
   */
  it('shows the book, not the failure, when the loader works', async () => {
    __setSectionsLoader();
    const db = new DexieStorageProvider(`journey-fail-${(counter += 1)}`);
    await db.open();

    show(db);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('John');
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });
});
