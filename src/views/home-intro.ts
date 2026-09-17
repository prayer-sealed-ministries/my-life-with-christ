/**
 * Whether the reader has met the home introduction already.
 *
 * A disposable interface preference, so it sits in localStorage beside the
 * theme and the first-visit flag rather than in the journal. Losing it costs
 * somebody one tap; nothing they wrote depends on it.
 *
 * It lives in its own module rather than beside the component for the reason
 * `src/lib/focus-restore.ts` does: the bug this code has already had was a
 * question about the *decision*, not about the rendering, and a decision that
 * can be imported can be asserted directly.
 */

const INTRO_KEY = 'journey:intro';

/**
 * What was remembered, or null when this reader has never been here.
 *
 * Pure: it reads and nothing else. The first version recorded "seen" from
 * inside the `useState` initializer, which is a write during render — React may
 * invoke an initializer more than once, and on a device it did: the very first
 * visit came up collapsed, which is precisely the reader this is meant for.
 * The recording now happens in an effect, where a repeat is harmless.
 */
export function readIntro(): 'open' | 'closed' | null {
  try {
    const stored = localStorage.getItem(INTRO_KEY);
    return stored === 'open' || stored === 'closed' ? stored : null;
  } catch {
    // Site data blocked. Showing the introduction is the harmless failure.
    return null;
  }
}

export function rememberIntro(open: boolean): void {
  try {
    localStorage.setItem(INTRO_KEY, open ? 'open' : 'closed');
  } catch {
    /* Nothing to remember it with; the toggle still works for this visit. */
  }
}
