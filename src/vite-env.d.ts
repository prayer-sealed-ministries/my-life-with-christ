/// <reference types="vite/client" />

/** Injected from package.json by vite.config.ts. */
declare const __APP_VERSION__: string;

/** Injected by scripts/vite-plugin-data-profile.mjs. */
declare const __DATA_PROFILE__: 'public' | 'refs-only';

declare module 'virtual:journey-data' {
  export const DATA_PROFILE: 'public' | 'refs-only';
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
   *   'sections' — BSB section headings, public domain (profile `public`)
   *   'none'     — no divisions; whole chapters (profile `refs-only`)
   */
  export const divisionSource: 'sections' | 'none';
}

/**
 * The division payload, reached only by `import()`.
 *
 * Deliberately a module of its own rather than another export of
 * `virtual:journey-data`: a dynamically-imported module is its own chunk by
 * construction, which is what keeps three quarters of a megabyte of section
 * headings off the path between tapping the widget and typing a sentence.
 * Nothing in the application imports this statically — `src/app/sections.ts`
 * is the only caller. See scripts/vite-plugin-data-profile.mjs.
 */
declare module 'virtual:journey-outlines' {
  import type { OutlineBook } from './types';

  export const outlines: OutlineBook[];
  export default outlines;
}
