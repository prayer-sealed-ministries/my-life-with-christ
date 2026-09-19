/**
 * The provider for focus mode. See `focus-context.ts` for why it lives here.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { FocusContext } from './focus-context';
import { useRouter } from './router';

/** The only routes where writing without chrome means anything. */
const EDITOR_ROUTES = new Set(['entry', 'newEntry']);

export function FocusProvider({ children }: { children: ReactNode }) {
  const { route } = useRouter();
  const [focused, setFocused] = useState(false);

  const enterFocus = useCallback(() => setFocused(true), []);
  const exitFocus = useCallback(() => setFocused(false), []);

  const onEditorRoute = EDITOR_ROUTES.has(route.name);

  /*
   * Leaving the editor ends focus mode.
   *
   * Two things would go wrong without this. The reader would land on a
   * chrome-less timeline — no header, no navigation, no way back out of it —
   * and the flag would stay set, so opening any entry an hour later would drop
   * them into a mode they never asked for a second time.
   *
   * Adjusted during render rather than in an effect, which is the documented
   * React pattern for exactly this and is the only version that is correct: an
   * effect runs AFTER the render it is correcting, so a headerless Home would
   * be painted for a frame first. React discards this pass and re-renders
   * before painting, so there is no intermediate state for anyone to see.
   */
  if (focused && !onEditorRoute) setFocused(false);

  const value = useMemo(
    // `focused && onEditorRoute` rather than `focused` alone. Redundant given
    // the reset above, and kept: it is the assertion that no route outside the
    // editor can ever be handed a true, and it costs one boolean.
    () => ({ focused: focused && onEditorRoute, enterFocus, exitFocus }),
    [focused, onEditorRoute, enterFocus, exitFocus],
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}
