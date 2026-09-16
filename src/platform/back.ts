/**
 * What a back gesture should do.
 *
 * Android has a hardware/gesture back that the web does not, and Phase 1 will
 * bind it. What belongs here now is not the binding — it is the *decision*,
 * extracted as a pure function so it can be tested without an emulator and so
 * the native shell has something to call rather than something to reinvent.
 *
 * THE RULE, which the binding must honour:
 *
 *   Back follows the application's own navigation first. It may only exit the
 *   app when there is nothing left to go back to, and it must never discard
 *   unsaved work without asking.
 *
 * The middle clause is the one that goes wrong in webview apps: back is wired
 * straight to `exitApp()` or straight to `history.back()`, and a person editing
 * an entry loses it to a gesture they make fifty times a day.
 *
 * Note what is NOT modelled here. The router is hash-based
 * (`src/app/router.tsx`), so the browser keeps the history stack and there is no
 * separate stack to maintain. This function decides between three outcomes; the
 * caller performs them.
 */

export type BackOutcome =
  /** Go back one step in application history. */
  | 'navigate-back'
  /** Ask before leaving; there is work that would be lost. */
  | 'confirm-discard'
  /** Nothing left to go back to — the platform may close the app. */
  | 'exit';

export interface BackContext {
  /**
   * Is there an in-app destination behind this one?
   *
   * For the hash router this is "history has a previous entry we own". The
   * shell supplies it; this function does not reach for `window`.
   */
  canGoBack: boolean;
  /** Is there edited-but-unsaved work on screen right now? */
  hasUnsavedWork: boolean;
}

/**
 * Decide what a back gesture means.
 *
 * Unsaved work wins over everything, including exit: a person pressing back at
 * the root of the app with a half-written entry should be asked, not obeyed.
 * That ordering is the whole reason this is a function rather than two lines at
 * the call site.
 */
export function decideBack({ canGoBack, hasUnsavedWork }: BackContext): BackOutcome {
  if (hasUnsavedWork) return 'confirm-discard';
  return canGoBack ? 'navigate-back' : 'exit';
}
