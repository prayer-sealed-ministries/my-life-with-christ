/**
 * What the gate does and does not let through.
 *
 * The central claim is not "a lock screen appears". It is that the journal
 * subtree is never constructed while the app is locked — so `MOUNTS` below is
 * the instrument that matters. A test asserting "the entry title is not
 * visible" would pass just as happily against an app that rendered the journal
 * and hid it with CSS, which is the arrangement §10 exists to forbid.
 */

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';

import { AppLockGate, AppLockProvider } from './app-lock';
import { useAppLock } from './app-lock-context';
import { PlatformContext } from '../platform/context';
import type { AppStateSource } from '../platform/app-state';
import type { AppLock, AppLockState } from '../platform/app-lock';
import { webPlatform } from '../platform/web';
import type { Platform } from '../platform/ports';

const PRIVATE_TEXT = 'PRIVATE-JOURNAL-CONTENT';

/**
 * Let React run whatever it still owes, then read the counter.
 *
 * `MOUNTS` is incremented in a passive effect, and a passive effect runs AFTER
 * the commit that put the node in the document — measured here, not assumed: a
 * MutationObserver watching for the journal's text sees `MOUNTS === 0` at the
 * instant the node appears, every single time, and 1 only once the effects have
 * been flushed.
 *
 * That matters in both directions. Asserting the counter is 1 straight after a
 * DOM wait is reading it in that gap and relying on Testing Library's act
 * wrapper to have closed it first — which is what failed once under a machine
 * at load 50. And asserting it is 0 while locked is weaker than it looks: a
 * subtree that HAD been constructed would also read 0 until its effect ran, so
 * the privacy claim would pass for the wrong reason.
 *
 * Flushing first makes a zero mean "never constructed" rather than "not yet
 * accounted for". It is not a delay: `act` returns as soon as React has no
 * outstanding work, and adds nothing when there was none.
 */
async function settledMounts(): Promise<number> {
  await act(async () => {});
  return MOUNTS;
}

/** How many times the journal subtree has been constructed, ever. */
let MOUNTS = 0;

function PrivateJournal() {
  useEffect(() => {
    MOUNTS += 1;
  }, []);
  return <p>{PRIVATE_TEXT}</p>;
}

function LockScreenStub() {
  return <p>App locked</p>;
}

/** A controllable stand-in for the native side. */
function fakeLock(options: {
  enabled?: boolean;
  timeoutMs?: number;
  correctPin?: string;
  failures?: number;
} = {}) {
  let elapsedMs = 1_000;
  let bootId = 'boot-1';
  let failures = options.failures ?? 0;

  const state = (): AppLockState => ({
    enabled: options.enabled ?? false,
    timeoutMs: options.timeoutMs ?? 0,
    failures,
    lastFailureAt: null,
    recoveryAvailable: true,
    now: { elapsedMs, bootId },
  });

  const lock: AppLock = {
    supported: true,
    getState: async () => state(),
    now: async () => ({ elapsedMs, bootId }),
    verifyPin: async (pin) => {
      const ok = pin === (options.correctPin ?? '135792');
      failures = ok ? 0 : failures + 1;
      return { ok, failures, lastFailureAt: null, now: { elapsedMs, bootId } };
    },
    setPin: async () => {},
    disable: async () => {},
    setTimeout: async () => {},
    authenticateDeviceCredential: async () => true,
    setRecentsPrivacy: async () => {},
  };

  return {
    lock,
    advance(ms: number) {
      elapsedMs += ms;
    },
    reboot() {
      bootId = 'boot-2';
      elapsedMs = 0;
    },
  };
}

/**
 * A lifecycle source that does nothing, for the tests that are not about
 * lifecycle.
 *
 * Without it `AppLockProvider` falls back to `capacitorAppState()`, which
 * dynamically imports `@capacitor/app`. That import resolves in a promise
 * continuation that can land after the test has finished, and the web plugin's
 * constructor attaches a `visibilitychange` listener to `document` on a module
 * singleton that is never torn down — so one test's fallback outlives it and is
 * still there for the next.
 *
 * Nothing in this file wants that. The tests that DO exercise background and
 * resume inject `fakeAppState()` and drive it deliberately; the rest should
 * begin from a known state rather than from whatever the previous test left
 * attached.
 */
function inertAppState(): AppStateSource {
  return { subscribe: () => () => {} };
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
    background: () => notify?.(false),
    foreground: () => notify?.(true),
  };
}

function renderGate(lock: AppLock, appState: AppStateSource = inertAppState()) {
  const platform: Platform = { ...webPlatform, appLock: lock };
  return render(
    <PlatformContext.Provider value={platform}>
      <AppLockProvider lock={lock} appState={appState}>
        <AppLockGate lockScreen={<LockScreenStub />}>
          <PrivateJournal />
        </AppLockGate>
      </AppLockProvider>
    </PlatformContext.Provider>,
  );
}

beforeEach(() => {
  MOUNTS = 0;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(cleanup);

describe('when App Lock is off', () => {
  it('shows the journal, and is the default', async () => {
    const { lock } = fakeLock({ enabled: false });
    renderGate(lock);

    expect(await screen.findByText(PRIVATE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText('App locked')).toBeNull();
  });
});

describe('when App Lock is on', () => {
  it('keeps the private tree unmounted when a supported lock cannot read its state', async () => {
    const lock: AppLock = {
      ...fakeLock({ enabled: true }).lock,
      getState: async () => {
        throw new Error('native state unavailable');
      },
    };

    renderGate(lock);

    expect(await screen.findByText('App locked')).toBeInTheDocument();
    expect(screen.queryByText(PRIVATE_TEXT)).toBeNull();
    expect(await settledMounts()).toBe(0);
  });

  it('never constructs the journal before it is unlocked', async () => {
    const { lock } = fakeLock({ enabled: true });
    renderGate(lock);

    expect(await screen.findByText('App locked')).toBeInTheDocument();

    // The instrument that matters: not "is it visible", but "did it ever
    // exist". A rendered-then-hidden journal would fail here and pass a
    // visibility check.
    expect(await settledMounts()).toBe(0);
    expect(screen.queryByText(PRIVATE_TEXT)).toBeNull();
    expect(document.body.textContent).not.toContain(PRIVATE_TEXT);
  });

  it('shows nothing at all while the answer is still being fetched', async () => {
    // A deliberately slow native side. Before the answer arrives the app must
    // not guess, in either direction.
    let release: (value: AppLockState) => void = () => {};
    const pending = new Promise<AppLockState>((resolve) => {
      release = resolve;
    });
    const lock: AppLock = {
      ...fakeLock({ enabled: true }).lock,
      getState: () => pending,
    };

    renderGate(lock);

    expect(screen.queryByText(PRIVATE_TEXT)).toBeNull();
    expect(screen.queryByText('App locked')).toBeNull();
    expect(await settledMounts()).toBe(0);

    release({
      enabled: true,
      timeoutMs: 0,
      failures: 0,
      lastFailureAt: null,
      recoveryAvailable: false,
      now: { elapsedMs: 0, bootId: 'b' },
    });
    expect(await screen.findByText('App locked')).toBeInTheDocument();
    expect(await settledMounts()).toBe(0);
  });

  it('opens on the right PIN and not on a wrong one', async () => {
    const { lock } = fakeLock({ enabled: true, correctPin: '135792' });
    const seen: { unlock: (pin: string) => Promise<boolean> } = { unlock: async () => false };

    function Probe() {
      const { unlock } = useAppLock();
      useEffect(() => {
        seen.unlock = unlock;
      }, [unlock]);
      return null;
    }

    const platform: Platform = { ...webPlatform, appLock: lock };
    render(
      <PlatformContext.Provider value={platform}>
        <AppLockProvider lock={lock} appState={inertAppState()}>
          <Probe />
          <AppLockGate lockScreen={<LockScreenStub />}>
            <PrivateJournal />
          </AppLockGate>
        </AppLockProvider>
      </PlatformContext.Provider>,
    );

    await screen.findByText('App locked');

    await expect(seen.unlock('000000')).resolves.toBe(false);
    expect(await settledMounts()).toBe(0);
    expect(screen.queryByText(PRIVATE_TEXT)).toBeNull();

    await expect(seen.unlock('135792')).resolves.toBe(true);
    expect(await screen.findByText(PRIVATE_TEXT)).toBeInTheDocument();
    // Waited for, not assumed. `findByText` resolves from inside the
    // MutationObserver callback that fires when the node is inserted, and the
    // effect that counts the mount has not run at that point — so this used to
    // depend on the act wrapper flushing in between. Exactly one, still: a
    // second mount would mean duplicate lifecycle ownership, which is the thing
    // this number is here to catch.
    await waitFor(async () => expect(await settledMounts()).toBe(1));
  });

  it('writes no unlocked flag anywhere that could outlive the process', async () => {
    const { lock } = fakeLock({ enabled: true });
    const seen: { unlock: (pin: string) => Promise<boolean> } = { unlock: async () => false };

    function Probe() {
      const { unlock } = useAppLock();
      useEffect(() => {
        seen.unlock = unlock;
      }, [unlock]);
      return null;
    }

    const platform: Platform = { ...webPlatform, appLock: lock };
    render(
      <PlatformContext.Provider value={platform}>
        <AppLockProvider lock={lock} appState={inertAppState()}>
          <Probe />
          <AppLockGate lockScreen={<LockScreenStub />}>
            <PrivateJournal />
          </AppLockGate>
        </AppLockProvider>
      </PlatformContext.Provider>,
    );

    await screen.findByText('App locked');
    await seen.unlock('135792');
    await screen.findByText(PRIVATE_TEXT);

    // Nothing persisted. This is what makes process death a lock.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('starts locked again on a fresh mount, which is what process death is', async () => {
    const { lock } = fakeLock({ enabled: true });

    const first = renderGate(lock);
    await screen.findByText('App locked');
    first.unmount();

    // A new process. Nothing carried over, and nothing looked up.
    renderGate(lock);
    expect(await screen.findByText('App locked')).toBeInTheDocument();
    expect(await settledMounts()).toBe(0);
  });
});

describe('leaving the app and coming back', () => {
  const unlockedGate = async (timeoutMs: number) => {
    const controls = fakeLock({ enabled: true, timeoutMs, correctPin: '135792' });
    const appState = fakeAppState();
    const seen: { unlock: (pin: string) => Promise<boolean> } = { unlock: async () => false };

    function Probe() {
      const { unlock } = useAppLock();
      useEffect(() => {
        seen.unlock = unlock;
      }, [unlock]);
      return null;
    }

    const platform: Platform = { ...webPlatform, appLock: controls.lock };
    render(
      <PlatformContext.Provider value={platform}>
        <AppLockProvider lock={controls.lock} appState={appState.source}>
          <Probe />
          <AppLockGate lockScreen={<LockScreenStub />}>
            <PrivateJournal />
          </AppLockGate>
        </AppLockProvider>
      </PlatformContext.Provider>,
    );

    await screen.findByText('App locked');
    await seen.unlock('135792');
    await screen.findByText(PRIVATE_TEXT);
    return { ...controls, ...appState };
  };

  it('locks immediately when that is the choice', async () => {
    const app = await unlockedGate(0);

    app.background();
    app.advance(1);
    app.foreground();

    expect(await screen.findByText('App locked')).toBeInTheDocument();
    expect(screen.queryByText(PRIVATE_TEXT)).toBeNull();
  });

  it('stays open inside the grace period', async () => {
    const app = await unlockedGate(60_000);

    app.background();
    app.advance(30_000);
    app.foreground();

    // Nothing should change. Waiting for an absence needs a beat to be
    // meaningful, so let the promise chain settle first.
    await waitFor(() => expect(screen.getByText(PRIVATE_TEXT)).toBeInTheDocument());
    expect(screen.queryByText('App locked')).toBeNull();
  });

  it('locks once the grace period is past', async () => {
    const app = await unlockedGate(60_000);

    app.background();
    app.advance(60_001);
    app.foreground();

    expect(await screen.findByText('App locked')).toBeInTheDocument();
  });

  it('locks when the device rebooted while it was away', async () => {
    const app = await unlockedGate(900_000);

    app.background();
    app.reboot();
    app.foreground();

    expect(await screen.findByText('App locked')).toBeInTheDocument();
  });

  it('does not lock a running app that never went away', async () => {
    const app = await unlockedGate(0);

    app.advance(3_600_000);

    // No timer re-locks somebody mid-sentence. Only backgrounding does.
    await waitFor(() => expect(screen.getByText(PRIVATE_TEXT)).toBeInTheDocument());
  });
});

describe('when the platform has no App Lock at all', () => {
  it('starts the app rather than refusing to open', async () => {
    const lock: AppLock = {
      ...fakeLock().lock,
      supported: false,
      getState: async () => {
        throw new Error('no such plugin');
      },
    };

    renderGate(lock);

    // Failing closed here would brick every edition that never had the
    // feature. The native side is the only thing that can assert a lock
    // exists, and it just failed to assert anything.
    expect(await screen.findByText(PRIVATE_TEXT)).toBeInTheDocument();
  });
});

describe('when the lifecycle listener cannot be attached', () => {
  it('does not brick an app whose native state definitively says the lock is off', async () => {
    let release: (value: AppLockState) => void = () => {};
    const pending = new Promise<AppLockState>((resolve) => {
      release = resolve;
    });
    const lock: AppLock = {
      ...fakeLock({ enabled: false }).lock,
      getState: () => pending,
    };
    const failedLifecycle: AppStateSource = {
      subscribe(_onChange, onError) {
        onError?.(new Error('listener unavailable'));
        return () => {};
      },
    };

    renderGate(lock, failedLifecycle);
    release({
      enabled: false,
      timeoutMs: 0,
      failures: 0,
      lastFailureAt: null,
      recoveryAvailable: false,
      now: { elapsedMs: 0, bootId: 'b' },
    });

    expect(await screen.findByText(PRIVATE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText('App locked')).toBeNull();
  });
});

describe('the recents privacy request', () => {
  it('is made to match whether the lock is on', async () => {
    const onRecents = vi.fn(async () => {});
    const { lock } = fakeLock({ enabled: true });
    renderGate({ ...lock, setRecentsPrivacy: onRecents });

    await screen.findByText('App locked');
    await waitFor(() => expect(onRecents).toHaveBeenCalledWith(true));
  });

  it('is not made when the lock is off', async () => {
    const onRecents = vi.fn(async () => {});
    const { lock } = fakeLock({ enabled: false });
    renderGate({ ...lock, setRecentsPrivacy: onRecents });

    await screen.findByText(PRIVATE_TEXT);
    expect(onRecents).toHaveBeenCalledWith(false);
  });
});

describe('the attempt penalty', () => {
  it('expires on its own, without the app being restarted', async () => {
    // Found on a device: the field and the button were disabled while a
    // penalty stood, and nothing ever recomputed it, because the only thing
    // that recomputed it was making an attempt. A five-second wait became a
    // lockout until the app was killed.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let elapsedMs = 1_000;
      const lock: AppLock = {
        ...fakeLock({ enabled: true }).lock,
        getState: async () => ({
          enabled: true,
          timeoutMs: 0,
          failures: 5,
          lastFailureAt: { elapsedMs: 0, bootId: 'boot-1' },
          recoveryAvailable: false,
          now: { elapsedMs, bootId: 'boot-1' },
        }),
      };

      const seen: { penaltyMs: number } = { penaltyMs: -1 };
      function Probe() {
        const { penaltyMs } = useAppLock();
        useEffect(() => {
          seen.penaltyMs = penaltyMs;
        }, [penaltyMs]);
        return null;
      }

      const platform: Platform = { ...webPlatform, appLock: lock };
      render(
        <PlatformContext.Provider value={platform}>
          <AppLockProvider lock={lock} appState={inertAppState()}>
            <Probe />
            <AppLockGate lockScreen={<LockScreenStub />}>
              <PrivateJournal />
            </AppLockGate>
          </AppLockProvider>
        </PlatformContext.Provider>,
      );

      await screen.findByText('App locked');
      await waitFor(() => expect(seen.penaltyMs).toBe(4_000));

      // Time passes on the device's clock, and the app is left alone.
      elapsedMs = 9_000;
      await vi.advanceTimersByTimeAsync(4_500);

      await waitFor(() => expect(seen.penaltyMs).toBe(0));
    } finally {
      vi.useRealTimers();
    }
  });
});
