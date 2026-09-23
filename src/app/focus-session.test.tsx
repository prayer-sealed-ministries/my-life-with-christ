/**
 * Focus mode belongs to one piece of writing.
 *
 * Fast Capture and focus mode answer different needs. Fast Capture is "get me
 * writing this instant" and gives the ordinary editor with the cursor already
 * in the notes box; focus mode is a deliberate choice to take the application
 * away from around it. Choosing the second once must not choose it again,
 * silently, for unrelated writing later — which is what happened: enter focus
 * on a prayer, tap the home-screen widget, and a brand new sermon opened with
 * the chrome already gone.
 *
 * Driven through the real router, the real App key-per-route switch and the
 * real provider, because the bug was in how those three agreed about what
 * counts as "a different editor".
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import App from '../App';
import { FocusProvider } from './focus';
import { NoticeProvider } from './notice';
import { RouterProvider } from './router';
import { StorageContextProvider } from './storage';
import { ThemeProvider } from './theme';
import { PlatformProvider } from '../platform/provider';
import { DexieStorageProvider } from '../storage/db';
import { DRAFT_DEBOUNCE_MS } from '../lib/drafts';
import { launchUrlFor } from './launch-actions';
import { actionFromLaunchUrl, routeForLaunchAction } from './launch-actions';
import { href } from './router';

let counter = 0;
let db: DexieStorageProvider;

function renderApp() {
  return render(
    <PlatformProvider>
      <ThemeProvider>
        <StorageContextProvider provider={db}>
          <RouterProvider>
            <NoticeProvider>
              <FocusProvider>
                <App />
              </FocusProvider>
            </NoticeProvider>
          </RouterProvider>
        </StorageContextProvider>
      </ThemeProvider>
    </PlatformProvider>,
  );
}

const notes = () => screen.findByLabelText('Notes', { exact: true });
const inFocusMode = () => screen.queryByRole('button', { name: 'Leave focus mode' }) !== null;

/** Enter focus mode the way a reader does. */
async function enterFocusMode() {
  fireEvent.click(await screen.findByRole('button', { name: 'Focus' }));
  await waitFor(() => expect(inFocusMode(), 'focus mode did not start').toBe(true));
}

/**
 * What the widget, the launcher shortcut and any future quick action all do.
 *
 * Deliberately resolved through the same allow-list the native binding uses,
 * rather than by typing a hash here: if the action ever named somewhere else,
 * these cases should follow it rather than keep testing the old place.
 */
function invokeFastCapture() {
  const route = routeForLaunchAction(actionFromLaunchUrl(launchUrlFor('sermon-fast-capture')));
  window.location.replace(href(route!));
}

/** Is the notes box where the cursor is? */
const notesFocused = () => {
  const label = [...document.querySelectorAll('label')].find((node) => node.textContent === 'Notes');
  return Boolean(label) && document.getElementById((label as HTMLLabelElement).htmlFor) === document.activeElement;
};

beforeEach(async () => {
  window.location.hash = '#/';
  localStorage.setItem('journey:welcomed', '1');
  db = new DexieStorageProvider(`focus-session-${(counter += 1)}`);
  await db.open();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a new Fast Capture never inherits focus mode', () => {
  it('A — from a saved entry somebody was reading in focus mode', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });
    window.location.hash = `#/entry/${entry.id}`;
    renderApp();
    await notes();
    await enterFocusMode();

    invokeFastCapture();

    await waitFor(() => expect(window.location.hash).toBe('#/entry/new?kind=sermon'));
    await notes();
    expect(inFocusMode(), 'the new sermon inherited focus mode').toBe(false);
    await waitFor(() => expect(notesFocused(), 'the cursor is not in the notes box').toBe(true));
  });

  it('B — from another kind of unfinished writing, whose draft survives', async () => {
    window.location.hash = '#/entry/new?kind=prayer';
    renderApp();
    await notes();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'For my daughter.' } });
    await enterFocusMode();
    await waitFor(async () => expect((await db.listDrafts()).length).toBe(1));

    invokeFastCapture();

    await waitFor(() => expect(window.location.hash).toBe('#/entry/new?kind=sermon'));
    await notes();
    expect(inFocusMode(), 'the sermon inherited the prayer’s focus mode').toBe(false);

    // And the prayer is still there, exactly as written.
    const [draft] = await db.listDrafts();
    expect(draft.form.kind).toBe('prayer');
    expect(draft.form.notes).toBe('For my daughter.');
  });

  it.each([
    ['home', '#/'],
    ['search', '#/search?q=vine'],
    ['passage history', '#/history/John%2015'],
  ])('C — from %s, where focus was never on anyway', async (_where, hash) => {
    window.location.hash = hash;
    renderApp();

    invokeFastCapture();

    await waitFor(() => expect(window.location.hash).toBe('#/entry/new?kind=sermon'));
    await notes();
    expect(inFocusMode()).toBe(false);
  });

  it('E — and again after leaving the session that had it', async () => {
    window.location.hash = '#/entry/new?kind=sermon';
    renderApp();
    await notes();
    await enterFocusMode();

    // Away, then back in through the same doorway.
    window.location.replace('#/');
    await waitFor(() => expect(inFocusMode()).toBe(false));
    invokeFastCapture();

    await waitFor(() => expect(window.location.hash).toBe('#/entry/new?kind=sermon'));
    await notes();
    expect(inFocusMode(), 'focus came back for a session that never asked').toBe(false);
  });

  it('F — and ordinary navigation between saved entries does not pick it up', async () => {
    const first = await db.createEntry({ title: 'One', notes: 'First.' });
    const second = await db.createEntry({ title: 'Two', notes: 'Second.' });
    window.location.hash = `#/entry/${first.id}`;
    renderApp();
    await notes();
    await enterFocusMode();

    window.location.replace(`#/entry/${second.id}`);

    await waitFor(() =>
      expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Second.'),
    );
    expect(inFocusMode(), 'the second entry opened in a mode nobody chose for it').toBe(false);
  });
});

describe('the session that did ask for it keeps it', () => {
  it('D — a second invocation inside the active capture changes nothing', async () => {
    window.location.hash = '#/entry/new?kind=sermon';
    renderApp();
    await notes();
    fireEvent.change(screen.getByLabelText('Notes'), {
      target: { value: 'He began with the vine.' },
    });
    await enterFocusMode();
    await waitFor(async () => expect((await db.listDrafts()).length).toBe(1));

    // The widget, tapped again by somebody already writing.
    invokeFastCapture();
    invokeFastCapture();
    await new Promise((resolve) => setTimeout(resolve, DRAFT_DEBOUNCE_MS * 2));

    expect(inFocusMode(), 'a duplicate tap threw the writer out of focus mode').toBe(true);
    expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe(
      'He began with the vine.',
    );
    expect(await db.listDrafts(), 'a duplicate tap left a second draft behind').toHaveLength(1);
  });

  it('but does not then hand itself to the NEXT capture', async () => {
    /*
     * The subtler half of the same leak, found while fixing the first.
     *
     * Focus survives a save because the writing is the same. What it must not
     * do is keep the pre-save address around afterwards: `new::sermon:` would
     * then match the next brand new sermon somebody opened, and focus mode
     * would arrive there uninvited — the original bug, one step later.
     */
    window.location.hash = '#/entry/new?kind=sermon';
    renderApp();
    await notes();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Saved in focus.' } });
    await enterFocusMode();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.listEntries()).length).toBe(1));
    const [saved] = await db.listEntries();
    await waitFor(() => expect(window.location.hash).toBe(`#/entry/${saved.id}`));
    expect(inFocusMode(), 'the save itself ended focus mode').toBe(true);

    // Now the widget, for a genuinely new sermon.
    invokeFastCapture();

    await waitFor(() => expect(window.location.hash).toBe('#/entry/new?kind=sermon'));
    await notes();
    expect(inFocusMode(), 'the saved entry handed focus mode to a new capture').toBe(false);
  });

  it('survives the save that remounts the editor', async () => {
    /*
     * The reason focus mode lives above the routed view at all. Saving
     * navigates `#/entry/new` to `#/entry/<id>`, which changes App's key and
     * remounts the editor — and a session rule that called that "a different
     * editor" would end focus mode at the exact moment somebody pressed Save,
     * mid-sermon, which is when they are using it.
     */
    window.location.hash = '#/entry/new?kind=sermon';
    renderApp();
    await notes();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Worth keeping.' } });
    await enterFocusMode();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.listEntries()).length).toBe(1));
    const [saved] = await db.listEntries();
    await waitFor(() => expect(window.location.hash).toBe(`#/entry/${saved.id}`));

    expect(inFocusMode(), 'saving ended focus mode mid-sermon').toBe(true);
  });
});
