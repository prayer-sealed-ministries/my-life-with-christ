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

function renderApp(provider: DexieStorageProvider = db) {
  return render(
    <PlatformProvider>
      <ThemeProvider>
        <StorageContextProvider provider={provider}>
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

/** Wait for the new capture, not merely for its synchronously changed URL. */
async function fastCaptureReady() {
  await waitFor(() => expect(window.location.hash).toBe('#/entry/new?kind=sermon'));
  // The outgoing editor can keep its Notes element alive for a render after
  // location.replace updates the hash. A Notes-only wait can therefore inspect
  // the old focused prayer or saved entry. The ordinary Focus button exists
  // only after the new session has mounted and deliberately left focus mode.
  await screen.findByRole('button', { name: 'Focus' });
  await waitFor(() =>
    expect((screen.getByLabelText('Kind') as HTMLSelectElement).value).toBe('sermon'),
  );
  return notes();
}

/**
 * A storage provider whose entry reads can be held open.
 *
 * The window this file's flake lived in is the post-save reload: the editor
 * remounts under a new key and fetches the row back. How wide that window is
 * depends on a Dexie read racing worker contention, which is not something a
 * test should be at the mercy of in either direction — a narrow window hides
 * the bug, a wide one fails the assertion.
 *
 * So the width is chosen here instead of waited for, the way
 * EntryEditor.focus-race.test.tsx pins its animation frame. Holding the read
 * makes the slow case certain rather than lucky.
 */
function heldReads(inner: DexieStorageProvider) {
  let holding = false;
  let release: (() => void) | null = null;

  const proxy = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'getEntry') {
        return async (id: string) => {
          if (holding) await new Promise<void>((resolve) => (release = resolve));
          return target.getEntry(id);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as DexieStorageProvider;

  return {
    provider: proxy,
    hold: () => {
      holding = true;
    },
    /** Let the held read finish. Safe to call when nothing is held. */
    release: () => {
      holding = false;
      release?.();
      release = null;
    },
  };
}

/**
 * The save has landed AND the editor it remounted into has finished loading.
 *
 * Both halves, because either alone is a lie about where the app is.
 *
 * `window.location.hash` is written synchronously inside `location.replace`, so
 * it is already the saved address before React has been told anything. And the
 * heading says "Edit entry" while the remounted editor is still a spinner
 * fetching the row back out of storage — `EntryEditor` returns
 * `<Spinner label="Opening the entry" />` until its form exists, and that markup
 * carries no focus bar.
 *
 * That window is what this file used to read. Asserting focus mode straight
 * after the hash changed reported it as GONE while the provider had never let
 * go of it: the chrome was simply not on screen yet. It failed about once in 16
 * full-suite runs and never once in 30 runs of this file alone, because the
 * width of the window is the speed of a Dexie read under worker contention.
 *
 * The notes box is the first thing that exists only once the form is loaded, so
 * waiting for it with the saved text is waiting for the actual invariant.
 */
async function savedEditorReady(id: string, text: string) {
  await waitFor(() => expect(window.location.hash).toBe(`#/entry/${id}`));
  await waitFor(() => {
    expect(
      screen.getByRole('heading', { level: 1, name: 'Edit entry' }),
      'still on the pre-save editor',
    ).toBeInTheDocument();
    expect(
      (screen.getByLabelText('Notes', { exact: true }) as HTMLTextAreaElement).value,
      'the remounted editor has not loaded the entry yet',
    ).toBe(text);
  });
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

    await fastCaptureReady();
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

    await fastCaptureReady();
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

    await fastCaptureReady();
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

    await fastCaptureReady();
    expect(inFocusMode(), 'focus came back for a session that never asked').toBe(false);
  });

  it('G — recovering a draft does not inherit focus from the editor before it', async () => {
    /*
     * "Continue writing" on Home opens `#/entry/new?draft=<id>`, which is its
     * own editor session key — `new:::<id>` — and so must start plain however
     * the reader arrived at it.
     *
     * Worth a test of its own because the draft route is the one editor address
     * that carries an id while still being a NEW entry, which is exactly the
     * shape `isSameEditorSession` treats specially. A rule that read "was new,
     * is now identified" too loosely would hand focus straight to it.
     */
    window.location.hash = '#/entry/new?kind=prayer';
    renderApp();
    await notes();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Half a prayer.' } });
    await waitFor(async () => expect((await db.listDrafts()).length).toBe(1));
    const [draft] = await db.listDrafts();

    // Somewhere else entirely, and in focus mode there.
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });
    window.location.replace(`#/entry/${entry.id}`);
    await waitFor(() =>
      expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe(
        'The original notes.',
      ),
    );
    await enterFocusMode();

    window.location.replace(href({ name: 'newEntry', draft: draft.id }));

    // Waiting for the draft's own words, not for the address: during the load
    // the editor is a spinner with no focus bar, and asserting "not focused"
    // there would pass without testing anything.
    await waitFor(() =>
      expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe('Half a prayer.'),
    );
    expect(
      inFocusMode(),
      'the recovered draft inherited focus mode from another editor',
    ).toBe(false);
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
    await savedEditorReady(saved.id, 'Saved in focus.');
    expect(inFocusMode(), 'the save itself ended focus mode').toBe(true);

    // Now the widget, for a genuinely new sermon.
    invokeFastCapture();

    await fastCaptureReady();
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
    await savedEditorReady(saved.id, 'Worth keeping.');

    expect(inFocusMode(), 'saving ended focus mode mid-sermon').toBe(true);
  });

  it('keeps it across a save whose reload is slow, and shows it again when it lands', async () => {
    /*
     * The same promise as the test above, with the timing pinned instead of
     * hoped for — and the reason that one was intermittent.
     *
     * Saving remounts the editor, which then has to read the row back. Until it
     * has, the view is `<Spinner label="Opening the entry" />` and there is no
     * focus bar in the markup at all. Reading the chrome in that window says
     * focus mode is gone when the provider has not let go of anything, which is
     * what failed about once in 16 full-suite runs.
     *
     * Holding the read makes that window certain. Two assertions, because they
     * are different facts: the chrome is legitimately absent mid-load, and the
     * session is still owned — proven by it coming back on its own, with
     * nothing having asked for focus a second time.
     */
    const gate = heldReads(db);
    window.location.hash = '#/entry/new?kind=sermon';
    renderApp(gate.provider);
    await notes();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Held open.' } });
    await enterFocusMode();

    gate.hold();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.listEntries()).length).toBe(1));
    const [saved] = await db.listEntries();

    // Mid-flight: the entry exists, the address has moved, the editor is a
    // spinner. This is the instant the old assertion used to read.
    await waitFor(() => expect(window.location.hash).toBe(`#/entry/${saved.id}`));
    // `role="status"` rather than the words: Spinner renders `{label}…`, so the
    // text is split across nodes and an exact match never finds it.
    expect((await screen.findByRole('status')).textContent).toContain('Opening the entry');
    expect(
      inFocusMode(),
      'the focus bar cannot be on screen while the editor is still a spinner',
    ).toBe(false);

    gate.release();

    // And it returns by itself. Nothing re-entered focus mode; the session was
    // never given up.
    await savedEditorReady(saved.id, 'Held open.');
    expect(inFocusMode(), 'the slow reload lost the focus session').toBe(true);
  });
});
