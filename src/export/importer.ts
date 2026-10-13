/**
 * Reading a journal back in.
 *
 * Three shapes are accepted: a protected companion .lwc transfer, an archive
 * this app wrote (a .zip, from which data/journey.json is read), and a bare
 * journey.json. All go through the same loss-preserving forward migration.
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
import { stableJson } from '../storage/semantics';
import { importEnvelopeMetadata, mergeEnvelopeMetadata, type JournalEnvelopeMetadata } from '../storage/envelope-metadata';
import { JournalChangedError } from '../storage/journal';
import { migrateExport, type MigrationContext, type MigrationResult } from './migrate';
import { sha256 } from './zip';
import { readZipLimited } from '../import/zip-limits';
import { MAX_PICKED_FILE_BYTES, pickedFileTooLargeMessage } from '../platform/file-limits';
import { verifyArchiveManifest } from './manifest.mjs';
import { isProtectedTransfer, unlockProtectedTransfer, MAX_PROTECTED_FILE_BYTES } from './protected-transfer';

/** Where journey.json lives inside an archive this app wrote. */
const CANONICAL_PATH = 'data/journey.json';

export interface ParsedImport extends MigrationResult {
  /** How the file arrived, so the UI can describe what it read. */
  source: 'archive' | 'json' | 'protected';
  /** Original journal-level extensions, including metadata-only journals. */
  envelopeMetadata?: JournalEnvelopeMetadata;
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

/** Invalid byte sequences must never become replacement characters in writing. */
function journalText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('That file is not valid UTF-8 journal JSON. Nothing was imported.');
  }
}

/**
 * Parse an import file without writing anything.
 *
 * @param data raw bytes of a .zip or a .json file
 */
export async function parseImport(
  data: Uint8Array | string,
  context: MigrationContext = {},
  password?: string,
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
    text = journalText(canonical.bytes);
    source = 'archive';
  } else {
    text = journalText(data);
    source = 'json';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON, so it cannot be read as a journal.');
  }

  if (isProtectedTransfer(parsed)) {
    if ((typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength) > MAX_PROTECTED_FILE_BYTES) {
      throw new Error('This protected file exceeds the supported 16 MiB limit. Nothing was imported.');
    }
    const plaintext = await unlockProtectedTransfer(parsed, password);
    try { parsed = JSON.parse(plaintext); } catch {
      throw new Error('The unlocked file is not valid journal JSON. Nothing was imported.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        (parsed as Record<string, unknown>).format !== 'journey-export' ||
        (parsed as Record<string, unknown>).version !== 1) {
      throw new Error('The unlocked file is not a supported journal transfer. Keep the original file.');
    }
    source = 'protected';
  }
  const migrated = migrateExport(parsed, context);
  const envelope = parsed as Partial<JourneyExport>;

  return {
    ...migrated,
    envelopeMetadata: importEnvelopeMetadata(parsed as Record<string, unknown>),
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
    if (sameEntryContent(current, entry) || (mode === 'merge' && existingConflictCopy(entry, existing))) {
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
      `Replace mode will delete all ${existing.length} existing ${existing.length === 1 ? 'entry' : 'entries'} and ${existingDrafts.length} unfinished ${existingDrafts.length === 1 ? 'draft' : 'drafts'}, including journal-level metadata, before importing.`,
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
  entriesSkipped: number;
  draftsSkipped: number;
  draftConflictsPreserved: number;
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
    await storage.replaceJournal(incoming.entries, incoming.drafts, before.token, incoming.envelopeMetadata ?? []);
    return {
      imported: incoming.entries.length,
      draftsImported: incoming.drafts.length,
      conflictsPreserved: 0,
      entriesSkipped: 0,
      draftsSkipped: 0,
      draftConflictsPreserved: 0,
      replaced: true,
      preview,
    };
  }

  // Merge never guesses which different same-id record is newer. The incoming
  // version receives a deterministic conflict id, so its words survive and
  // importing the same archive twice does not create another copy.
  const existing = before.entries;
  const existingDrafts = before.drafts;
  const mine = new Map(existing.map((entry) => [entry.id, entry]));
  const toWrite: Entry[] = [];
  const incomingEntryIds = new Set(incoming.entries.map((entry) => entry.id));
  const remappedEntryIds = new Map<string, string>();
  let conflictsPreserved = 0;

  for (const entry of incoming.entries) {
    const current = mine.get(entry.id);
    if (!current) {
      toWrite.push(entry);
      continue;
    }
    if (sameEntryContent(current, entry)) continue;

    const preserved = existingConflictCopy(entry, existing);
    if (preserved) {
      remappedEntryIds.set(entry.id, preserved.id);
      continue;
    }

    const conflict = await conflictEntry(entry, existing, toWrite, incomingEntryIds);
    remappedEntryIds.set(entry.id, conflict.id);
    if (!existing.some((item) => stableJson(item) === stableJson(conflict))) {
      toWrite.push(conflict);
      conflictsPreserved += 1;
    }
  }

  const mergedDrafts: EntryDraft[] = [];
  const knownDrafts = [...existingDrafts];
  const incomingDraftIds = new Set(incoming.drafts.map((draft) => draft.id));
  let draftConflictsPreserved = 0;
  for (const original of incoming.drafts) {
    const draft = remappedEntryIds.has(original.entryId ?? '')
      ? { ...original, entryId: remappedEntryIds.get(original.entryId!) }
      : original;
    const current = knownDrafts.find((item) => item.id === draft.id);
    if (!current) {
      mergedDrafts.push(draft);
      knownDrafts.push(draft);
      continue;
    }
    if (stableJson(current) === stableJson(draft)) continue;
    const conflict = await conflictDraft(draft, knownDrafts, incomingDraftIds);
    if (!knownDrafts.some((item) => stableJson(item) === stableJson(conflict))) {
      mergedDrafts.push(conflict);
      knownDrafts.push(conflict);
      draftConflictsPreserved += 1;
    }
  }

  await storage.replaceJournal(
    [...existing, ...toWrite], [...existingDrafts, ...mergedDrafts], before.token,
    mergeEnvelopeMetadata(before.envelopeMetadata ?? [], incoming.envelopeMetadata ?? []),
  );
  return {
    imported: toWrite.length,
    draftsImported: mergedDrafts.length,
    conflictsPreserved,
    entriesSkipped: incoming.entries.length - toWrite.length,
    draftsSkipped: incoming.drafts.length - mergedDrafts.length,
    draftConflictsPreserved,
    replaced: false,
    preview,
  };
}


function sameEntryContent(a: Entry, b: Entry): boolean {
  // Keep main's exact-record rule: timestamps are preserved data too.
  return stableJson(a) === stableJson(b);
}

/** A previously kept conflict is a duplicate too, not another new conflict. */
function existingConflictCopy(entry: Entry, existing: Entry[]): Entry | undefined {
  return existing.find((saved) => {
    const marker = saved._unmigrated?.journeyImportConflict;
    if (!marker || typeof marker !== 'object' || Array.isArray(marker) ||
        (marker as Record<string, unknown>).originalId !== entry.id) return false;
    const provenance = marker as Record<string, unknown>;
    const extensions = { ...saved._unmigrated };
    if (Object.hasOwn(provenance, 'previous')) extensions.journeyImportConflict = provenance.previous;
    else delete extensions.journeyImportConflict;
    const original = { ...saved, id: entry.id };
    if (Object.keys(extensions).length || entry._unmigrated) original._unmigrated = extensions;
    else delete original._unmigrated;
    return sameEntryContent(original, entry);
  });
}

async function conflictEntry(
  entry: Entry,
  existing: Entry[],
  pending: Entry[],
  reservedIds: ReadonlySet<string>,
): Promise<Entry> {
  const digest = await sha256(stableJson(entry));
  const base = `${entry.id}~conflict-${digest.slice(0, 16)}`;
  for (let suffix = 1; ; suffix += 1) {
    const id = suffix === 1 ? base : `${base}-${suffix}`;
    // A later incoming record may already own this deterministic-looking id.
    // Reserve the whole incoming inventory, not just records visited so far.
    if (reservedIds.has(id)) continue;
    const candidate: Entry = {
      ...entry,
      id,
      _unmigrated: {
        ...entry._unmigrated,
        journeyImportConflict: conflictProvenance(entry.id, entry._unmigrated),
      },
    };
    const occupying = [...existing, ...pending].find((item) => item.id === id);
    if (!occupying || stableJson(occupying) === stableJson(candidate)) return candidate;
  }
}

async function conflictDraft(
  draft: EntryDraft,
  existing: EntryDraft[],
  reservedIds: ReadonlySet<string>,
): Promise<EntryDraft> {
  const digest = await sha256(stableJson(draft));
  const base = `${draft.id}~conflict-${digest.slice(0, 16)}`;
  for (let suffix = 1; ; suffix += 1) {
    const id = suffix === 1 ? base : `${base}-${suffix}`;
    if (reservedIds.has(id)) continue;
    const candidate: EntryDraft = {
      ...draft,
      id,
      _unmigrated: {
        ...draft._unmigrated,
        journeyImportConflict: conflictProvenance(draft.id, draft._unmigrated),
      },
    };
    const occupying = existing.find((item) => item.id === id);
    if (!occupying || stableJson(occupying) === stableJson(candidate)) return candidate;
  }
}

function conflictProvenance(originalId: string, extensions?: Record<string, unknown>) {
  return {
    originalId,
    ...(extensions && Object.hasOwn(extensions, 'journeyImportConflict')
      ? { previous: extensions.journeyImportConflict }
      : {}),
  };
}
