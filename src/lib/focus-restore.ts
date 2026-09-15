/**
 * Should a queued focus restore still happen?
 *
 * Pulled out of the component because the interesting cases are impossible to
 * stage from the outside, and because two separate races hid here.
 *
 * When a focused control disappears or goes disabled, focus falls to <body> and
 * a keyboard user restarts from the top of the page. So the component queues a
 * restore. The question this answers is whether, by the time the queue is
 * serviced, the restore is still the right thing to do — or whether the user has
 * meanwhile moved somewhere deliberately, in which case stealing focus back
 * would be worse than the drop.
 *
 * Both races come from reading `document.activeElement` mid-transition:
 *
 *   1. Focus briefly sits on the DETACHED node after unmount. Reading "not
 *      <body>" as "the user moved on" cancelled the restore.
 *   2. The effect can run BEFORE React detaches the node, so the outgoing
 *      control is still connected. Same wrong conclusion, and this one survived
 *      the first fix — it failed roughly one run in twenty.
 *
 * Hence `from`: the element focus is expected to leave. Focus sitting there is
 * not evidence of anything, whatever its connected state.
 */

export interface FocusRestoreState {
  /** document.activeElement at the moment the restore would run. */
  active: Element | null;
  /** The element focus was promised to. */
  target: Element | null;
  /**
   * The element that held focus when the restore was queued — the one about to
   * disappear or go disabled. Focus resting here means the transition simply
   * has not completed.
   */
  from?: Element | null;
  /** document.body, passed in so this stays pure. */
  body: Element | null;
}

/**
 * True when focus should be handed back to `target`.
 *
 * Restore whenever nothing meaningful holds focus: <body>, nothing at all, a
 * detached node, the target itself, or the control being left. Stand down only
 * for a real, connected element that is none of those — a place the user chose.
 */
export function shouldRestoreFocus({ active, target, from = null, body }: FocusRestoreState): boolean {
  if (!target) return false;
  if (!target.isConnected) return false;
  if (target.hasAttribute('disabled')) return false;

  if (active === null) return true;
  if (active === body) return true;
  if (active === target) return true;
  // Focus has not finished leaving the control that queued the restore.
  if (from !== null && active === from) return true;
  // A detached node is not a deliberate move; it is focus already falling.
  if (!active.isConnected) return true;

  return false;
}

/**
 * True when the queued restore should be abandoned.
 *
 * Deliberately NOT the negation of shouldRestoreFocus: there is a third state.
 * A target that is still disabled means "not yet" — keep waiting, because the
 * button is about to be re-enabled and the request is still wanted. Only a
 * user-chosen destination means "never".
 */
export function shouldAbandonRestore({ active, target, from = null, body }: FocusRestoreState): boolean {
  if (!target) return true;
  if (active === null || active === body) return false;
  if (active === target || (from !== null && active === from)) return false;
  return active.isConnected;
}
