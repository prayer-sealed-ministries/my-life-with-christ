import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import type { Entry } from '../types';
import HomeView from './HomeView';

let dbCounter = 0;

function freshProvider(): DexieStorageProvider {
  dbCounter += 1;
  return new DexieStorageProvider(`journey-home-test-${dbCounter}`);
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

function renderHome(provider: DexieStorageProvider) {
  return render(
    <RouterProvider>
      <StorageContextProvider provider={provider}>
        <HomeView />
      </StorageContextProvider>
    </RouterProvider>,
  );
}

beforeEach(() => {
  window.location.hash = '#/';
});

// Vitest does not run with `globals: true`, so Testing Library's automatic
// cleanup never registers. Without this, every render stacks up in one document.
afterEach(cleanup);

describe('HomeView', () => {
  it('says what this is and that it stays on the device', async () => {
    const provider = freshProvider();
    await provider.open();

    renderHome(provider);

    // The name and the tagline moved into the header, so this view no longer
    // carries them — repeating them here was most of a phone's first screen.
    // They are held by `Shell.header.test.tsx` and by the e2e suite, which see
    // the real header; this view is responsible for what it still says.
    expect(screen.queryByText('Your walk, remembered.')).toBeNull();
    expect(screen.getByText(/stays on this device/i)).toBeInTheDocument();
    expect(screen.getByText(/no account/i)).toBeInTheDocument();
  });

  it('offers each way in', async () => {
    const provider = freshProvider();
    await provider.open();

    renderHome(provider);

    // Each to a route that already exists.
    //
    // Sermon note names its kind rather than relying on the editor's default,
    // because it is the same destination the Android launcher shortcut
    // selects — one door, reachable two ways. See src/app/launch-actions.ts.
    const expected: Array<[RegExp, string]> = [
      [/Sermon note/, '#/entry/new?kind=sermon'],
      [/^Prayer/, '#/entry/new?kind=prayer'],
      [/^Reflection/, '#/entry/new?kind=reflection'],
      [/Read Scripture/, '#/browse'],
      [/^Topics/, '#/topics'],
      [/^Search/, '#/search'],
    ];

    for (const [name, target] of expected) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', target);
    }
  });

  it('shows the most recent entries, newest first, once some exist', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([
      entry({ id: 'a', title: 'Oldest', date: '2026-01-05' }),
      entry({ id: 'b', title: 'Middle', date: '2026-02-05' }),
      entry({ id: 'c', title: 'Newest', date: '2026-03-05', speaker: 'Pastor Whitfield' }),
      entry({ id: 'd', title: 'Ancient history', date: '2024-01-05' }),
    ]);

    renderHome(provider);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Recently written' }),
    ).toBeInTheDocument();

    const recent = screen.getAllByRole('link', { name: /Oldest|Middle|Newest|Ancient/ });
    expect(recent.map((link) => link.getAttribute('href'))).toEqual([
      '#/entry/c',
      '#/entry/b',
      '#/entry/a',
    ]);
    // The card carries the kind and the date; the speaker moved off Home when
    // recents became cards rather than rows of metadata.
    expect(screen.getByRole('link', { name: /Newest/ })).toHaveTextContent('Sermon');
  });

  it('welcomes an empty journal rather than showing a blank space', async () => {
    const provider = freshProvider();
    await provider.open();

    renderHome(provider);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    // The heading stays — a section that vanishes leaves a hole where the page
    // was about to say something useful.
    expect(screen.getByRole('heading', { level: 2, name: 'Recently written' })).toBeInTheDocument();
    expect(screen.getByText('Your journey begins here.')).toBeInTheDocument();
    // Nothing to see yet, so nothing offering to show it.
    expect(screen.queryByRole('link', { name: /See the whole journey/ })).toBeNull();
  });

  it('keeps exactly one h1 and never skips a heading level', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'One', date: '2026-02-01' })]);

    renderHome(provider);

    await screen.findByRole('heading', { level: 2, name: 'Recently written' });

    // The h1 is present and first, but visually hidden: the name is shown once
    // in the header, and a page still needs a heading a screen reader can
    // navigate to.
    const headings = screen.getAllByRole('heading');
    const levels = headings.map((heading) => Number(heading.tagName.slice(1)));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0], 'the view does not start at its h1').toBe(1);
    expect(headings[0].className, 'the h1 is visible again, repeating the header').toContain(
      'sr-only',
    );
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });
});
