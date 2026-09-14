/** Types for the data-profile plugin, so tests and vite.config can import it. */

import type { Plugin } from 'vite';

export type DataProfile = 'full' | 'refs-only';

export declare const DATA_PROFILES: DataProfile[];
export declare function resolveProfile(value?: string): DataProfile;

/**
 * Strip a full outlines dataset to bare references — exactly what a `refs-only`
 * build ships. Exported so the bundle verifier and the downgrade tests share one
 * definition of what counts as protected.
 */
export declare function stripToRefs<T = unknown>(books: T[]): T[];

export default function dataProfilePlugin(options?: { profile?: string; root?: string }): Plugin;
