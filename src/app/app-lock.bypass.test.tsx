/**
 * The ways into this app that are not the app icon.
 *
 * A widget, a launcher shortcut and a document shared from another app all
 * start the journal somewhere specific, and each is a way past a lock that was
 * bolted onto the home screen instead of built into the tree. Here they are
 * not special cases with their own handling — they are the same gate — and
 * these tests exist to keep it that way, because the obvious "fix" for a
 * shortcut that feels slow is to let it through.
 *
 * Two properties, for each route in:
 *
 *   nothing private happens while locked
 *   the thing asked for is still waiting afterwards
 *
 * The second matters as much as the first. A lock that swallowed the sermon
 * note somebody tapped the widget to write would be safe and useless.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';

import { AppLockGate, AppLockProvider } from './app-lock';
import { useAppLock } from './app-lock-context';
import { PlatformContext } from '../platform/context';
import type { AppLock } from '../platform/app-lock';
import type { AppStateSource } from '../platform/app-state';
import { webPlatform } from '../platform/web';
import type { Platform } from '../platform/ports';

const CORRECT = '135792';

/** A lifecycle source that does nothing: see the note in app-lock.gate.test.tsx. */
function inertAppState(): AppStateSource {
  return { subscribe: () => () => {} };
}

function lockThatOpensTo(pin: string, enabled: boolean): AppLock {
  return {
    supported: true,
    getState: async () => ({
      enabled,
      timeoutMs: 0,
      failures: 0,
      lastFailureAt: null,
      recoveryAvailable: true,
      now: { elapsedMs: 0, bootId: 'b' },
    }),
    now: async () => ({ elapsedMs: 0, bootId: 'b' }),
    verifyPin: async (candidate) => ({
      ok: candidate === pin,
      failures: 0,
      lastFailureAt: null,
      now: { elapsedMs: 0, bootId: 'b' },
    }),
    setPin: async () => {},
    disable: async () => {},
    setTimeout: async () => {},
    authenticateDeviceCredential: async () => true,
    setRecentsPrivacy: async () => {},
  };
}

/** Stands in for `SharedDocuments`: it asks the native side for a document. */
function DocumentCollector({ take }: { take: () => void }) {
  useEffect(() => {
    take();
  }, [take]);
  return <p>REVIEW-THE-SHARED-HANDOUT</p>;
}

let unlockFn: (pin: string) => Promise<boolean> = async () => false;

function Probe() {
  const { unlock } = useAppLock();
  // Published in an effect, not during render: assigning to module state while
  // rendering is what `react-hooks/immutability` forbids, and it is right to.
  useEffect(() => {
    unlockFn = unlock;
  }, [unlock]);
  return null;
}

function renderWithGate(lock: AppLock, children: React.ReactNode) {
  const platform: Platform = { ...webPlatform, appLock: lock };
  return render(
    <PlatformContext.Provider value={platform}>
      <AppLockProvider lock={lock} appState={inertAppState()}>
        <Probe />
        <AppLockGate lockScreen={<p>App locked</p>}>{children}</AppLockGate>
      </AppLockProvider>
    </PlatformContext.Provider>,
  );
}

beforeEach(() => {
  window.location.hash = '';
  unlockFn = async () => false;
});

afterEach(cleanup);

describe('a document shared in from another app', () => {
  it('is not collected while the app is locked, and is collected after', async () => {
    const take = vi.fn();
    renderWithGate(lockThatOpensTo(CORRECT, true), <DocumentCollector take={take} />);

    await screen.findByText('App locked');

    // The listener has not mounted, so nothing has asked the native side for
    // the document. It stays where the OS put it — app-private, untouched,
    // and revealing nothing — rather than sitting in JavaScript behind a
    // screen that claims to be locked.
    expect(take).not.toHaveBeenCalled();
    expect(screen.queryByText('REVIEW-THE-SHARED-HANDOUT')).toBeNull();

    await unlockFn(CORRECT);

    // And it was not lost: the review flow begins on the other side.
    await waitFor(() => expect(take).toHaveBeenCalledTimes(1));
    expect(screen.getByText('REVIEW-THE-SHARED-HANDOUT')).toBeInTheDocument();
  });

  it('is collected straight away when App Lock is off', async () => {
    const take = vi.fn();
    renderWithGate(lockThatOpensTo(CORRECT, false), <DocumentCollector take={take} />);

    await waitFor(() => expect(take).toHaveBeenCalledTimes(1));
  });
});

describe('a widget or launcher shortcut naming a destination', () => {
  /**
   * The launcher binding writes the destination into the hash before React
   * mounts — that is how Fast Capture already avoids showing home first. So
   * the question is whether the lock disturbs it.
   */
  it('keeps the destination through the lock, and arrives after unlocking', async () => {
    window.location.hash = '#/entry/new?kind=sermon';

    function Destination() {
      // Stands for the editor: it reads the route and shows private surface.
      return <p>NOTES-FIELD-FOR-{window.location.hash}</p>;
    }

    renderWithGate(lockThatOpensTo(CORRECT, true), <Destination />);

    await screen.findByText('App locked');
    expect(screen.queryByText(/NOTES-FIELD-FOR/)).toBeNull();

    // The lock does not consume, rewrite or forget what was asked for.
    expect(window.location.hash).toBe('#/entry/new?kind=sermon');

    await unlockFn(CORRECT);

    expect(
      await screen.findByText('NOTES-FIELD-FOR-#/entry/new?kind=sermon'),
    ).toBeInTheDocument();
  });

  it('shows the editor immediately when App Lock is off', async () => {
    window.location.hash = '#/entry/new?kind=sermon';
    renderWithGate(lockThatOpensTo(CORRECT, false), <p>NOTES-FIELD</p>);

    expect(await screen.findByText('NOTES-FIELD')).toBeInTheDocument();
  });
});

describe('going back from the lock screen', () => {
  it('cannot reach a journal page, because none is mounted', async () => {
    window.location.hash = '#/entry/abc';
    renderWithGate(lockThatOpensTo(CORRECT, true), <p>PRIVATE-ENTRY-BODY</p>);

    await screen.findByText('App locked');

    // Back, as the Android binding performs it.
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Whatever the history stack does, the tree does not contain the journal:
    // there is no rendered private route for Back to return to.
    expect(screen.queryByText('PRIVATE-ENTRY-BODY')).toBeNull();
    expect(screen.getByText('App locked')).toBeInTheDocument();
  });
});
