/**
 * The sharing seam.
 *
 * v1 ships a local-only implementation: it can produce a self-contained file for
 * a single entry, and nothing else. No network, no accounts, no groups.
 *
 * The interface is shaped for what v2 is intended to add, so it does not have to
 * be rewritten: a shareable read-only link, small private groups (a
 * congregation, a family, a study group) posting notes on the same sermon, and
 * "this sermon" as a joinable object gathering many people's notes on one date,
 * speaker, and passage.
 *
 * THE PRIVACY RULE, which any implementation must honour:
 *   - Entries are private by default.
 *   - Sharing is per-entry, explicit, and revocable.
 *   - Reflections and prayers are NEVER shared implicitly along with notes.
 *     Including them requires its own affirmative choice, per share.
 */

import type { Entry } from '../types';

/**
 * What a share carries. Defaults are the private ones: opting in to a reflection
 * or a prayer is always a separate, deliberate act.
 */
export interface ShareScope {
  includeNotes: boolean;
  /** "What it meant to me." Never implied by includeNotes. */
  includeReflection: boolean;
  /** Never implied by includeNotes. */
  includePrayer: boolean;
  includeLinks: boolean;
}

export const PRIVATE_BY_DEFAULT: ShareScope = {
  includeNotes: true,
  includeReflection: false,
  includePrayer: false,
  includeLinks: true,
};

export interface ShareResult {
  /** How this share was produced, so the UI can describe it honestly. */
  medium: 'file';
  filename: string;
  mimeType: string;
  content: Blob;
  /** Set once a medium can be revoked; always null for a file. */
  revokeToken: string | null;
}

export interface ShareProvider {
  /** Which media this implementation can actually produce. */
  readonly capabilities: {
    file: boolean;
    /** v2. */
    link: boolean;
    /** v2. */
    group: boolean;
  };

  /** Produce a shareable artefact for exactly one entry. */
  shareEntry(entry: Entry, scope: ShareScope): Promise<ShareResult>;

  /**
   * Withdraw a share. v1 has nothing to revoke — a file that has left the device
   * cannot be recalled — so it reports that honestly rather than pretending.
   */
  revoke(token: string): Promise<{ revoked: boolean; reason?: string }>;
}
