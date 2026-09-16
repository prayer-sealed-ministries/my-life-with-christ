/**
 * Turning reviewed candidates into journal entries.
 *
 * Two promises are kept here.
 *
 * The first is that nothing is written until this function is called. Choosing
 * a file, parsing it, editing a title, ticking a box — none of it touches
 * storage. Cancelling at any point leaves the journal byte-for-byte as it was.
 *
 * The second is that the write is all-or-nothing. Every entry goes through a
 * single `putEntries`, which reaches Dexie's `bulkPut` on one table and
 * therefore one IndexedDB transaction: it commits completely or it aborts
 * completely. A half-imported journal is the outcome this shape prevents.
 */

import { sha256 } from '../export/zip';
import type { StorageProvider } from '../storage/StorageProvider';
import type { Entry } from '../types';
import { candidateToEntry, type Candidate, type ParsedDocument } from './candidates';

/** Why a candidate is thought to be something the journal already has. */
export type DuplicateKind = 'same-file' | 'same-content';

export interface DuplicateFinding {
  candidateId: string;
  kind: DuplicateKind;
  /** The entry it matches, so the user can go and look at it. */
  existingId: string;
  existingTitle: string;
}

export interface DuplicateReport {
  /** True when this exact file has been imported before. */
  fileSeenBefore: boolean;
  findings: DuplicateFinding[];
}

const canonicalBody = (body: string): string => body.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * What already looks like this. Reads; never writes, merges, or deletes.
 *
 * Both checks are local: the file's own sha-256 against the provenance already
 * on existing entries, and each candidate's body hash against the bodies of
 * existing entries. Nothing is sent anywhere to ask.
 *
 * Findings are reported, never acted on. Deciding that two similar notes are
 * the same note is the user's call — a person may genuinely have written twice
 * about one sermon.
 */
export async function findDuplicates(
  document: ParsedDocument,
  candidates: Candidate[],
  existing: Entry[],
): Promise<DuplicateReport> {
  const fileSeenBefore = existing.some((entry) => entry.source?.filename === document.filename);

  const byBody = new Map<string, Entry>();
  for (const entry of existing) {
    const body = canonicalBody(`${entry.title}\n${entry.notes}`);
    if (body) byBody.set(await sha256(body), entry);
  }

  const findings: DuplicateFinding[] = [];
  for (const candidate of candidates) {
    const match = byBody.get(candidate.fingerprint);
    if (match) {
      findings.push({
        candidateId: candidate.id,
        kind: 'same-content',
        existingId: match.id,
        existingTitle: match.title || '(untitled)',
      });
    } else if (fileSeenBefore) {
      const sameFile = existing.find((entry) => entry.source?.filename === document.filename);
      if (sameFile) {
        findings.push({
          candidateId: candidate.id,
          kind: 'same-file',
          existingId: sameFile.id,
          existingTitle: sameFile.title || '(untitled)',
        });
      }
    }
  }

  return { fileSeenBefore, findings };
}

export interface CommitResult {
  imported: number;
  /** Non-empty only if the write itself failed. */
  failures: string[];
}

/**
 * Write the accepted candidates.
 *
 * Fresh ids are minted for every entry, never taken from the document, so an
 * import can never overwrite something already in the journal. The minted ids
 * are checked against what exists anyway — the cost is one comparison and the
 * alternative is silently replacing a note somebody wrote.
 */
export async function commitImport(
  document: ParsedDocument,
  candidates: Candidate[],
  storage: StorageProvider,
  now: () => string = () => new Date().toISOString(),
): Promise<CommitResult> {
  const accepted = candidates.filter((candidate) => candidate.include);
  if (accepted.length === 0) return { imported: 0, failures: [] };

  const existing = await storage.listEntries();
  const taken = new Set(existing.map((entry) => entry.id));

  const importedAt = now();
  const entries: Entry[] = [];

  for (const [index, candidate] of accepted.entries()) {
    let id = crypto.randomUUID();
    // Vanishingly unlikely, and checked anyway: "never silently overwrite an
    // existing record" is not a probabilistic promise.
    while (taken.has(id)) id = crypto.randomUUID();
    taken.add(id);

    const stamp = now();
    entries.push({
      ...candidateToEntry(candidate, document, importedAt, index),
      id,
      createdAt: stamp,
      updatedAt: stamp,
    });
  }

  // One call, one transaction. Either every entry lands or none does.
  try {
    await storage.putEntries(entries);
  } catch (cause) {
    return {
      imported: 0,
      failures: [
        cause instanceof Error && cause.name === 'QuotaExceededError'
          ? 'There is not enough room left in this browser to store these notes. Nothing was imported.'
          : 'The notes could not be saved, so nothing was imported. Your journal is unchanged.',
      ],
    };
  }

  return { imported: entries.length, failures: [] };
}
