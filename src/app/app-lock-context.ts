/**
 * The App Lock context and its hook, apart from the components.
 *
 * Split out for the same reason `notice-context.ts` is: a module that exports
 * both a component and a hook cannot be hot-reloaded cleanly, and the lint rule
 * that says so is right. The types live here too, so a view can describe what
 * it needs without importing the provider.
 */

import { createContext, useContext } from 'react';

/**
 * `resolving` is a real state, not a loading spinner.
 *
 * Until the native side has answered, this process does not know whether the
 * journal may be shown. Rendering it meanwhile and correcting afterwards is
 * exactly the flash that must not happen.
 */
export type LockPhase = 'resolving' | 'locked' | 'unlocked';

export interface AppLockContextValue {
  phase: LockPhase;
  supported: boolean;
  enabled: boolean;
  timeoutMs: number;
  recoveryAvailable: boolean;
  /** Milliseconds before another attempt is accepted; 0 when none is owed. */
  penaltyMs: number;
  failures: number;

  unlock(pin: string): Promise<boolean>;
  refresh(): Promise<void>;
  /** Re-lock immediately — used after disabling, and by tests. */
  lockNow(): void;
}

export const AppLockContext = createContext<AppLockContextValue | null>(null);

export function useAppLock(): AppLockContextValue {
  const value = useContext(AppLockContext);
  if (!value) throw new Error('useAppLock outside AppLockProvider');
  return value;
}

/**
 * The same, for a component that may legitimately render without the provider.
 *
 * Settings is the case: it is mounted directly in tests, and on an edition
 * with no App Lock there is nothing above it to provide one. Throwing there
 * would make an unrelated screen depend on a feature it only optionally shows.
 */
export function useAppLockOptional(): AppLockContextValue | null {
  return useContext(AppLockContext);
}
