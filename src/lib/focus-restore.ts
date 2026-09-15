/**
 * Should a queued focus restore still happen?
 *
 * Pulled out of the component because the interesting cases are impossible to
 * stage from the outside. The bug this encodes was a CI-only failure: between a
 * control unmounting and the browser resetting focus, `document.activeElement`
 * is briefly the DETACHED element, and reading that as "the user moved on"
 * cancelled the restore and left focus on nothing.
 *
 * A test that drove the component could not reproduce it — jsdom resets
 * activeElement to <body> before the effect runs, so the assertion passed
 * against the broken code too. As a predicate the three cases are exact.
 */

export interface FocusRestoreState {
  /** document.activeElement at the moment the restore would run. */
  active: Element | null;
  /** The element focus was promised to. */
  target: Element | null;
  /** document.body, passed in so this stays pure. */
  body: Element | null;
}

/**
 * True when focus should be handed back to `target`.
 *
 * Restore when nothing meaningful holds focus — `<body>`, nothing at all, a
 * detached node, or the target itself. Stand down only for a real, connected
 * element the user actually moved to, because stealing focus from a keyboard
 * user mid-task is worse than the drop this exists to fix.
 */
export function shouldRestoreFocus({ active, target, body }: FocusRestoreState): boolean {
  if (!target) return false;
  if (!target.isConnected) return false;
  if (target instanceof Element && target.hasAttribute('disabled')) return false;

  if (active === null) return true;
  if (active === body) return true;
  if (active === target) return true;
  // A detached node is not a deliberate move; it is focus already falling.
  if (!active.isConnected) return true;

  return false;
}
