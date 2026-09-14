/// <reference types="vite/client" />

/** Injected by scripts/vite-plugin-data-profile.mjs. */
declare const __DATA_PROFILE__: 'full' | 'refs-only';

declare module 'virtual:journey-data' {
  import type { OutlineBook } from './types';

  export const DATA_PROFILE: 'full' | 'refs-only';
  /**
   * False under `refs-only`, where NO outline data ships — not the titles, and
   * not the verse-span divisions, which are the author's arrangement.
   */
  export const hasOutlines: boolean;
  /** Kept as a narrower alias of hasOutlines for title-specific call sites. */
  export const hasOutlineTitles: boolean;
  export const outlines: OutlineBook[];
  export default outlines;
}
