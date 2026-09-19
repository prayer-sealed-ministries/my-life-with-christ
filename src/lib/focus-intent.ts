/**
 * Where the reader asked focus to go, and whether that request is still live.
 *
 * The editor has two kinds of focus claim and they are not equal.
 *
 * The DEFAULT claim is "the cursor belongs in the notes box when this opens".
 * It is deferred a frame so it lands after the shell's own post-navigation
 * focus, and `shouldRestoreFocus` decides whether it may still act.
 *
 * An INTENT is different: the reader pressed something, and the control they
 * should land on does not exist yet — "Add a link" renders the row it hands
 * focus to, "Keep this entry" brings back the delete button it stood in for.
 * The destination arrives on a later render.
 *
 * The bug this exists to end: the old code ran the intent on *whatever render
 * came next* and then threw it away, honoured or not. Usually the next render
 * is the one carrying the new row, so it worked. When any other commit landed
 * first — measured in a full-suite run, where a re-run of the fast-capture
 * effect committed in between — the intent was spent against a DOM that did
 * not contain its target yet. `querySelector` returned null, `focus()` never
 * ran, and the request was silently dropped. Focus stayed on <body>, and the
 * still-pending default claim then did precisely what it is meant to do with
 * an empty focus: it took the caret to the notes box. The reader pressed "Add
 * a link" and the cursor jumped to Notes instead.
 *
 * So an intent is not consumed until it is either honoured or superseded. This
 * answers which of those has happened, as a pure function, because the states
 * are exact and the interleaving that produced them is not reproducible on
 * demand.
 */

export interface FocusIntentState {
  /** The destination, resolved against the DOM as it is right now. */
  target: Element | null | undefined;
  /** document.activeElement at this moment. */
  active: Element | null;
  /** document.body, passed in so this stays pure. */
  body: Element | null;
}

/**
 * - `focus`   — the destination is here and usable. Take it.
 * - `wait`    — it is not here yet, and nothing meaningful holds focus, so the
 *               reader is still waiting for the thing they asked for. Keep the
 *               intent and try again after the next render.
 * - `abandon` — the reader has since put focus on a real element. Their newer
 *               action outranks the older request; stealing it back would be
 *               worse than never honouring it.
 */
export type FocusIntentOutcome = 'focus' | 'wait' | 'abandon';

export function resolveFocusIntent({ target, active, body }: FocusIntentState): FocusIntentOutcome {
  // A disabled destination means "not yet", not "never" — the same distinction
  // shouldAbandonRestore draws. The control is usually about to be re-enabled.
  if (target && target.isConnected && !target.hasAttribute('disabled')) return 'focus';

  // Nothing real holds focus: <body>, nothing at all, or a node already
  // detached mid-transition. None of those is the reader choosing to be
  // somewhere, so the request stands.
  if (active === null || active === body || !active.isConnected) return 'wait';

  return 'abandon';
}
