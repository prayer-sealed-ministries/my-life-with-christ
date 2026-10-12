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

import type { Entry, EntryDraft, ImportMode, ImportPreview, JourneyExport } from '../types';
import type { StorageProvider } from '../storage/StorageProvider';
import { newId } from '../storage/semantics';
import { JournalChangedError, sameRecord } from '../storage/journal';
import { migrateExport, type MigrationContext, type MigrationResult } from './migrate';
import { zipEntryText } from './zip';
import { readZipLimited } from '../import/zip-limits';
import { MAX_PICKED_FILE_BYTES, pickedFileTooLargeMessage } from '../platform/file-limits';
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

  if (
    (typeof data === 'string' && new TextEncoder().encode(data).byteLength > MAX_PICKED_FILE_BYTES) ||
    (data instanceof Uint8Array && data.byteLength > MAX_PICKED_FILE_BYTES)
  ) {
    throw new Error(pickedFileTooLargeMessage);
  }

  if (typeof data === 'string') {
    text = data;
    source = 'json';
  } else if (looksLikeZip(data)) {
    let entries;
    try {
      entries = await readZipLimited(data, {
        maxEntries: 10_000,
        maxEntryBytes: 128 * 1024 * 1024,
        maxTotalBytes: 256 * 1024 * 1024,
      });
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
 * Under `merge`, differing records with the same id are conflicts. Apply keeps
 * both as separate entries, because a wall clock cannot safely decide which
 * human-authored version deserves to disappear.
 */
export function previewImport(
  incoming: ParsedImport,
  existing: Entry[],
  mode: ImportMode = 'merge',
  isAnchorResolvable?: (entry: Entry) => boolean,
  existingDrafts: EntryDraft[] = [],
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
    if (sameRecord(current, entry)) {
      unchanged += 1;
      continue;
    }
    if (entry.updatedAt > current.updatedAt) updated += 1;

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
      `Replace mode will delete all ${existing.length} existing ${existing.length === 1 ? 'entry' : 'entries'} and ${existingDrafts.length} unfinished ${existingDrafts.length === 1 ? 'draft' : 'drafts'} before importing.`,
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
    existingDrafts: existingDrafts.length,
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
  draftsImported: number;
  conflictsPreserved: number;
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
  /** Snapshot shown in the preview. A changed journal must be reviewed again. */
  previewToken?: string,
): Promise<ImportResult> {
  const before = await storage.readJournalSnapshot();
  if (previewToken !== undefined && before.token !== previewToken) {
    throw new JournalChangedError();
  }
  const preview = previewImport(incoming, before.entries, mode, undefined, before.drafts);

  if (mode === 'replace') {
    if (incoming.filter) {
      throw new Error('A partial export cannot replace a whole journal. Choose Merge instead.');
    }
    await storage.replaceJournal(incoming.entries, incoming.drafts, before.token);
    return {
      imported: incoming.entries.length,
      draftsImported: incoming.drafts.length,
      conflictsPreserved: 0,
      replaced: true,
      preview,
    };
  }

  const entries = [...before.entries];
  const drafts = [...before.drafts];
  const mine = new Map(entries.map((entry) => [entry.id, entry]));
  const takenEntryIds = new Set(mine.keys());
  const remappedEntryIds = new Map<string, string>();
  let imported = 0;
  let conflictsPreserved = 0;

  const unusedId = (taken: Set<string>): string => {
    let id = newId();
    while (taken.has(id)) id = newId();
    taken.add(id);
    return id;
  };

  // A differing same-id entry is never silently discarded. Keep the local
  // identity in place and import the archived payload under a fresh identity.
  for (const entry of incoming.entries) {
    const current = mine.get(entry.id);
    if (!current) {
      entries.push(entry);
      mine.set(entry.id, entry);
      takenEntryIds.add(entry.id);
      imported += 1;
      continue;
    }
    if (sameRecord(current, entry)) continue;

    const id = unusedId(takenEntryIds);
    entries.push({ ...entry, id });
    remappedEntryIds.set(entry.id, id);
    imported += 1;
    conflictsPreserved += 1;
  }

  const mineDrafts = new Map(drafts.map((draft) => [draft.id, draft]));
  const takenDraftIds = new Set(mineDrafts.keys());
  let draftsImported = 0;
  for (const draft of incoming.drafts) {
    const reparented: EntryDraft = draft.entryId && remappedEntryIds.has(draft.entryId)
      ? { ...draft, entryId: remappedEntryIds.get(draft.entryId) }
      : draft;
    const current = mineDrafts.get(reparented.id);
    if (!current) {
      drafts.push(reparented);
      mineDrafts.set(reparented.id, reparented);
      takenDraftIds.add(reparented.id);
      draftsImported += 1;
      continue;
    }
    if (sameRecord(current, reparented)) continue;
    drafts.push({ ...reparented, id: unusedId(takenDraftIds) });
    draftsImported += 1;
  }

  await storage.replaceJournal(entries, drafts, before.token);
  return { imported, draftsImported, conflictsPreserved, replaced: false, preview };
}
