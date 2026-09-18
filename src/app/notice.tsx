/**
 * A short-lived line telling someone what just happened.
 *
 * WHY THIS EXISTS AT ALL, RATHER THAN IN THE VIEW THAT CAUSED IT
 *
 * Saving a new entry navigates from `#/entry/new` to `#/entry/<id>`, and App
 * gives those two routes different React keys — `new:*` and `entry:<id>`. A
 * changed key is a remount, so every piece of the editor's local state is
 * discarded at exactly the moment the save succeeds. The confirmation was set
 * and destroyed in the same tick, which is why a reader saving a new entry saw
 * nothing at all while an edit confirmed itself perfectly.
 *
 * The fix is not to keep the old component alive or to delay the navigation.
 * It is to notice that "this succeeded" outlives the screen that caused it, and
 * to hold it somewhere that outlives the screen too. This provider sits above
 * the routed view and never unmounts, so a route change cannot take the message
 * with it.
 *
 * Deliberately not a toast framework. One message at a time, no queue, no
 * stacking, no animation library, no portal. The app needs a sentence.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { NoticeContext, NOTICE_MS, type Notice } from './notice-context';

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const counter = useRef(0);

  const showNotice = useCallback((text: string) => {
    counter.current += 1;
    setNotice({ text, key: counter.current });
  }, []);

  // Clear it after a while. Keyed on the notice itself, so a second save
  // restarts the clock rather than inheriting the first one's remaining time.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const value = useMemo(() => ({ notice, showNotice }), [notice, showNotice]);
  return <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>;
}
