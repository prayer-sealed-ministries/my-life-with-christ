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

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Life With Christ');
    expect(screen.getByText('Your walk with God, remembered.')).toBeInTheDocument();
    expect(screen.getByText(/stays on this device/i)).toBeInTheDocument();
    expect(screen.getByText(/no account/i)).toBeInTheDocument();
  });

  it('offers the four ways in', async () => {
    const provider = freshProvider();
    await provider.open();

    renderHome(provider);

    const expected: Array<[RegExp, string]> = [
      [/New sermon note/, '#/entry/new'],
      [/^Bible/, '#/browse'],
      [/^Topics/, '#/topics'],
      [/My journey/, '#/timeline'],
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
    expect(screen.getByRole('link', { name: /Newest/ })).toHaveTextContent('Pastor Whitfield');
  });

  it('shows no recent section when the journal is empty', async () => {
    const provider = freshProvider();
    await provider.open();

    renderHome(provider);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Recently written' })).not.toBeInTheDocument();
  });

  it('keeps exactly one h1 and never skips a heading level', async () => {
    const provider = freshProvider();
    await provider.open();
    await provider.putEntries([entry({ id: 'a', title: 'One', date: '2026-02-01' })]);

    renderHome(provider);

    await screen.findByRole('heading', { level: 2, name: 'Recently written' });

    const levels = screen.getAllByRole('heading').map((heading) => Number(heading.tagName.slice(1)));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });
});
