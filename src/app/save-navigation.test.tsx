/**
 * A navigation that was scheduled, and the app moving on before it ran.
 *
 * Saving defers its navigation by one animation frame so the confirmation can
 * be announced before the view carrying it is replaced. Saving an entry that
 * ALREADY exists navigates to the address the browser is already on, which
 * makes that frame invisible: nothing on screen changes, so nothing can be
 * waited for, and a navigation made inside the frame was silently undone when
 * the frame finally ran.
 *
 * These hold `requestAnimationFrame` and decide the ordering here rather than
 * hoping to catch it. That is the only way to test this: a frame is about
 * sixteen milliseconds, and a run that happens to be fast enough proves
 * nothing about a phone that put the app in the background mid-save.
 *
 * Two of the required cases live elsewhere rather than being duplicated here:
 * saving in focus mode is `EntryEditor.focus.wiring.test.tsx`, and Android
 * Back is `EntryEditor.focus-back.test.tsx`.
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

let dbCounter = 0;
let db: DexieStorageProvider;

/** The whole application, as `main.tsx` assembles it. */
function renderApp() {
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

const notesBox = () => screen.findByLabelText('Notes', { exact: true });
const saveButton = () => screen.getByRole('button', { name: 'Save' });
/** The confirmation as a person sees it: on screen, not only announced. */
const confirmation = () => screen.queryByText('Saved', { selector: 'p, p *' });

/**
 * Take every animation frame, and hand them back on request.
 *
 * The app's deferred navigation goes through `requestAnimationFrame`, so this
 * is the seam that lets a test stand exactly where the failure stood: a
 * navigation queued, and nothing having run it yet.
 */
function holdFrames() {
  const held: FrameRequestCallback[] = [];
  const spy = vi
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback: FrameRequestCallback) => held.push(callback));

  return {
    get pending() {
      return held.length;
    },
    /** Let the browser have its frames back, oldest first. */
    release() {
      spy.mockRestore();
      for (const callback of held.splice(0)) callback(performance.now());
    },
  };
}

/**
 * Wait until the save has actually deferred a navigation.
 *
 * The floor for every case here: each one is about what happens to a queued
 * navigation, and all of them pass trivially against a build that queues none.
 */
async function deferredNavigation(frames: { pending: number }) {
  await waitFor(() =>
    expect(frames.pending, 'no navigation was deferred, so nothing is being tested').toBeGreaterThan(0),
  );
}

/** A saved entry to open, and the address it lives at. */
async function seedEntry() {
  const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });
  window.location.hash = `#/entry/${entry.id}`;
  return entry;
}

beforeEach(async () => {
  // Let anything the previous test scheduled land before this one starts.
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.location.hash = '#/entry/new';
  localStorage.setItem('journey:welcomed', '1');
  db = new DexieStorageProvider(`journey-save-nav-${(dbCounter += 1)}`);
  await db.open();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('when nothing else has navigated', () => {
  it('A — saving an entry that already exists leaves the reader on it', async () => {
    const entry = await seedEntry();
    renderApp();
    await notesBox();

    const frames = holdFrames();
    fireEvent.change(await notesBox(), { target: { value: 'Replaced entirely.' } });
    fireEvent.click(saveButton());

    await waitFor(async () =>
      expect((await db.getEntry(entry.id))?.notes).toBe('Replaced entirely.'),
    );
    // The floor: a navigation really was deferred. Without this the case
    // passes just as well against a build that never schedules one, and then
    // it is testing nothing at all. Waited for rather than read once — the
    // save queues it in a continuation after the write resolves.
    await deferredNavigation(frames);

    frames.release();

    await waitFor(() => expect(window.location.hash).toBe(`#/entry/${entry.id}`));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edit entry' }),
      'the reader was taken off the entry they saved',
    ).toBeTruthy();
  });

  it('B — saving a new entry still moves to the entry it created', async () => {
    renderApp();
    fireEvent.change(await notesBox(), { target: { value: 'Something worth keeping.' } });
    expect(window.location.hash, 'did not start on the new-entry route').toBe('#/entry/new');

    const frames = holdFrames();
    fireEvent.click(saveButton());

    let saved: { id: string } | undefined;
    await waitFor(async () => {
      const entries = await db.listEntries();
      expect(entries).toHaveLength(1);
      saved = entries[0];
    });

    await deferredNavigation(frames);
    // Held, so the route has not moved yet. This is what makes the release
    // below mean something.
    expect(window.location.hash, 'the navigation was not deferred at all').toBe('#/entry/new');

    frames.release();

    await waitFor(() => expect(window.location.hash).toBe(`#/entry/${saved!.id}`));
    expect(confirmation(), 'the confirmation did not survive the navigation').toBeTruthy();
  });
});

describe('when the reader has moved on first', () => {
  it('C — a save navigation cannot take them back off the page they opened', async () => {
    const entry = await seedEntry();
    renderApp();
    await notesBox();

    const frames = holdFrames();
    fireEvent.change(await notesBox(), { target: { value: 'Replaced entirely: a kingfisher.' } });
    fireEvent.click(saveButton());
    await waitFor(async () =>
      expect((await db.getEntry(entry.id))?.notes).toContain('kingfisher'),
    );
    await deferredNavigation(frames);

    // Somewhere else, while the save's frame is still waiting.
    window.location.hash = '#/search?q=kingfisher';
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Search/i),
    );

    frames.release();

    // A beat, so a navigation that was going to happen has happened.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      window.location.hash,
      'the stale save navigation dragged the reader back to the entry',
    ).toBe('#/search?q=kingfisher');
    expect(
      screen.getByRole('heading', { level: 1 }).textContent,
      'the search page was replaced by the editor',
    ).toMatch(/Search/i);
  });

  it('D — a frame held as long as a backgrounded app still stands down', async () => {
    const entry = await seedEntry();
    renderApp();
    await notesBox();

    const frames = holdFrames();
    fireEvent.change(await notesBox(), { target: { value: 'Replaced entirely: a heron.' } });
    fireEvent.click(saveButton());
    await waitFor(async () => expect((await db.getEntry(entry.id))?.notes).toContain('heron'));
    await deferredNavigation(frames);

    /*
     * Two navigations and a real pause before the frame is allowed to run.
     *
     * `requestAnimationFrame` does not fire while a page is in the background,
     * so the wait is not bounded by one frame — it is bounded by when the app
     * is next looked at. By then the reader may have gone several places.
     */
    window.location.hash = '#/search?q=heron';
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Search/i),
    );
    window.location.hash = '#/';
    await new Promise((resolve) => setTimeout(resolve, 120));

    frames.release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      window.location.hash,
      'a frame from before the reader left took them back when it finally ran',
    ).toBe('#/');
  });

  it('E — the confirmation is still shown, having been the point of the delay', async () => {
    const entry = await seedEntry();
    renderApp();
    await notesBox();

    const frames = holdFrames();
    fireEvent.change(await notesBox(), { target: { value: 'Replaced entirely.' } });
    fireEvent.click(saveButton());
    await waitFor(async () =>
      expect((await db.getEntry(entry.id))?.notes).toBe('Replaced entirely.'),
    );

    // Standing the navigation down must not stand the confirmation down with
    // it: the reader still saved something, and still needs telling.
    await waitFor(() => expect(confirmation()).toBeTruthy());
    window.location.hash = '#/search?q=anything';
    frames.release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(confirmation(), 'the reader was told nothing about a save that happened').toBeTruthy();
  });
});
