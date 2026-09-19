/**
 * Whether the editor is writing without the application around it.
 *
 * Lives above the routed view for one specific reason, learned the hard way:
 * saving a new entry navigates `#/entry/new` -> `#/entry/<id>`, and App gives
 * those routes different React keys, so the editor is REMOUNTED by a successful
 * save. Focus mode kept in the editor's own state would end the moment someone
 * saved — mid-sermon, which is exactly when they would be using it.
 *
 * So the same shape as `notice-context.ts`: state above the remount, hooks here,
 * provider in its own module so that file exports only a component.
 *
 * Deliberately session state and nothing more. It never reaches SQLite, the
 * archive, or a settings record: it is how somebody is holding the app for the
 * next forty minutes, not something about their journal. Relaunching tomorrow
 * into the ordinary editor is the right default and needs no preference.
 */

import { createContext, useContext } from 'react';

export interface FocusValue {
  /** Is the editor filling the app, with the shell's chrome out of the way? */
  focused: boolean;
  enterFocus: () => void;
  exitFocus: () => void;
}

export const FocusContext = createContext<FocusValue | null>(null);

/**
 * Read focus mode from anywhere below the provider.
 *
 * A no-op outside one rather than a throw: a view rendered alone in a test
 * should not fail for want of chrome it is not displaying.
 */
export function useFocusMode(): FocusValue {
  return (
    useContext(FocusContext) ?? { focused: false, enterFocus: () => {}, exitFocus: () => {} }
  );
}
