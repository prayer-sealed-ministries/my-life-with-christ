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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App';
import { NoticeProvider } from './notice';
import { RouterProvider } from './router';
import { StorageContextProvider } from './storage';
import { PlatformProvider } from '../platform/provider';
import { ThemeProvider } from './theme';
import { DexieStorageProvider } from '../storage/db';
import { ownAnimationFrames, type OwnedFrames } from '../testing/frames';
import type { StorageProvider } from '../storage/StorageProvider';

let dbCounter = 0;
let db: DexieStorageProvider;
/**
 * The frames this file schedules, and whose fault they are.
 *
 * Saving defers its navigation by one frame. Owning them here is what stops
 * one test's navigation landing in the next one's address bar — see
 * src/testing/frames.ts.
 */
let frames: OwnedFrames;
/**
 * Set by the test that wants to model a write landing late.
 *
 * A save's write can resolve after the test that asked for it has ended, and
 * the continuation then schedules its navigation from outside any test. There
 * is no way to ask the app to do that on cue, so teardown does the one thing
 * such a continuation would do: schedule a frame that navigates.
 */
let navigateAfterTeardown = false;
/** Where a frame scheduled between tests would take the next one. */
const LATE_ARRIVAL = '#/entry/late-arrival';

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

beforeAll(() => {
  frames = ownAnimationFrames();
});

afterAll(() => {
  frames.restore();
});

beforeEach(async () => {
  /*
   * The isolation, and the whole of it: cancel every frame outstanding before
   * this test begins.
   *
   * Deliberately here rather than in `afterEach`. Teardown can only cancel
   * what has already been scheduled, and the work that actually leaks is
   * scheduled late — a save whose write resolves after its own test has ended,
   * which is likelier on a loaded machine. Cancelling on the way IN catches
   * both that and anything the previous test left behind.
   *
   * It runs before the address is set below, so a stray frame that fires in
   * the gap cannot outlive this line either.
   */
  frames.settle();
  // No sleep here any more. This used to wait 50ms for the previous test's
  // deferred navigation to land somewhere harmless, which is a bet on timing
  // rather than isolation: the callback rewrites the hash, and the next case
  // then opens an entry id belonging to a database it has never seen. The
  // frames are cancelled in `afterEach` instead, so there is nothing left to
  // outrun.
  window.location.hash = '#/entry/new';
  localStorage.setItem('journey:welcomed', '1');
  db = new DexieStorageProvider(`journey-save-wiring-${(dbCounter += 1)}`);
});

afterEach(() => {
  // Unmount first: React's own effect cleanups cancel some of what they
  // scheduled. The `settle` that follows is a mode reset — it returns the
  // helper to pass-through after a test that paused it — and NOT the thing
  // that provides isolation. That is `beforeEach`, which is the only place
  // that can also catch work scheduled after this hook has run.
  cleanup();
  frames.settle();
  /*
   * And hold every frame from here until the next test starts.
   *
   * `settle` cancels what has been scheduled; it cannot cancel what has not.
   * A save's write can resolve after the test that asked for it has ended —
   * more easily on a loaded machine — and the continuation then schedules its
   * navigation inside whichever test is running. Holding across the boundary
   * means such a frame is captured rather than run, and the next
   * `beforeEach` throws it away.
   */
  if (navigateAfterTeardown) {
    navigateAfterTeardown = false;
    // Scheduled AFTER the hold is in place, exactly as a late continuation
    // would be. Held, it is thrown away by the next `beforeEach`; unheld, it
    // runs inside the next test and takes its address.
    requestAnimationFrame(() => {
      window.location.hash = LATE_ARRIVAL;
    });
  }
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

/**
 * The isolation itself, proved rather than assumed.
 *
 * These two run in order and are meaningless apart. The first deliberately
 * ends with a save's navigation still waiting for a frame — the exact state
 * the old 50ms sleep was betting against — and the second asserts it inherited
 * nothing.
 *
 * No clock anywhere. The first test holds the frame instead of racing it, so
 * "still outstanding when the test ended" is decided here rather than by how
 * busy the machine is; and the second asserts a count, not a delay.
 */
describe('deferred work never crosses a test boundary', () => {
  it('A — ends with a save navigation still queued, on purpose', async () => {
    renderApp();
    fireEvent.change(await notesBox(), { target: { value: 'Left in mid-air.' } });

    // From here frames are held rather than run: this test is going to end
    // while the save still has a navigation waiting for one.
    frames.pause();
    fireEvent.click(saveButton());

    await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));
    await waitFor(() =>
      expect(frames.captured, 'the save deferred nothing, so nothing can leak').toBeGreaterThan(0),
    );
    expect(window.location.hash, 'the navigation ran after all').toBe('#/entry/new');

    // And one more thing lands after this test is over, the way a write that
    // resolves late does.
    navigateAfterTeardown = true;
    // It ends here, still owing a navigation and about to be handed another.
  });

  it('B — begins owing nothing, and keeps its own address', async () => {
    expect(
      frames.pending,
      'work scheduled by the previous test survived into this one',
    ).toBe(0);

    renderApp();
    await notesBox();

    // Let anything outstanding run. Under the old harness this is where the
    // previous test's navigation landed, carrying this one off to an entry it
    // had never created — in a database it had never opened.
    frames.flush();

    expect(
      window.location.hash,
      `a navigation from outside this test moved it (${LATE_ARRIVAL} means one arrived after teardown)`,
    ).toBe('#/entry/new');
    expect(await db.listEntries(), 'this test opened a store of its own').toHaveLength(0);
  });
});
