/**
 * The notice context, the hook that reads it, and how long a notice lives.
 *
 * Separate from `notice.tsx` so that file exports a component and nothing else:
 * mixing a provider with its hook in one module is what the
 * `react-refresh/only-export-components` warning is about, and the repository's
 * warning count is a number that has to stay honest.
 *
 * Why any of this exists is explained in `notice.tsx`.
 */

import { createContext, useContext } from 'react';

/** How long a notice stays on screen. Long enough to read, short enough to go. */
export const NOTICE_MS = 5_000;

export interface Notice {
  text: string;
  /** Changes on every show, so repeating the same words announces again. */
  key: number;
}

export interface NoticeValue {
  notice: Notice | null;
  /** Say something happened. Replaces anything currently showing. */
  showNotice: (text: string) => void;
}

export const NoticeContext = createContext<NoticeValue | null>(null);

/**
 * Show a notice from anywhere below the provider.
 *
 * Returns a no-op outside a provider rather than throwing: a notice is feedback,
 * and a view rendered in isolation by a test should not fail for want of one.
 * Saving must never depend on this to have worked — the write is the product,
 * the sentence is courtesy.
 */
export function useNotice(): NoticeValue {
  return useContext(NoticeContext) ?? { notice: null, showNotice: () => {} };
}
