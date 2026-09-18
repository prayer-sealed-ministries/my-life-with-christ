/**
 * What the journal page says after a save the reader backed out of.
 *
 * The unit tests below `exportEverything` prove the setting is not written.
 * This proves the consequence a person actually sees: the page must not start
 * claiming a backup exists.
 *
 * That claim is the reason the defect mattered. "Last exported today" over a
 * device holding the only copy is not a cosmetic slip — it is the app telling
 * someone their life's writing is safe when it is not, at exactly the moment
 * they might have gone on to clear the app or replace the phone.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { PlatformProvider } from '../platform/provider';
import { webPlatform } from '../platform/web';
import type { Platform, SaveResult } from '../platform/ports';
import { DexieStorageProvider } from '../storage/db';
import type { Entry } from '../types';
import DataView from './DataView';

let dbCounter = 0;
let db: DexieStorageProvider;

const entry = (id: string): Entry => ({
  id,
  kind: 'sermon',
  title: `Entry ${id}`,
  date: '2026-01-01',
  anchors: [],
  scriptureRefs: [],
  notes: 'Worth keeping.',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

/** The real web platform, with only the saver's answer replaced. */
function platformAnswering(saved: boolean): Platform {
  return {
    ...webPlatform,
    files: {
      async save(): Promise<SaveResult> {
        return { saved };
      },
    },
  };
}

const renderWith = (platform: Platform) =>
  render(
    <PlatformProvider platform={platform}>
      <RouterProvider>
        <StorageContextProvider provider={db}>
          <DataView />
        </StorageContextProvider>
      </RouterProvider>
    </PlatformProvider>,
  );

beforeEach(async () => {
  window.location.hash = '#/data';
  db = new DexieStorageProvider(`journey-cancelled-export-${(dbCounter += 1)}`);
  await db.putEntries([entry('a'), entry('b')]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('after a save the reader backed out of', () => {
  it('still says the journal has never been exported', async () => {
    renderWith(platformAnswering(false));

    expect(await screen.findByText(/Never exported/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Export everything' }));

    // Wait for the export attempt to finish, then check what the page claims.
    await waitFor(async () => {
      expect((await db.listEntries()).length).toBe(2);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      screen.queryByText('Last exported today.'),
      'a cancelled save made the page claim a backup',
    ).toBeNull();
    expect(screen.getByText(/Never exported/i)).toBeInTheDocument();
    expect((await db.getSettings()).lastExportAt).toBeUndefined();
  }, 30_000);

  it('leaves the warning that this device is not a backup exactly where it was', async () => {
    renderWith(platformAnswering(false));
    fireEvent.click(await screen.findByRole('button', { name: 'Export everything' }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      screen.getByText(/Warning: the copy on this device is not a backup/i),
    ).toBeInTheDocument();
  }, 30_000);
});

describe('after a save the file system accepted', () => {
  it('says so, and records it', async () => {
    // The other half: the page must still update when a save really happened,
    // or the fix would have traded one lie for a different one.
    renderWith(platformAnswering(true));

    fireEvent.click(await screen.findByRole('button', { name: 'Export everything' }));

    expect(await screen.findByText('Last exported today.', undefined, { timeout: 15_000 }))
      .toBeInTheDocument();
    expect((await db.getSettings()).lastExportAt).toBeTruthy();
  }, 30_000);
});
