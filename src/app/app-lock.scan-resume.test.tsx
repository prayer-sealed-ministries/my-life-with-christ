/**
 * A photograph taken while the journal locks behind you.
 *
 * This is the whole point of the lane, driven through the real gate, the real
 * editor and the real unlock form rather than through any of their parts.
 *
 * The behaviour being pinned has two halves that pull in opposite directions,
 * and both have to hold at once:
 *
 *   App Lock is not negotiable. Opening the camera backgrounds the app, and a
 *   person who chose "Immediately" asked for the journal to be unreadable the
 *   moment that happens. Nothing here exempts the camera, and the assertions
 *   below check the journal subtree is genuinely absent rather than merely not
 *   visible.
 *
 *   The photograph is not collateral. Before this, returning from the camera
 *   destroyed it, because the scan lived inside the subtree the gate takes
 *   down. It now waits outside, and is offered back after a successful unlock.
 *
 * Recognition is the third thing, and it is deliberately not started until
 * after the unlock: there is never a transcription of anyone's notes sitting
 * behind the lock screen. The tests check that by counting how many times the
 * recogniser was asked, which is a fact about the code rather than about what
 * happened to be on screen.
 *
 * Every entry, page and line of text here is fictional.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppLockGate, AppLockProvider } from './app-lock';
import { RouterProvider } from './router';
import { StorageContextProvider } from './storage';
import EntryEditor from '../views/EntryEditor';
import LockScreen from '../views/LockScreen';
import { PlatformContext } from '../platform/context';
import type { AppStateSource } from '../platform/app-state';
import type { AppLock, AppLockState } from '../platform/app-lock';
import { webPlatform } from '../platform/web';
import type { PageScanner, Platform, Recognition, ScannedPage } from '../platform/ports';
import { forgetPendingScan, peekPendingScan } from '../scan/pending';
import { DexieStorageProvider } from '../storage/db';
import { READING } from '../export/fixtures';

const SCANNED = 'FICTIONAL-SCAN\nThe lamp unto my feet';
const TYPED = 'FICTIONAL-SCAN typed before the camera opened';
const PIN = '135792';

const page: ScannedPage = {
  handle: 'fictional-handle',
  preview: 'data:image/png;base64,iVBORw0KGgo=',
  width: 1200,
  height: 1600,
};

const recognition: Recognition = {
  text: SCANNED,
  lines: [{ text: SCANNED }],
  imageWidth: 1200,
  imageHeight: 1600,
  engine: 'fictional-engine',
  elapsedMs: 8,
};

function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** A camera that hands its result back exactly when a test says so. */
function fakeScanner() {
  const camera = deferred<ScannedPage>();
  const state = { recognised: 0, discarded: [] as string[] };
  const scanner: PageScanner = {
    supported: true,
    capture: () => camera.promise,
    choose: () => camera.promise,
    recognise: async () => {
      state.recognised += 1;
      return recognition;
    },
    async discard(scanned: ScannedPage) {
      state.discarded.push(scanned.handle);
    },
  };
  return { scanner, state, returnFromCamera: () => camera.settle(page) };
}

function fakeLock(correctPin = PIN) {
  let failures = 0;
  const now = { elapsedMs: 1_000, bootId: 'fictional-boot' };
  const state = (): AppLockState => ({
    enabled: true,
    // "Immediately": the hardest case, and the default when App Lock is first
    // switched on. Nothing here is softened to make the test easier.
    timeoutMs: 0,
    failures,
    lastFailureAt: null,
    recoveryAvailable: false,
    now,
  });
  const lock: AppLock = {
    supported: true,
    getState: async () => state(),
    now: async () => now,
    verifyPin: async (pin) => {
      const ok = pin === correctPin;
      failures = ok ? 0 : failures + 1;
      return { ok, failures, lastFailureAt: null, now };
    },
    setPin: async () => {},
    disable: async () => {},
    setTimeout: async () => {},
    authenticateDeviceCredential: async () => false,
    setRecentsPrivacy: async () => {},
  };
  return lock;
}

function fakeAppState() {
  let notify: ((active: boolean) => void) | null = null;
  const source: AppStateSource = {
    subscribe(onChange) {
      notify = onChange;
      return () => {
        notify = null;
      };
    },
  };
  return {
    source,
    background: async () => {
      await act(async () => notify?.(false));
    },
    foreground: async () => {
      await act(async () => notify?.(true));
    },
  };
}

let db: DexieStorageProvider;
let counter = 0;

beforeEach(async () => {
  db = new DexieStorageProvider(`fictional-scan-lock-${++counter}`);
  await db.open();
});

afterEach(() => {
  cleanup();
  forgetPendingScan();
});

function mount(scanner: PageScanner, appState: AppStateSource, entryId?: string) {
  const platform: Platform = { ...webPlatform, appLock: fakeLock(), scanner };
  return render(
    <PlatformContext.Provider value={platform}>
      <AppLockProvider lock={platform.appLock} appState={appState}>
        <AppLockGate lockScreen={<LockScreen />}>
          <StorageContextProvider provider={db}>
            <RouterProvider>
              <EntryEditor entryId={entryId} kindParam="sermon" />
            </RouterProvider>
          </StorageContextProvider>
        </AppLockGate>
      </AppLockProvider>
    </PlatformContext.Provider>,
  );
}

const unlock = async (pin: string) => {
  // The gate starts in `resolving` while it asks the native side for the lock
  // state, so the form is not there on the first tick.
  const field = await screen.findByLabelText('PIN');
  fireEvent.change(field, { target: { value: pin } });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
};

/** Open the editor, start a scan, and leave the camera open. */
async function startScan(scanner: PageScanner, appState: ReturnType<typeof fakeAppState>) {
  const entry = { ...READING, id: `fictional-entry-${counter}`, notes: TYPED };
  await db.putEntries([entry]);
  window.location.hash = `#/entry/${entry.id}`;
  mount(scanner, appState.source, entry.id);

  await unlock(PIN);
  await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(TYPED));
  fireEvent.click(screen.getByRole('button', { name: 'Scan notes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
  return entry;
}

describe('App Lock set to Immediately, with the camera open', () => {
  it('locks on return, keeps the page, and reads it only after the unlock', async () => {
    const { scanner, state, returnFromCamera } = fakeScanner();
    const appState = fakeAppState();
    const entry = await startScan(scanner, appState);

    // The camera is open, so the app is in the background.
    await appState.background();

    // The photograph comes back. On Android the activity result is delivered
    // before the app is resumed, which is this ordering.
    await act(async () => {
      returnFromCamera();
    });
    await appState.foreground();

    // The gate is shut. Not hidden, not covered — the editor is not there.
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(screen.queryByLabelText('Notes')).toBeNull();
    expect(screen.queryByLabelText('Transcription')).toBeNull();
    expect(document.body.textContent).not.toContain(TYPED);
    expect(document.body.textContent).not.toContain('The lamp unto my feet');

    /*
      Recognition is started only by the mounted sheet, and the sheet does not
      exist while the gate is shut — so whatever had been read before the lock
      engaged is gone with the subtree that asked for it. What is left is the
      photograph, and the record it waits in has nowhere to put a
      transcription: see `pending.test.ts`, which pins its shape.

      The strict "not read at all" case is the next test, where the result
      lands after the gate is already shut.
    */
    expect(JSON.stringify(peekPendingScan())).not.toContain('lamp');
    expect(peekPendingScan()?.page.handle).toBe('fictional-handle');

    await unlock(PIN);

    // The page is read again on the way back — the transcription is never
    // carried across the lock, only the photograph is.
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
    expect((screen.getByLabelText('Transcription') as HTMLTextAreaElement).value).toBe(SCANNED);
    expect(state.recognised).toBeGreaterThanOrEqual(1);

    // Resuming is not accepting: the entry is still exactly as it was.
    expect(screen.getByLabelText('Notes')).toHaveValue(TYPED);
    expect((await db.getEntry(entry.id))?.notes).toBe(TYPED);
  });

  it('survives the opposite ordering, where the result lands after the lock', async () => {
    /*
      The same journey with the two events swapped: the app is resumed and the
      gate shuts BEFORE the camera's promise resolves, so the continuation runs
      against a component that no longer exists. This is the ordering that
      loses the photograph if the page is held in React state, and it is why
      the record is written before anything checks whether the sheet is still
      there.
    */
    const { scanner, state, returnFromCamera } = fakeScanner();
    const appState = fakeAppState();
    await startScan(scanner, appState);

    await appState.background();
    await appState.foreground();
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();

    await act(async () => {
      returnFromCamera();
    });

    // Still locked, still unread, still held.
    expect(screen.getByLabelText('PIN')).toBeInTheDocument();
    expect(screen.queryByLabelText('Transcription')).toBeNull();
    expect(state.recognised).toBe(0);
    expect(peekPendingScan()?.page.handle).toBe('fictional-handle');

    await unlock(PIN);
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
    expect(state.recognised).toBe(1);
  });

  it('shows nothing and reads nothing when the PIN is wrong', async () => {
    const { scanner, returnFromCamera } = fakeScanner();
    const appState = fakeAppState();
    const entry = await startScan(scanner, appState);

    await appState.background();
    await act(async () => {
      returnFromCamera();
    });
    await appState.foreground();
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();

    await unlock('000000');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // A failed attempt reveals nothing and reads nothing.
    expect(screen.queryByLabelText('Transcription')).toBeNull();
    expect(screen.queryByLabelText('Notes')).toBeNull();
    expect(document.body.textContent).not.toContain(TYPED);
    expect(document.body.textContent).not.toContain('The lamp unto my feet');
    expect(JSON.stringify(peekPendingScan())).not.toContain('lamp');

    // And one wrong PIN does not throw the person's photograph away.
    expect(peekPendingScan()?.page.handle).toBe('fictional-handle');

    await unlock(PIN);
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
    expect((await db.getEntry(entry.id))?.notes).toBe(TYPED);
  });

  it('leaves nothing waiting when the camera was backed out of', async () => {
    const cancelled = deferred<ScannedPage | { reason: 'cancelled' }>();
    const state = { recognised: 0 };
    const scanner: PageScanner = {
      supported: true,
      capture: () => cancelled.promise as Promise<ScannedPage>,
      choose: () => cancelled.promise as Promise<ScannedPage>,
      recognise: async () => {
        state.recognised += 1;
        return recognition;
      },
      async discard() {},
    };
    const appState = fakeAppState();
    const entry = await startScan(scanner, appState);

    await appState.background();
    await act(async () => {
      cancelled.settle({ reason: 'cancelled' });
    });
    await appState.foreground();
    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();

    // Nothing was photographed, so there is nothing to hold and nothing to
    // offer back. A cancelled camera must not manufacture a scan session.
    expect(peekPendingScan()).toBeNull();

    await unlock(PIN);
    await waitFor(() => expect(screen.getByLabelText('Notes')).toBeTruthy());
    expect(screen.queryByLabelText('Transcription')).toBeNull();
    expect(state.recognised).toBe(0);
    expect((await db.getEntry(entry.id))?.notes).toBe(TYPED);
  });

  it('comes back to the unfinished note the page was taken for', async () => {
    /*
      The ordinary case, and the one that made this worth fixing: a new sermon
      note, a sentence typed in a pew, then a photograph of the handout.

      Two things have to come back together. The draft, because the editor at
      `#/entry/new` starts blank on a fresh mount and the person's sentence
      would otherwise be stranded in a record they would have to go and find.
      And the page, because that is what this whole mechanism is for. Bringing
      back one without the other would put the scan in a different record from
      the writing it belongs with — which is the wrong-entry failure under a
      friendlier name.
    */
    const { scanner, returnFromCamera } = fakeScanner();
    const appState = fakeAppState();
    window.location.hash = '#/entry/new?kind=sermon';
    mount(scanner, appState.source);

    await unlock(PIN);
    await waitFor(() => expect(screen.getByLabelText('Notes')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: TYPED } });
    // Force the autosave that gives this unfinished note a record of its own.
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(1));
    const [draft] = await db.listDrafts();

    fireEvent.click(screen.getByRole('button', { name: 'Scan notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await appState.background();
    await act(async () => {
      returnFromCamera();
    });
    await appState.foreground();

    expect(await screen.findByLabelText('PIN')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(TYPED);

    await unlock(PIN);

    // The sentence is back...
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(TYPED));
    // ...in the same record, not a new one beside it...
    expect(await db.listDrafts()).toHaveLength(1);
    expect((await db.listDrafts())[0].id).toBe(draft.id);
    // ...and so is the page.
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
    expect((screen.getByLabelText('Transcription') as HTMLTextAreaElement).value).toBe(SCANNED);

    // Still nothing written: the scan is on screen, and the note is untouched.
    expect(screen.getByLabelText('Notes')).toHaveValue(TYPED);
  });

  it('does not offer the page to a different entry', async () => {
    const { scanner, returnFromCamera } = fakeScanner();
    const appState = fakeAppState();
    await startScan(scanner, appState);

    await appState.background();
    await act(async () => {
      returnFromCamera();
    });
    await appState.foreground();
    await screen.findByLabelText('PIN');

    // Somewhere else entirely by the time the person unlocks.
    const other = { ...READING, id: 'fictional-other-entry', notes: 'FICTIONAL-SCAN other entry' };
    await db.putEntries([other]);
    cleanup();
    window.location.hash = `#/entry/${other.id}`;
    mount(scanner, fakeAppState().source, other.id);

    await unlock(PIN);
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(other.notes));

    // The page belongs to the entry it was photographed for. It is not
    // presented here, even though nothing could be written without somebody
    // choosing a destination and pressing Use text.
    expect(screen.queryByLabelText('Transcription')).toBeNull();
  });
});
