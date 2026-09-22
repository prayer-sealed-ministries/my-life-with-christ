/**
 * Work that happens a frame later, and whether it should still happen.
 *
 * Deferring a navigation by one frame is sometimes necessary — a live region
 * has to sit in the DOM long enough to be announced before the view carrying
 * it is replaced. The cost is that the app has, for that frame, an intention
 * to navigate that nobody can see and nothing consults.
 *
 * That cost was measured rather than imagined. Saving an entry that already
 * exists ends in a navigation to the address the browser is already on, so the
 * deferred frame changes nothing visible and there is no way to wait for it.
 * Anything that navigated inside that frame was then undone: the queued
 * navigation ran afterwards and took the browser back to the entry. Held
 * deterministically — frame captured, save, navigate away, frame released —
 * it happened ten times out of ten.
 *
 * A frame is about sixteen milliseconds, which no tap can fit inside. But
 * `requestAnimationFrame` does not fire at all while a page is in the
 * background, so the window is not bounded by sixteen milliseconds; it is
 * bounded by when the app is next looked at.
 *
 * The rule is therefore about ownership rather than timing: a navigation
 * scheduled from one place may only complete while the app is still in that
 * place. Anything else has been overtaken by a newer intention, and the newer
 * one wins.
 */

/** May a navigation scheduled for a later frame still take effect? */
export type DeferredNavigationOutcome = 'navigate' | 'superseded';

export interface DeferredNavigationState {
  /** Where the app was when this navigation was scheduled. */
  scheduledFrom: string;
  /** Where the app is now, as the address itself has it. */
  current: string;
}

/**
 * The whole decision, in one place and with no clock in it.
 *
 * Compared against the address rather than against a rendered route: the
 * address changes synchronously when something navigates, so it is already
 * right during the frame between a navigation and the render that follows it.
 * A newer navigation that React has not drawn yet must still win here.
 */
export function resolveDeferredNavigation({
  scheduledFrom,
  current,
}: DeferredNavigationState): DeferredNavigationOutcome {
  return scheduledFrom === current ? 'navigate' : 'superseded';
}

/**
 * Run something after the browser's next frame. Returns a canceller.
 *
 * rAF where it exists, a timer where it does not — some runtimes the app is
 * tested in have no frames at all, and a callback that never ran would strand
 * whatever was waiting on it.
 */
export function nextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(handle);
  }
  const handle = setTimeout(callback, 16);
  return () => clearTimeout(handle);
}
