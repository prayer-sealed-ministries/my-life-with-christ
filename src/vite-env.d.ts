/// <reference types="vite/client" />

/** Injected by scripts/vite-plugin-data-profile.mjs. */
declare const __DATA_PROFILE__: 'full' | 'public' | 'refs-only';

declare module 'virtual:journey-data' {
  import type { OutlineBook } from './types';

  export const DATA_PROFILE: 'full' | 'public' | 'refs-only';
  /**
   * True when this build carries a titled division scheme, whichever one.
   * False under `refs-only`, where no divisions ship at all.
   */
  export const hasOutlines: boolean;
  /** Kept as a narrower alias of hasOutlines for title-specific call sites. */
  export const hasOutlineTitles: boolean;
  /**
   * Which scheme the divisions came from.
   *
   *   'outlines' — the purchased [licensed content removed] (profile `full`, local only)
   *   'sections' — BSB section headings, public domain (profile `public`)
   *   'none'     — no divisions; whole chapters (profile `refs-only`)
   */
  export const divisionSource: 'outlines' | 'sections' | 'none';
  export const outlines: OutlineBook[];
  export default outlines;
}
