/**
 * Saving a new entry, through the routing the application actually uses.
 *
 * This is the gate. A direct `render(<EntryEditor />)` cannot prove the thing
 * that was broken, and proved the opposite for a week: saving a NEW entry
 * navigates `#/entry/new` -> `#/entry/<id>`, App gives those routes different
 * React keys (`new:*` vs `entry:<id>`), and the remount destroyed the
 * confirmation in the same tick it was set. Rendering the editor on its own
 * never changes route, never changes key, never remounts — so the test passed
 * and the phone did not.
 *
 * So this drives the real thing: the real router, the real key-per-route
 * switch, the real Shell. It asserts the remount happens — because that is the
 * architecture, and a test that quietly stopped exercising it would stop
 * testing anything — and that the confirmation survives it anyway.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App';
import { NoticeProvider } from './notice';
import { RouterProvider } from './router';
import { StorageContextProvider } from './storage';
import { PlatformProvider } from '../platform/provider';
import { ThemeProvider } from './theme';
import { DexieStorageProvider } from '../storage/db';
import type { StorageProvider } from '../storage/StorageProvider';

let dbCounter = 0;
let db: DexieStorageProvider;

/** The whole application, as `main.tsx` assembles it. */
function renderApp(storage: StorageProvider = db) {
  return render(
    <PlatformProvider>
      <ThemeProvider>
        <StorageContextProvider provider={storage}>
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

const notesBox = () => screen.findByLabelText('Notes', { exact: true });
const saveButton = () => screen.getByRole('button', { name: 'Save' });

/** The confirmation as a person sees it: on screen, not only announced. */
const confirmation = () => screen.queryByText('Saved', { selector: 'p, p *' });

beforeEach(async () => {
  // Let anything the previous test scheduled land before this one starts.
  // Saving queues its navigation on the next animation frame, and that callback
  // can outlive the unmount — it then rewrites the hash mid-test and the next
  // case opens an entry id that belongs to a database it has never seen.
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.location.hash = '#/entry/new';
  localStorage.setItem('journey:welcomed', '1');
  db = new DexieStorageProvider(`journey-save-wiring-${(dbCounter += 1)}`);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('saving a new entry through the real routing', () => {
  it('changes route, remounts the editor, and still shows the confirmation', async () => {
    renderApp();

    fireEvent.change(await notesBox(), { target: { value: 'Something worth keeping.' } });
    expect(window.location.hash, 'did not start on the new-entry route').toBe('#/entry/new');

    fireEvent.click(saveButton());

    // 4. the entry gets a real id
    let saved: { id: string } | undefined;
    await waitFor(async () => {
      const entries = await db.listEntries();
      expect(entries).toHaveLength(1);
      saved = entries[0];
    });
    expect(saved!.id, 'the persisted entry has no id').toBeTruthy();

    // 5. the route changes to the persisted entry
    await waitFor(() => {
      expect(window.location.hash, 'the route did not move to the saved entry').toBe(
        `#/entry/${saved!.id}`,
      );
    });

    // 6. and the editor really does remount — this is the architecture the
    //    defect lived in, so it is asserted rather than assumed away.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edit entry' }),
      'the editor did not switch to the persisted-entry view',
    ).toBeTruthy();

    // 7. the confirmation is nonetheless on screen
    await waitFor(() => {
      expect(confirmation(), 'the confirmation did not survive the navigation').toBeTruthy();
    });
  });

  it('announces it to a screen reader from a region the navigation cannot take', async () => {
    renderApp();
    fireEvent.change(await notesBox(), { target: { value: 'Announced too.' } });
    fireEvent.click(saveButton());

    await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));

    await waitFor(() => {
      const live = screen.getByText('Saved').closest('[aria-live]');
      expect(live, 'the confirmation is not inside a live region').toBeTruthy();
      expect(live!.getAttribute('aria-live')).toBe('polite');
    });
  });

  // Auto-dismissal is proven in `notice.test.tsx`, against the provider alone:
  // fake timers and fake-indexeddb do not coexist, and stalling the database to
  // test a countdown would test the stall.
});

describe('a save that fails', () => {
  it('says nothing reassuring', async () => {
    // The direction that matters: silence is survivable, a false "Saved" is not.
    const failing = new DexieStorageProvider(`journey-save-wiring-${(dbCounter += 1)}`);
    vi.spyOn(failing, 'createEntry').mockRejectedValue(new Error('disk is full'));

    renderApp(failing);
    fireEvent.change(await notesBox(), { target: { value: 'This will not persist.' } });
    fireEvent.click(saveButton());

    await waitFor(
      () => {
        expect(document.body.textContent ?? '').toMatch(/could not be saved/i);
      },
      { timeout: 10_000 },
    );
    expect(confirmation(), 'a failed save was confirmed as saved').toBeNull();
    expect(window.location.hash, 'a failed save navigated anyway').toBe('#/entry/new');
  }, 20_000);
});

describe('editing an entry that already exists', () => {
  it('confirms without any route change at all', async () => {
    const existing = await db.createEntry({ notes: 'Already here.' });
    window.location.hash = `#/entry/${existing.id}`;
    renderApp();

    fireEvent.change(await notesBox(), { target: { value: 'Already here, revised.' } });
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(confirmation(), 'an edit was not confirmed').toBeTruthy();
    });
    expect(window.location.hash).toBe(`#/entry/${existing.id}`);
    expect((await db.getEntry(existing.id))!.notes).toBe('Already here, revised.');
  });
});

describe('deleting an entry', () => {
  it('says so after the navigation it causes', async () => {
    // Found by auditing for the same root cause as the save defect: a
    // successful action that navigates away cannot confirm itself from the
    // screen it is leaving. Deleting used to say nothing whatsoever.
    const existing = await db.createEntry({ notes: 'Not wanted.' });
    window.location.hash = `#/entry/${existing.id}`;
    renderApp();

    await notesBox();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this entry' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, delete it' }));

    await waitFor(async () => expect(await db.listEntries()).toHaveLength(0));
    await waitFor(() => {
      expect(window.location.hash, 'delete did not return to the timeline').toBe('#/timeline');
    });
    await waitFor(() => {
      expect(
        screen.queryByText('Entry deleted', { selector: 'p, p *' }),
        'the deletion was never acknowledged',
      ).toBeTruthy();
    });
  }, 20_000);
});
