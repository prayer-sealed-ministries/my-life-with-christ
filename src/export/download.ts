/**
 * Handing the archive to the user.
 *
 * Deliberately dumb: build the bytes, hand them over, record that it happened.
 * The whole value of the export is that the resulting file is the user's, sitting
 * on their own disk, needing nothing from us.
 *
 * The handing-over now goes through a `FileSaver` rather than straight to a
 * download. Building the archive is shared across every edition and produces
 * identical bytes; delivering those bytes to a file system is the one part that
 * differs between a browser tab, an iOS share sheet and Android's Storage
 * Access Framework. Splitting them here is what keeps that difference from
 * reaching the export view.
 */

import type { FileSaver, OutgoingFile } from '../platform/ports';
import type { StorageProvider } from '../storage/StorageProvider';
import { buildArchive, matchesFilter, type BuildArchiveOptions, type BuiltArchive } from './archive';
import type { ExportFilter } from '../types';

/** The zip media type, named once so the port and its tests agree. */
export const ARCHIVE_MIME = 'application/zip';

/** A built archive, as the platform wants it. Pure; delivers nothing. */
export function outgoingArchive(archive: BuiltArchive): OutgoingFile {
  return {
    suggestedName: archive.filename,
    bytes: archive.bytes,
    mimeType: ARCHIVE_MIME,
  };
}

export interface ExportEverythingOptions
  extends Omit<BuildArchiveOptions, 'entries' | 'allEntries' | 'filter'> {
  storage: StorageProvider;
  filter?: ExportFilter;
  /** Where the bytes go. The web binding downloads them. */
  files: FileSaver;
}

/**
 * The two-tap path: read the journal, build the archive, save it, and record the
 * export so the reminder resets.
 *
 * The archive is returned whether or not it was saved — the bytes were built
 * either way, and the caller decides what to say about it. What is NOT returned
 * is permission to claim a backup: only a save the file system actually
 * accepted updates `lastExportAt`.
 */
export async function exportEverything(options: ExportEverythingOptions): Promise<BuiltArchive> {
  const { storage, filter, files, ...rest } = options;

  const allEntries = await storage.listEntriesChronological();
  const entries = filter ? allEntries.filter((entry) => matchesFilter(entry, filter)) : allEntries;

  const archive = await buildArchive({ ...rest, entries, allEntries, filter });
  const { saved } = await files.save(outgoingArchive(archive));

  // Two conditions, and both are about honesty rather than tidiness.
  //
  // A partial export is not a backup of the journal, so it must not silence the
  // reminder that the whole journal is unbacked.
  //
  // A save the person backed out of is not an export at all. This used to be
  // unconditional, because the saver returned `void` and every dismissal of the
  // dialog looked alike: cancelling recorded a successful export, reset the
  // reminder, and left the journal page saying "Last exported today" over a
  // device that still held the only copy.
  if (!filter && saved) {
    await storage.updateSettings({
      lastExportAt: new Date().toISOString(),
      reminderDismissedAt: undefined,
    });
  }

  return archive;
}
