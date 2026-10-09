/**
 * "The app went away" and "the app came back", as a capability.
 *
 * This lives in the platform layer because it is the only place allowed to
 * import Capacitor — `scripts/__tests__/native-policy.test.mjs` enforces that,
 * and it caught this module being written in `src/app/` where it did not
 * belong. App Lock needs to know about backgrounding; it does not need to know
 * that Android exists.
 *
 * The import is dynamic so that a web build never pulls the plugin into the
 * startup path for a feature it does not have.
 */

/** Something that can tell you when the app is foregrounded or backgrounded. */
export interface AppStateSource {
  /** True when protected content must wait for native listener attachment. */
  readonly requiresAsyncSetup?: boolean;
  subscribe(
    onChange: (active: boolean) => void,
    onError?: () => void,
    onReady?: () => void,
  ): () => void;
}

/**
 * The real one. A failure to attach is silent and leaves the app running:
 * on the web there is nothing to attach to, and on native a listener that
 * cannot be added must not stop somebody opening their journal.
 *
 * What it costs to fail is a re-lock that does not happen on resume — so the
 * gate treats a missing background reading as "lock", rather than trusting
 * that this always worked.
 */
export function capacitorAppState(): AppStateSource {
  return {
    requiresAsyncSetup: true,
    subscribe(onChange, onError, onReady) {
      let detach: (() => void) | null = null;
      let cancelled = false;

      void import('@capacitor/app')
        .then(async ({ App }) => {
          const handle = await App.addListener('appStateChange', ({ isActive }) => {
            onChange(isActive);
          });
          if (cancelled) void handle.remove();
          else {
            detach = () => void handle.remove();
            onReady?.();
          }
        })
        .catch(() => onError?.());

      return () => {
        cancelled = true;
        detach?.();
      };
    },
  };
}
