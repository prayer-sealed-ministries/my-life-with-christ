/**
 * The gate the journal sits behind.
 *
 * THE SHAPE IS THE SECURITY
 *
 * The children of `AppLockGate` are not rendered — not mounted, not hidden,
 * not covered — until the lock has been resolved and satisfied. Everything
 * §10 of the brief asks for follows from that one decision rather than from
 * care taken afterwards:
 *
 *  - No private route renders for a frame and is hidden later, because the
 *    subtree does not exist yet.
 *  - Back from the lock screen cannot reveal a journal page, because there is
 *    no journal page mounted to go back to.
 *  - A rotation while locked remounts into the same locked state, because the
 *    unlocked flag is React state in a process that either has it or does not.
 *  - Process death loses it, which is the point. Nothing writes
 *    `unlocked = true` anywhere it could survive.
 *
 * The alternative — render the app and overlay a lock — is the arrangement
 * where every one of those becomes a separate thing to get right, and where a
 * translucent card or a missed effect leaks the thing being protected.
 *
 * WHAT IS QUEUED, AND HOW
 *
 * Nothing here queues a Fast Capture destination or a shared document, and
 * that is deliberate. The launcher binding has already written the destination
 * into the URL hash before React mounted, and the document the system shared
 * is held by the native side until somebody asks for it. Both simply wait:
 * the router reads the hash when the app finally renders, and
 * `SharedDocuments` does not mount — and so does not ask — until unlocked.
 * A queue of our own would be a second copy of state that could disagree with
 * those, and a place for a document to sit in JavaScript while the screen says
 * it is locked.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  normaliseTimeout,
  remainingPenaltyMs,
  shouldLockOnResume,
  type Monotonic,
} from './lock-policy';
import {
  AppLockContext,
  useAppLock,
  type AppLockContextValue,
  type LockPhase,
} from './app-lock-context';
import type { AppLock } from '../platform/app-lock';
import { usePlatform } from '../platform/context';
import { capacitorAppState, type AppStateSource } from '../platform/app-state';

export interface AppLockProviderProps {
  children: ReactNode;
  /** Injected in tests; defaults to the platform's own. */
  lock?: AppLock;
  appState?: AppStateSource;
}

export function AppLockProvider({ children, lock, appState }: AppLockProviderProps) {
  const platform = usePlatform();
  const appLock = lock ?? platform.appLock;
  const source = useMemo(() => appState ?? capacitorAppState(), [appState]);

  const [phase, setPhase] = useState<LockPhase>('resolving');
  const [enabled, setEnabled] = useState(false);
  const [timeoutMs, setTimeoutMs] = useState(0);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [failures, setFailures] = useState(0);
  const [penaltyMs, setPenaltyMs] = useState(0);

  /**
   * When the app last went away, on the monotonic clock.
   *
   * A ref rather than state: nothing renders differently because of it, and a
   * re-render between backgrounding and resuming must not lose it.
   */
  const backgroundedAt = useRef<Monotonic | null>(null);
  const lastFailureAt = useRef<Monotonic | null>(null);
  const timeoutRef = useRef(0);
  const enabledRef = useRef(false);

  const applyState = useCallback(
    (state: Awaited<ReturnType<AppLock['getState']>>, nextPhase?: LockPhase) => {
      const normalised = normaliseTimeout(state.timeoutMs);
      setEnabled(state.enabled);
      setTimeoutMs(normalised);
      setRecoveryAvailable(state.recoveryAvailable);
      setFailures(state.failures);
      lastFailureAt.current = state.lastFailureAt;
      timeoutRef.current = normalised;
      enabledRef.current = state.enabled;
      setPenaltyMs(
        remainingPenaltyMs({
          failures: state.failures,
          lastFailureAt: state.lastFailureAt,
          now: state.now,
        }),
      );
      if (nextPhase) setPhase(nextPhase);
    },
    [],
  );

  const refresh = useCallback(async () => {
    const state = await appLock.getState();
    applyState(state);
  }, [appLock, applyState]);

  // The first question this process asks. Until it answers, nothing renders.
  useEffect(() => {
    let cancelled = false;

    void appLock
      .getState()
      .then((state) => {
        if (cancelled) return;
        applyState(state, state.enabled ? 'locked' : 'unlocked');
        // Keep the app switcher in step with whether the lock is on at all.
        void appLock.setRecentsPrivacy(state.enabled).catch(() => undefined);
      })
      .catch(() => {
        // A platform that cannot answer is one without App Lock. Failing
        // open here is correct precisely because failing closed would brick
        // an edition that never had the feature; the native side is the only
        // thing that can say a lock exists, and it just said nothing does.
        if (!cancelled) applyState(
          {
            enabled: false,
            timeoutMs: 0,
            failures: 0,
            lastFailureAt: null,
            recoveryAvailable: false,
            now: { elapsedMs: 0, bootId: '' },
          },
          'unlocked',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [appLock, applyState]);

  // Going away and coming back. The only thing that ever re-locks a running
  // app: there is no timer that can fire while somebody is writing.
  useEffect(() => {
    return source.subscribe((active) => {
      if (!enabledRef.current) return;

      if (!active) {
        void appLock
          .now()
          .then((reading) => {
            backgroundedAt.current = reading;
          })
          .catch(() => {
            // No reading means no basis to stay unlocked.
            backgroundedAt.current = null;
          });
        return;
      }

      void appLock
        .now()
        .then((now) => {
          if (
            shouldLockOnResume({
              backgroundedAt: backgroundedAt.current,
              now,
              timeoutMs: timeoutRef.current,
            })
          ) {
            setPhase('locked');
          }
          backgroundedAt.current = null;
        })
        .catch(() => setPhase('locked'));
    });
  }, [appLock, source]);

  /**
   * Let a penalty expire on its own.
   *
   * Found on a device: without this, tripping the rate limit disabled the PIN
   * field and the button and then nothing ever re-enabled them, because the
   * remaining time was only recomputed when somebody made an attempt — which
   * they could no longer make. The wait was five seconds and the lockout was
   * until the app was restarted, which is exactly the unbounded punishment the
   * bounded schedule exists to avoid.
   *
   * One timer for the whole wait, not a tick: there is no countdown to read
   * out, and a screen reader should not be told the number every second.
   */
  useEffect(() => {
    if (penaltyMs <= 0) return;
    const timer = setTimeout(() => {
      void refresh();
    }, penaltyMs + 250);
    return () => clearTimeout(timer);
  }, [penaltyMs, refresh]);

  const unlock = useCallback(
    async (pin: string) => {
      const result = await appLock.verifyPin(pin);
      setFailures(result.failures);
      lastFailureAt.current = result.lastFailureAt;
      setPenaltyMs(
        remainingPenaltyMs({
          failures: result.failures,
          lastFailureAt: result.lastFailureAt,
          now: result.now,
        }),
      );
      if (result.ok) {
        backgroundedAt.current = null;
        setPhase('unlocked');
      }
      return result.ok;
    },
    [appLock],
  );

  const lockNow = useCallback(() => setPhase('locked'), []);

  const value = useMemo<AppLockContextValue>(
    () => ({
      phase,
      supported: appLock.supported,
      enabled,
      timeoutMs,
      recoveryAvailable,
      penaltyMs,
      failures,
      unlock,
      refresh,
      lockNow,
    }),
    [
      phase,
      appLock.supported,
      enabled,
      timeoutMs,
      recoveryAvailable,
      penaltyMs,
      failures,
      unlock,
      refresh,
      lockNow,
    ],
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export interface AppLockGateProps {
  children: ReactNode;
  /** What to show while locked. Injected so this module imports no view. */
  lockScreen: ReactNode;
}

/**
 * Renders the journal, or does not.
 *
 * There is no third branch that renders both.
 */
export function AppLockGate({ children, lockScreen }: AppLockGateProps) {
  const { phase } = useAppLock();

  if (phase === 'unlocked') return <>{children}</>;
  if (phase === 'locked') return <>{lockScreen}</>;

  // Resolving. Opaque, and carrying nothing: this is on the startup path of
  // every launch, including the ones where App Lock is off, so it holds a
  // background colour and no text to translate, measure or read out.
  return <div data-testid="app-lock-resolving" className="min-h-dvh bg-app" aria-hidden="true" />;
}
