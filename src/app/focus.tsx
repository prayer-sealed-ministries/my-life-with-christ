/**
 * The provider for focus mode. See `focus-context.ts` for why it lives here.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { editorSessionKey, isSameEditorSession } from './editor-session';
import { FocusContext } from './focus-context';
import { useRouter } from './router';

export function FocusProvider({ children }: { children: ReactNode }) {
  const { route } = useRouter();
  /**
   * The editor focus mode was chosen FOR, or null when it is off.
   *
   * One piece of state carrying both facts, because they are one fact: focus
   * belongs to a piece of writing, not to the application. Held as state
   * rather than a ref so it can be read while rendering — a ref cannot, and
   * this has to be read on the render that decides whether the chrome is
   * there.
   *
   * Before this it belonged to "am I on an editor route", and so every editor
   * inherited it from the last: entering focus mode on a prayer and then
   * tapping the home-screen widget opened a brand new sermon with the chrome
   * already gone, which is the opposite of what Fast Capture promises.
   */
  const [focusedFor, setFocusedFor] = useState<string | null>(null);

  const editor = editorSessionKey(route);
  const focused = isSameEditorSession(focusedFor, editor);

  const enterFocus = useCallback(() => setFocusedFor(editor), [editor]);
  const exitFocus = useCallback(() => setFocusedFor(null), []);

  /*
   * Keep the remembered editor honest about where the reader now is.
   *
   * Two different jobs, and both matter. When the session has genuinely ended
   * — a different entry, a new capture, or anywhere outside an editor — focus
   * ends with it; otherwise the reader lands on a chrome-less timeline with no
   * way out, or opens something an hour later in a mode they never chose.
   *
   * When it has merely CHANGED ADDRESS — a new entry acquiring an id, which is
   * what saving does — the new address is adopted. Without that the stale
   * `new:` key would go on matching the next new capture, and focus would leak
   * into it: exactly the bug this file is about, one step later.
   *
   * Adjusted during render rather than in an effect, which is the documented
   * React pattern for this and the only version that is correct: an effect
   * runs AFTER the render it is correcting, so a headerless Home would be
   * painted for a frame first. React discards this pass and re-renders before
   * painting, so there is no intermediate state for anyone to see.
   */
  if (focusedFor !== null && focusedFor !== editor) {
    setFocusedFor(focused ? editor : null);
  }

  const value = useMemo(
    () => ({ focused, enterFocus, exitFocus }),
    [focused, enterFocus, exitFocus],
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}
