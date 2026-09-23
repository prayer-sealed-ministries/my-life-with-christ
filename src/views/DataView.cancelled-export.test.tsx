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
import { loadSections } from '../app/sections';

/*
 * The divisions, through the loader the application itself uses.
 *
 * DataView genuinely needs them — the archive carries division ids and an
 * import resolves them — so it suspends until they are here. Awaiting the real
 * loader once, at module scope, is what lets these tests render it directly,
 * and it keeps the data they assert against the data the product serves.
 */
await loadSections();


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
function platformAnswering(saved: boolean, delayMs = 0): Platform {
  return {
    ...webPlatform,
    files: {
      async save(): Promise<SaveResult> {
        // A picker the reader takes a moment over, or a machine under load.
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return { saved };
      },
    },
  };
}

/**
 * Wait for the export attempt to finish and say what it did.
 *
 * This replaces `await new Promise((r) => setTimeout(r, 50))`, which was not a
 * synchronisation point but a guess at how long building an archive takes. On a
 * loaded machine the guess was wrong: measured at 5 failures in 148
 * oversubscribed full-suite runs. At the 50ms mark the export is still in
 * flight — the button reads "Building your archive…" and nothing has been
 * announced — so the assertions below ran against a page that had not answered
 * yet. The product was correct in every one of those runs; only the test was
 * early.
 *
 * Two conditions, both meaningful. The sentence is set after `updateSettings`
 * has been awaited, so once it is on the page the re-read export state is too.
 * The button returning to idle proves `runExport` reached its `finally`, which
 * is what makes reading the settings straight afterwards sound rather than
 * lucky.
 */
async function exportAttemptSettled(): Promise<HTMLElement[]> {
  const said = await screen.findAllByText(/Nothing was saved/i, undefined, { timeout: 15_000 });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Export everything' })).toBeEnabled(),
  );
  return said;
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
    const nothing = await exportAttemptSettled();

    // An assertion, not a wait: the old code used this as its synchronisation,
    // but the entries were written in beforeEach and an export never touches
    // them, so it passed on its first check and settled nothing.
    expect(await db.listEntries(), 'the export changed the journal').toHaveLength(2);

    expect(
      screen.queryByText('Last exported today.'),
      'a cancelled save made the page claim a backup',
    ).toBeNull();
    expect(screen.getByText(/Never exported/i)).toBeInTheDocument();
    expect((await db.getSettings()).lastExportAt).toBeUndefined();

    // The one this test missed the first time, and a real phone did not: the
    // result line announced a filename for a file that was never written —
    // "Saved journey-export-2026-09-18.zip — 2 entries. Keep it somewhere that
    // is not this device." Asserting only on the status line left it standing.
    expect(
      screen.queryByText(/^Saved journey-export/),
      'a cancelled save announced a saved file',
    ).toBeNull();
    // Two nodes carry it: the visible line and the live region. Both are
    // wanted; what matters is that it is said and not dressed as a success.
    expect(nothing.length).toBeGreaterThan(0);
    const visible = nothing.find((n) => !n.className.includes('sr-only'))!;
    expect(visible.className, 'the cancellation was styled as a success').not.toMatch(/green/);
    expect(visible.textContent, 'the cancellation carried a success tick').not.toContain('✓');
  }, 30_000);

  /**
   * The intermittent above, made deterministic.
   *
   * The failure was never about this scenario being rare — it was about the
   * test asserting before the export had answered. A save that takes longer
   * than any fixed sleep would allow reproduces it every single time, so this
   * is the regression proof rather than a repetition count: reinstate a
   * `setTimeout(50)` in place of `exportAttemptSettled()` and this fails on
   * every run, not one in thirty.
   *
   * It is also a real case. A reader who sits looking at the file picker, or a
   * phone building a large archive, takes longer than 50ms.
   */
  it('still refuses to claim a backup when the save takes its time', async () => {
    // Comfortably longer than the sleep this test used to rely on.
    renderWith(platformAnswering(false, 300));

    expect(await screen.findByText(/Never exported/i)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Export everything' }));

    const nothing = await exportAttemptSettled();

    // The same claims as the fast case. A slow cancellation is still a
    // cancellation, and must not become a backup.
    expect(
      screen.queryByText('Last exported today.'),
      'a slow cancelled save made the page claim a backup',
    ).toBeNull();
    expect(screen.getByText(/Never exported/i)).toBeInTheDocument();
    expect((await db.getSettings()).lastExportAt).toBeUndefined();
    expect(
      screen.queryByText(/^Saved journey-export/),
      'a slow cancelled save announced a saved file',
    ).toBeNull();
    expect(await db.listEntries(), 'the export changed the journal').toHaveLength(2);

    const visible = nothing.find((node) => !node.className.includes('sr-only'))!;
    expect(visible.className, 'the cancellation was styled as a success').not.toMatch(/green/);
    expect(visible.textContent, 'the cancellation carried a success tick').not.toContain('✓');
  }, 30_000);

  it('leaves the warning that this device is not a backup exactly where it was', async () => {
    renderWith(platformAnswering(false));
    fireEvent.click(await screen.findByRole('button', { name: 'Export everything' }));
    await exportAttemptSettled();

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

    // And a real save still names the file, which is the half that must not
    // have been broken by silencing the other.
    expect(screen.getAllByText(/Saved journey-export.*entries\./).length).toBeGreaterThan(0);
  }, 30_000);
});
