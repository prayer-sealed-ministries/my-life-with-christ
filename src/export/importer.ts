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
import { stableJson } from '../storage/semantics';
import { migrateExport, type MigrationContext, type MigrationResult } from './migrate';
import { readZip, sha256, zipEntryText } from './zip';
import { verifyArchiveManifest } from './manifest.mjs';
import { MAX_JOURNAL_FILE_BYTES, journalSizeMessage } from '../lib/journal-limits';

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
  const byteLength = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
  if (byteLength > MAX_JOURNAL_FILE_BYTES) throw new Error(journalSizeMessage());
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
 * Wall-clock timestamps are deliberately not treated as causality. If the same
 * id carries different content, merge preserves both versions as a conflict;
 * replace is the only mode that intentionally chooses the file's version.
 */
export function previewImport(
  incoming: ParsedImport,
  existing: Entry[],
  mode: ImportMode = 'merge',
  isAnchorResolvable?: (entry: Entry) => boolean,
): ImportPreview {
  const mine = new Map(existing.map((entry) => [entry.id, entry]));

  let newEntries = 0;
  const updated = 0;
  let unchanged = 0;
  const conflicts: ImportPreview['conflicts'] = [];

  for (const entry of incoming.entries) {
    const current = mine.get(entry.id);
    if (!current) {
      newEntries += 1;
      continue;
    }
    if (sameEntryContent(current, entry)) {
      unchanged += 1;
      continue;
    }

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
  if (mode === 'merge' && conflicts.length > 0) {
    warnings.push(
      `${conflicts.length} ${conflicts.length === 1 ? 'entry has' : 'entries have'} different versions. Merge will keep both; it will not guess from device clocks.`,
    );
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
): Promise<ImportResult> {
  const existing = await storage.listEntries();
  const existingDrafts = await storage.listDrafts();
  const preview = previewImport(incoming, existing, mode);

  if (mode === 'replace') {
    // One atomic swap rather than clear-then-write. The two-step version could
    // leave a reader with neither journal if the write failed after the delete
    // succeeded, which is reachable from an ordinary restore.
    await storage.replaceJournal(incoming.entries, incoming.drafts, {
      entries: existing,
      drafts: existingDrafts,
    });
    return {
      imported: incoming.entries.length,
      draftsImported: incoming.drafts.length,
      conflictsPreserved: 0,
      replaced: true,
      preview,
    };
  }

  // Merge never guesses which different same-id record is newer. The incoming
  // version receives a deterministic conflict id, so its words survive and
  // importing the same archive twice does not create another copy.
  const mine = new Map(existing.map((entry) => [entry.id, entry]));
  const toWrite: Entry[] = [];
  const remappedEntryIds = new Map<string, string>();
  let conflictsPreserved = 0;

  for (const entry of incoming.entries) {
    const current = mine.get(entry.id);
    if (!current) {
      toWrite.push(entry);
      continue;
    }
    if (sameEntryContent(current, entry)) continue;

    const conflict = await conflictEntry(entry, existing, toWrite);
    remappedEntryIds.set(entry.id, conflict.id);
    if (!existing.some((item) => stableJson(item) === stableJson(conflict))) {
      toWrite.push(conflict);
    }
    conflictsPreserved += 1;
  }

  const mergedDrafts: EntryDraft[] = [];
  const knownDrafts = [...existingDrafts];
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
    const conflict = await conflictDraft(draft, knownDrafts);
    if (!knownDrafts.some((item) => stableJson(item) === stableJson(conflict))) {
      mergedDrafts.push(conflict);
      knownDrafts.push(conflict);
    }
  }

  await storage.mergeJournal(toWrite, mergedDrafts, {
    entries: existing,
    drafts: existingDrafts,
  });
  return {
    imported: toWrite.length,
    draftsImported: mergedDrafts.length,
    conflictsPreserved,
    replaced: false,
    preview,
  };
}

function sameEntryContent(a: Entry, b: Entry): boolean {
  const { updatedAt: _a, ...left } = a;
  const { updatedAt: _b, ...right } = b;
  return stableJson(left) === stableJson(right);
}

async function conflictEntry(
  entry: Entry,
  existing: Entry[],
  pending: Entry[],
): Promise<Entry> {
  const digest = await sha256(stableJson(entry));
  const base = `${entry.id}~conflict-${digest.slice(0, 16)}`;
  for (let suffix = 1; ; suffix += 1) {
    const id = suffix === 1 ? base : `${base}-${suffix}`;
    const candidate: Entry = {
      ...entry,
      id,
      _unmigrated: {
        ...entry._unmigrated,
        journeyImportConflict: { originalId: entry.id },
      },
    };
    const occupying = [...existing, ...pending].find((item) => item.id === id);
    if (!occupying || stableJson(occupying) === stableJson(candidate)) return candidate;
  }
}

async function conflictDraft(
  draft: EntryDraft,
  existing: EntryDraft[],
): Promise<EntryDraft> {
  const digest = await sha256(stableJson(draft));
  const base = `${draft.id}~conflict-${digest.slice(0, 16)}`;
  for (let suffix = 1; ; suffix += 1) {
    const id = suffix === 1 ? base : `${base}-${suffix}`;
    const candidate: EntryDraft = {
      ...draft,
      id,
      _unmigrated: {
        ...draft._unmigrated,
        journeyImportConflict: { originalId: draft.id },
      },
    };
    const occupying = existing.find((item) => item.id === id);
    if (!occupying || stableJson(occupying) === stableJson(candidate)) return candidate;
  }
}
