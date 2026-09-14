/** Types for the data-profile plugin, so tests and vite.config can import it. */

import type { Plugin } from 'vite';

export type DataProfile = 'full' | 'refs-only';

export declare const DATA_PROFILES: DataProfile[];
export declare function resolveProfile(value?: string): DataProfile;

/**
 * What the app receives for a given profile: the compilation entire under
 * `full`, and nothing at all under `refs-only` — not even the verse-span
 * divisions, which are the author's arrangement.
 *
 * Exported so the bundle verifier and the downgrade tests share one definition
 * of what a publishable build contains.
 */
export declare function outlinesForProfile<T = unknown>(books: T[], profile: DataProfile): T[];

/** The empty outline set a `refs-only` build ships. */
export declare const OUTLINE_FREE: never[];

export default function dataProfilePlugin(options?: { profile?: string; root?: string }): Plugin;
