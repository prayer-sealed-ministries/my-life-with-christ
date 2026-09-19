/**
 * Android's system Back leaves focus mode before it leaves the entry.
 *
 * Nothing in the editor knows it is on Android, and proving that is half the
 * point of this file. `decideBack` already ranks "something is on top —
 * dismiss it" above navigating; `src/app/overlay.ts` is how a view declares
 * itself to be that something. So the wiring under test is: focus mode
 * registers with the overlay registry, the registry is what the native binding
 * consults, and dismissing it leaves the reader in the editor rather than back
 * on the timeline with a half-written sermon behind them.
 *
 * The registry holds ONE entry, which is only sound because the app menu — its
 * other claimant — lives in the header, and focus mode does not render the
 * header. That is an invariant, not a coincidence, so it is asserted here
 * rather than trusted to a comment.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import App from '../App';
import { FocusProvider } from '../app/focus';
import { NoticeProvider } from '../app/notice';
import { closeOverlay, overlayOpen, registerOverlay } from '../app/overlay';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { ThemeProvider } from '../app/theme';
import { decideBack } from '../platform/back';
import { PlatformProvider } from '../platform/provider';
import { DexieStorageProvider } from '../storage/db';

let dbCounter = 0;
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

const notesBox = () => screen.findByLabelText('Notes', { exact: true });

async function enterFocusMode() {
  await notesBox();
  fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
  await screen.findByRole('button', { name: 'Leave focus mode' });
}

beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  registerOverlay(null);
  window.location.hash = '#/entry/new';
  localStorage.setItem('journey:welcomed', '1');
  db = new DexieStorageProvider(`journey-focus-back-${(dbCounter += 1)}`);
});

afterEach(() => {
  cleanup();
  registerOverlay(null);
  localStorage.clear();
});

describe('what Back finds while focus mode is on', () => {
  it('registers focus mode as the thing on top, and stands down when it ends', async () => {
    renderApp();
    await notesBox();
    expect(overlayOpen(), 'something was registered before focus mode started').toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    await waitFor(() => {
      expect(overlayOpen(), 'focus mode did not register as the overlay').toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Leave focus mode' }));
    await waitFor(() => {
      expect(overlayOpen(), 'focus mode stayed registered after it ended').toBe(false);
    });
  });

  it('sends Back to the decision that dismisses rather than navigates', async () => {
    renderApp();
    await enterFocusMode();

    // The pure decision, given the state the registry now reports. This is the
    // whole of the Android-specific reasoning, and it lives in the platform
    // layer where a view cannot see it.
    expect(
      decideBack({ overlayOpen: overlayOpen(), canGoBack: true, hasUnsavedWork: false }),
      'Back would have navigated away from a reader who was writing',
    ).toBe('close-overlay');
  });

  it('leaves focus mode and stays on the entry', async () => {
    renderApp();
    await enterFocusMode();
    const hash = window.location.hash;

    // Exactly what `browserHistoryHost` calls for 'close-overlay'.
    expect(closeOverlay(), 'the registry reported nothing to dismiss').toBe(true);

    await waitFor(() => {
      expect(document.querySelector('header'), 'the chrome did not come back').toBeTruthy();
    });
    expect(window.location.hash, 'Back navigated as well as leaving focus mode').toBe(hash);
    // And it hands focus back, exactly as the on-screen control does.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Focus' }));
    });
  });

  it('cannot be contested: the other claimant is in the header focus mode removes', async () => {
    renderApp();
    await notesBox();
    expect(
      screen.getByRole('button', { name: 'Menu' }),
      'the app menu was not there to begin with, so this proves nothing',
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Menu' }),
        'the app menu can be opened in focus mode, so two things can claim one registry slot',
      ).toBeNull();
    });
  });
});
