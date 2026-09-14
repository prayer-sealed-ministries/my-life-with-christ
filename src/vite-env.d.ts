/// <reference types="vite/client" />

/** Injected by scripts/vite-plugin-data-profile.mjs. */
declare const __DATA_PROFILE__: 'full' | 'refs-only';

declare module 'virtual:journey-data' {
  import type { OutlineBook } from './types';

  export const DATA_PROFILE: 'full' | 'refs-only';
  /** False under `refs-only`: outline titles and intros are absent from the build. */
  export const hasOutlineTitles: boolean;
  export const outlines: OutlineBook[];
  export default outlines;
}
