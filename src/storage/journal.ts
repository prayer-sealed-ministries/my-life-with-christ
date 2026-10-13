/** Shared, provider-independent journal snapshot semantics. */

import type { Entry, EntryDraft } from '../types';
import { mergeEnvelopeMetadata, type JournalEnvelopeMetadata } from './envelope-metadata';

export interface JournalSnapshot {
  entries: Entry[];
  drafts: EntryDraft[];
  /** Absent in legacy/test callers means empty, never a concurrency wildcard. */
  envelopeMetadata?: JournalEnvelopeMetadata;
  /** Full canonical content, used only as an optimistic concurrency token. */
  token: string;
  /** When this exact snapshot was acquired, before archive construction. */
  capturedAt: string;
}

/** Raised before a restore can overwrite work accepted after its preview. */
export class JournalChangedError extends Error {
  constructor() {
    super('Your journal changed while this operation was in progress. Nothing was replaced; review it and try again.');
    this.name = 'JournalChangedError';
  }
}

/**
 * A complete, deterministic representation of journal content.
 *
 * The token is intentionally the full string rather than a small non-cryptographic
 * hash: a false equality could bless an incomplete backup. It never leaves the
 * process or the provider boundary.
 */
export function journalToken(entries: Entry[], drafts: EntryDraft[], envelopeMetadata: JournalEnvelopeMetadata = []): string {
  const metadata = mergeEnvelopeMetadata(envelopeMetadata);
  return JSON.stringify({
    entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)),
    drafts: [...drafts].sort((a, b) => a.id.localeCompare(b.id)),
    // Keep the historical token shape for journals without opaque metadata.
    ...(metadata.length ? { envelopeMetadata: metadata } : {}),
  });
}

export const sameRecord = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);
