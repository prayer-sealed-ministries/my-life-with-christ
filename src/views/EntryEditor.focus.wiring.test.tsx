/**
 * Focus writing mode, through the routing the application actually uses.
 *
 * Rendering `<EntryEditor />` on its own cannot prove the thing most likely to
 * break here, and this repository has already shipped that exact mistake once:
 * saving a NEW entry navigates `#/entry/new` -> `#/entry/<id>`, App keys those
 * routes differently (`new:*` vs `entry:<id>`), and the editor is REMOUNTED. A
 * direct render never changes route, never changes key, never remounts — so a
 * focus flag kept in the editor's own state would pass every such test and
 * collapse on the first save on a phone, mid-sermon, which is the one moment
 * the mode exists for.
 *
 * So this drives the real router, the real key-per-route switch and the real
 * Shell, and asserts the remount happens rather than assuming it away.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import App from '../App';
import { FocusProvider } from '../app/focus';
import { NoticeProvider } from '../app/notice';
import { registerOverlay } from '../app/overlay';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { ThemeProvider } from '../app/theme';
import { PlatformProvider } from '../platform/provider';
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

const notesBox = () => screen.findByLabelText('Notes', { exact: true });
const focusToggle = () => screen.getByRole('button', { name: 'Focus' });
const leaveFocus = () => screen.getByRole('button', { name: 'Leave focus mode' });
const saveButton = () => screen.getByRole('button', { name: 'Save' });

/** The ordinary application chrome, as a reader would find it. */
const chrome = () => ({
  header: document.querySelector('header'),
  footer: document.querySelector('footer'),
  nav: document.querySelector('nav'),
});

async function enterFocusMode() {
  await notesBox();
  fireEvent.click(focusToggle());
  await screen.findByRole('button', { name: 'Leave focus mode' });
}

beforeEach(async () => {
  // Let anything the previous test scheduled land before this one starts: a
  // save queues its navigation on the next animation frame, and that callback
  // can outlive the unmount and rewrite the hash mid-test.
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.location.hash = '#/entry/new';
  localStorage.setItem('journey:welcomed', '1');
  db = new DexieStorageProvider(`journey-focus-wiring-${(dbCounter += 1)}`);
});

afterEach(() => {
  cleanup();
  registerOverlay(null);
  localStorage.clear();
});

describe('turning focus mode on', () => {
  it('takes the application chrome away and leaves the writing', async () => {
    renderApp();
    await notesBox();

    const before = chrome();
    expect(before.header, 'there was no header to hide in the first place').toBeTruthy();
    expect(before.footer, 'there was no footer to hide in the first place').toBeTruthy();

    fireEvent.click(focusToggle());

    await waitFor(() => {
      const after = chrome();
      expect(after.header, 'the header survived focus mode').toBeNull();
      expect(after.footer, 'the footer survived focus mode').toBeNull();
      expect(after.nav, 'the navigation survived focus mode').toBeNull();
    });

    // Not hidden with CSS — removed. A header left in the DOM stays in the tab
    // order and in the accessibility tree, which is not a writing mode.
    expect(document.body.textContent).not.toContain('Your walk, remembered.');
  });

  it('is not Notes only — reflection and prayer stay reachable', async () => {
    renderApp();
    await enterFocusMode();

    expect(screen.getByLabelText('Reflection', { exact: true })).toBeTruthy();
    // Prayer lives inside the Details panel, which is still there to open.
    fireEvent.click(screen.getByText('Details'));
    await waitFor(() => {
      expect(screen.getByLabelText('Prayer', { exact: true })).toBeTruthy();
    });
  });

  it('keeps the entry kind changeable rather than freezing it', async () => {
    renderApp();
    await enterFocusMode();

    const kind = screen.getByLabelText('Kind', { exact: true }) as HTMLSelectElement;
    expect(kind.value).toBe('sermon');
    fireEvent.change(kind, { target: { value: 'reflection' } });
    expect((screen.getByLabelText('Kind', { exact: true }) as HTMLSelectElement).value).toBe(
      'reflection',
    );
  });

  it('still has exactly one h1, for the document outline', async () => {
    renderApp();
    await enterFocusMode();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });
});

describe('saving a new entry while in focus mode', () => {
  it('changes route, remounts the editor, and stays in focus mode', async () => {
    renderApp();
    await enterFocusMode();

    fireEvent.change(await notesBox(), { target: { value: 'The first point was mercy.' } });
    expect(window.location.hash, 'did not start on the new-entry route').toBe('#/entry/new');

    fireEvent.click(saveButton());

    let saved: { id: string } | undefined;
    await waitFor(async () => {
      const entries = await db.listEntries();
      expect(entries).toHaveLength(1);
      saved = entries[0];
    });

    await waitFor(() => {
      expect(window.location.hash, 'the route did not move to the saved entry').toBe(
        `#/entry/${saved!.id}`,
      );
    });

    // The remount is asserted, not assumed: it is the architecture the defect
    // lived in, and a test that quietly stopped exercising it would stop
    // testing anything.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edit entry' }),
      'the editor did not switch to the persisted-entry view',
    ).toBeTruthy();

    // And focus mode is still on the far side of it.
    expect(chrome().header, 'saving threw the reader back out to the full app').toBeNull();
    expect(
      await screen.findByRole('button', { name: 'Leave focus mode' }),
      'the focus bar did not survive the save',
    ).toBeTruthy();

    // And the caret is back where the sermon is going. The shell moves focus to
    // the page heading after every navigation, which is right when the page has
    // visibly changed and wrong here: nothing changed, the next point is
    // already being spoken, and on a phone the keyboard would have closed.
    await waitFor(() => {
      expect(
        document.activeElement,
        'the save took the cursor out of the notes box',
      ).toBe(document.querySelector('textarea'));
    });
  }, 20_000);

  it('shows the confirmation without forcing the reader out', async () => {
    renderApp();
    await enterFocusMode();
    fireEvent.change(await notesBox(), { target: { value: 'Worth keeping.' } });
    fireEvent.click(saveButton());

    await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));
    // Wait for the navigation the save causes before judging what survived it.
    await waitFor(() => expect(window.location.hash).not.toBe('#/entry/new'));
    await screen.findByRole('heading', { level: 1, name: 'Edit entry' });

    await waitFor(() => {
      const live = screen.getByText('Saved').closest('[aria-live]');
      expect(live, 'the confirmation is not inside a live region').toBeTruthy();
      expect(live!.getAttribute('aria-live')).toBe('polite');
    });
    expect(chrome().header, 'the confirmation came with the chrome back').toBeNull();
  }, 20_000);
});

describe('turning focus mode off', () => {
  it('brings the chrome back and hands focus to the control that returns', async () => {
    renderApp();
    await enterFocusMode();

    fireEvent.click(leaveFocus());

    await waitFor(() => {
      expect(chrome().header, 'the header did not come back').toBeTruthy();
    });
    await waitFor(() => {
      expect(
        document.activeElement,
        'focus was dropped on <body> when the focus bar unmounted',
      ).toBe(focusToggle());
    });
  });

  it('ends when the reader leaves the editor, and does not resume later', async () => {
    renderApp();
    await enterFocusMode();

    fireEvent.click(screen.getByRole('link', { name: 'Cancel' }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/timeline');
    });
    // A chrome-less timeline would be a page with no header, no navigation and
    // no way back out of it.
    await waitFor(() => {
      expect(chrome().header, 'the timeline rendered with no chrome at all').toBeTruthy();
    });

    // And coming back to the editor is the ordinary editor, not a mode nobody
    // asked for a second time.
    window.location.hash = '#/entry/new';
    await notesBox();
    expect(chrome().header, 'focus mode resumed by itself on the next entry').toBeTruthy();
    expect(focusToggle(), 'the way into focus mode did not come back').toBeTruthy();
  }, 20_000);
});
