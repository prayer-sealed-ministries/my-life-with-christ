/**
 * What a native edition does when SQLite will not open.
 *
 * Phase 1 proved the app fails closed when no SQLite provider exists at all.
 * Phase 2 registered one, which creates a new and more dangerous case: the
 * provider is obtained successfully and then `open()` rejects — a corrupt file,
 * a migration that refused, a plugin that is present but broken.
 *
 * On the web that is a partial loss and the app carries on with a banner:
 * Scripture, topics and the book still work, and a dead app would be worse. On
 * a native edition the store IS the product, and carrying on would mean an app
 * that looks ready, accepts an entry, and loses it — with Dexie sitting one line
 * away as the tempting repair.
 *
 * So these assert the whole rule, not just the screen: no fallback provider is
 * constructed, no journal UI mounts, and nothing that could take a keystroke
 * reaches the reader.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StorageProvider } from '../storage/StorageProvider';

/** Every Dexie construction, recorded. The number that must stay zero. */
const dexieConstructions: string[] = [];

vi.mock('../storage/db', () => ({
  DexieStorageProvider: class {
    readonly engine = 'indexeddb' as const;
    constructor(name = 'journey') {
      dexieConstructions.push(name);
    }
  },
  todayIso: () => '2026-09-16',
  EMPTY_ENTRY: {},
  anchorKeys: () => [],
  searchableText: () => '',
}));

// The edition under test is the native one.
vi.mock('../platform/runtime', () => ({
  requiredStorageKind: () => 'sqlite' as const,
  edition: () => 'native' as const,
  nativePlatform: () => 'ios' as const,
}));

const OPEN_FAILURE = 'database disk image is malformed';

/** A SQLite provider that is obtained fine and then refuses to open. */
function brokenSqlite(): StorageProvider & { calls: string[] } {
  const calls: string[] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]): Promise<never> => {
      calls.push(name);
      void args;
      throw new Error(`${name} should never have been reached`);
    };

  return {
    calls,
    open: async () => {
      calls.push('open');
      throw new Error(OPEN_FAILURE);
    },
    getEntry: record('getEntry'),
    listEntries: record('listEntries'),
    listEntriesChronological: record('listEntriesChronological'),
    createEntry: record('createEntry'),
    updateEntry: record('updateEntry'),
    deleteEntry: record('deleteEntry'),
    findEntriesForAnchor: record('findEntriesForAnchor'),
    putEntries: record('putEntries'),
    replaceEntries: record('replaceEntries'),
    clearEntries: record('clearEntries'),
    putDraft: record('putDraft'),
    getDraft: record('getDraft'),
    getDraftForEntry: record('getDraftForEntry'),
    listDrafts: record('listDrafts'),
    deleteDraft: record('deleteDraft'),
    getSettings: record('getSettings'),
    updateSettings: record('updateSettings'),
    listTags: record('listTags'),
    listSpeakers: record('listSpeakers'),
    listPlaces: record('listPlaces'),
  } as StorageProvider & { calls: string[] };
}

let provider: ReturnType<typeof brokenSqlite>;

vi.mock('../platform/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../platform/storage')>();
  return {
    ...actual,
    selectStorageProvider: () => ({ kind: 'sqlite' as const, provider }),
  };
});

const { StorageContextProvider } = await import('./storage');

beforeEach(() => {
  dexieConstructions.length = 0;
  provider = brokenSqlite();
});

afterEach(() => {
  // Explicit: this project does not enable Testing Library's auto-cleanup, so
  // renders accumulate and every query after the first finds several screens.
  cleanup();
  vi.clearAllMocks();
});

describe('a native edition whose SQLite will not open', () => {
  it('shows the storage failure state instead of the journal', async () => {
    render(
      <StorageContextProvider>
        <p>THE JOURNAL UI</p>
      </StorageContextProvider>,
    );

    expect(
      await screen.findByRole('heading', { name: /cannot open your journal/i }),
    ).toBeTruthy();
    // The underlying cause is shown, because whoever sees this needs to know
    // which store failed and why.
    expect(screen.getByText(new RegExp(OPEN_FAILURE, 'i'))).toBeTruthy();
  });

  it('does not mount the journal UI, so nothing can take a keystroke', async () => {
    render(
      <StorageContextProvider>
        <p>THE JOURNAL UI</p>
      </StorageContextProvider>,
    );

    await screen.findByRole('heading', { name: /cannot open your journal/i });
    expect(screen.queryByText('THE JOURNAL UI'), 'the journal UI mounted anyway').toBeNull();
  });

  it('never falls back to Dexie', async () => {
    render(
      <StorageContextProvider>
        <p>THE JOURNAL UI</p>
      </StorageContextProvider>,
    );

    await screen.findByRole('heading', { name: /cannot open your journal/i });
    expect(dexieConstructions, 'an IndexedDB provider was constructed').toEqual([]);
  });

  it('accepts no journal write after the failure', async () => {
    render(
      <StorageContextProvider>
        <p>THE JOURNAL UI</p>
      </StorageContextProvider>,
    );

    await screen.findByRole('heading', { name: /cannot open your journal/i });

    // A floor: the provider really was asked to open, so this test is looking
    // at the failure path rather than at a component that never rendered.
    expect(provider.calls, 'open was never attempted').toContain('open');
    // And nothing else was called on it — no read, and above all no write.
    expect(
      provider.calls.filter((call) => call !== 'open'),
      'the app used the store after it failed to open',
    ).toEqual([]);
  });

  it('says plainly that nothing was written', async () => {
    render(
      <StorageContextProvider>
        <p>THE JOURNAL UI</p>
      </StorageContextProvider>,
    );

    await screen.findByRole('heading', { name: /cannot open your journal/i });
    expect(screen.getByText(/Nothing has been written or changed/i)).toBeTruthy();
  });
});
