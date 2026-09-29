/**
 * Reading a journal back in.
 *
 * Two shapes are accepted: an archive this app wrote (a .zip, from which
 * data/journey.json is read), and a bare journey.json. Both go through the same
 * forward migration, so neither can lose a field this build does not recognise.
 *
 * Nothing is written until the caller has seen a preview. An import can replace
 * a lifetime of writing; it does not get to surprise anyone.
 *
 * AN ARCHIVE IS VERIFIED BEFORE IT IS BELIEVED
 *
 * A .zip is checked against its own MANIFEST.txt before a single entry is
 * parsed out of it. Until that passes, the bytes are not a journal — they are
 * an unread file — and nothing downstream may treat them as content: not the
 * preview, not the conflict counts, and certainly not storage.
 *
 * This was not a theoretical worry. It was measured: an archive altered inside
 * a still-valid ZIP, its manifest left untouched, imported silently into an
 * empty journal — which is the state every migrating device is in — and the
 * original writing was gone. MANIFEST.txt had recorded the right checksum the
 * whole time; nothing consulted it.
 *
 * A bare journey.json carries no manifest and never did. It is a different
 * input, not an older archive, and it is accepted exactly as before.
 */

import type { Entry, ImportMode, ImportPreview, JourneyExport } from '../types';
import type { StorageProvider } from '../storage/StorageProvider';
import { migrateExport, type MigrationContext, type MigrationResult } from './migrate';
import { readZip, zipEntryText } from './zip';
import { verifyArchiveManifest } from './manifest.mjs';

/** Where journey.json lives inside an archive this app wrote. */
const CANONICAL_PATH = 'data/journey.json';

export interface ParsedImport extends MigrationResult {
  /** How the file arrived, so the UI can describe what it read. */
  source: 'archive' | 'json';
  /** The filter recorded in the archive, when it was a partial export. */
  filter?: JourneyExport['filter'];
  exportedAt?: string;
}

/**
 * The archive did not match its own manifest, so it was not read.
 *
 * Carries the detail for a developer and keeps it away from the reader. What
 * a person needs to know is that the file could not be verified and that
 * nothing was changed. Which file hashed wrong is noise to them, and the
 * wording stays clear of "tampered" or "malicious": a bad copy, a failing
 * card, or a sync that stopped halfway produce exactly this, and are far more
 * likely than anyone meddling.
 */
export class ArchiveIntegrityError extends Error {
  readonly problems: { assertion: string; detail: string }[];

  constructor(problems: { assertion: string; detail: string }[]) {
    super('This backup could not be verified and was not restored.');
    this.name = 'ArchiveIntegrityError';
    this.problems = problems;
  }
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

const looksLikeZip = (data: Uint8Array): boolean =>
  data.length >= 4 && ZIP_MAGIC.every((byte, index) => data[index] === byte);

/**
 * Parse an import file without writing anything.
 *
 * @param data raw bytes of a .zip or a .json file
 */
export async function parseImport(
  data: Uint8Array | string,
  context: MigrationContext = {},
): Promise<ParsedImport> {
  let text: string;
  let source: ParsedImport['source'];

  if (typeof data === 'string') {
    text = data;
    source = 'json';
  } else if (looksLikeZip(data)) {
    let entries;
    try {
      entries = await readZip(data);
    } catch (cause) {
      // A ZIP that will not open is damage of the loudest kind. It is reported
      // as a failure to verify, like every other kind, because from where the
      // reader sits there is no useful difference.
      throw new ArchiveIntegrityError([
        { assertion: 'ARCHIVE_WAS_READ', detail: messageOf(cause) },
      ]);
    }

    // Before anything is read out of it.
    const integrity = await verifyArchiveManifest(entries);
    if (!integrity.ok) throw new ArchiveIntegrityError(integrity.problems);

    const canonical = entries.find((entry) => entry.path === CANONICAL_PATH);
    if (!canonical) {
      throw new Error(
        `That archive has no ${CANONICAL_PATH}. If it is a Journey export, the file may be damaged.`,
      );
    }
    text = zipEntryText(canonical);
    source = 'archive';
  } else {
    text = new TextDecoder().decode(data);
    source = 'json';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON, so it cannot be read as a journal.');
  }

  const migrated = migrateExport(parsed, context);
  const envelope = parsed as Partial<JourneyExport>;

  return {
    ...migrated,
    source,
    filter: envelope.filter,
    exportedAt: typeof envelope.exportedAt === 'string' ? envelope.exportedAt : undefined,
  };
}

/**
 * Work out what an import would do. Writes nothing.
 *
 * Under `merge` the newest `updatedAt` wins, and any id present on both sides
 * where both were edited is reported as a conflict so the user sees it before
 * deciding.
 */
export function previewImport(
  incoming: ParsedImport,
  existing: Entry[],
  mode: ImportMode = 'merge',
  isAnchorResolvable?: (entry: Entry) => boolean,
): ImportPreview {
  const mine = new Map(existing.map((entry) => [entry.id, entry]));

  let newEntries = 0;
  let updated = 0;
  let unchanged = 0;
  const conflicts: ImportPreview['conflicts'] = [];

  for (const entry of incoming.entries) {
    const current = mine.get(entry.id);
    if (!current) {
      newEntries += 1;
      continue;
    }
    if (current.updatedAt === entry.updatedAt) {
      unchanged += 1;
      continue;
    }
    if (entry.updatedAt > current.updatedAt) updated += 1;
    else unchanged += 1;

    conflicts.push({
      id: entry.id,
      title: entry.title || '(untitled)',
      mineUpdatedAt: current.updatedAt,
      theirsUpdatedAt: entry.updatedAt,
    });
  }

  const warnings = [...incoming.warnings];
  if (mode === 'replace') {
    warnings.unshift(
      `Replace mode will delete all ${existing.length} existing ${existing.length === 1 ? 'entry' : 'entries'} before importing.`,
    );
  }
  if (incoming.filter) {
    warnings.push('This archive was a partial export — it does not contain the whole journal.');
  }

  const danglingAnchors = isAnchorResolvable
    ? incoming.entries.filter((entry) => !isAnchorResolvable(entry)).length
    : 0;

  return {
    mode,
    incoming: incoming.entries.length,
    existing: existing.length,
    newEntries,
    updated,
    unchanged,
    conflicts,
    danglingAnchors,
    migratedFrom: incoming.migratedFrom,
    warnings,
  };
}

export interface ImportResult {
  imported: number;
  replaced: boolean;
  preview: ImportPreview;
}

/**
 * Apply an import. Call `previewImport` and show the user the result first.
 */
export async function applyImport(
  incoming: ParsedImport,
  storage: StorageProvider,
  mode: ImportMode = 'merge',
): Promise<ImportResult> {
  const existing = await storage.listEntries();
  const preview = previewImport(incoming, existing, mode);

  if (mode === 'replace') {
    // One atomic swap rather than clear-then-write. The two-step version could
    // leave a reader with neither journal if the write failed after the delete
    // succeeded, which is reachable from an ordinary restore.
    await storage.replaceEntries(incoming.entries);
    await restoreDrafts(incoming, storage);
    return { imported: incoming.entries.length, replaced: true, preview };
  }

  // Merge: newest updatedAt wins, per id.
  const mine = new Map(existing.map((entry) => [entry.id, entry]));
  const toWrite: Entry[] = [];

  for (const entry of incoming.entries) {
    const current = mine.get(entry.id);
    if (!current || entry.updatedAt > current.updatedAt) toWrite.push(entry);
  }

  await storage.putEntries(toWrite);
  await restoreDrafts(incoming, storage);
  return { imported: toWrite.length, replaced: false, preview };
}

/**
 * Put unfinished writing back as unfinished writing.
 *
 * Restored as drafts, never as entries: an archive made mid-sentence carries
 * the sentence, and importing it must not promote a half-thought into the
 * finished journal. The count reported to the reader stays the entry count for
 * the same reason — drafts are recovered work, not entries received.
 *
 * Failures here are deliberately not fatal. The journal has already been
 * written by the time this runs, and refusing the whole import because an
 * unfinished note would not restore would be the wrong trade.
 */
async function restoreDrafts(incoming: ParsedImport, storage: StorageProvider): Promise<void> {
  for (const draft of incoming.drafts) {
    await storage.putDraft(draft).catch(() => {});
  }
}
