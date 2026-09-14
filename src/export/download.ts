/**
 * Handing the archive to the user.
 *
 * Deliberately dumb: build the bytes, hand them over, record that it happened.
 * The whole value of the export is that the resulting file is the user's, sitting
 * on their own disk, needing nothing from us.
 */

import type { StorageProvider } from '../storage/StorageProvider';
import { buildArchive, matchesFilter, type BuildArchiveOptions, type BuiltArchive } from './archive';
import type { ExportFilter } from '../types';

/** Trigger a browser download for an already-built archive. */
export function saveArchive(archive: BuiltArchive): void {
  const blob = new Blob([archive.bytes as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = archive.filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();

  // Give the download a moment to start before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface ExportEverythingOptions
  extends Omit<BuildArchiveOptions, 'entries' | 'allEntries' | 'filter'> {
  storage: StorageProvider;
  filter?: ExportFilter;
}

/**
 * The two-tap path: read the journal, build the archive, save it, and record the
 * export so the reminder resets.
 */
export async function exportEverything(options: ExportEverythingOptions): Promise<BuiltArchive> {
  const { storage, filter, ...rest } = options;

  const allEntries = await storage.listEntriesChronological();
  const entries = filter ? allEntries.filter((entry) => matchesFilter(entry, filter)) : allEntries;

  const archive = await buildArchive({ ...rest, entries, allEntries, filter });
  saveArchive(archive);

  // A partial export is not a backup of the journal, so it must not silence the
  // reminder that the whole journal is unbacked.
  if (!filter) {
    await storage.updateSettings({
      lastExportAt: new Date().toISOString(),
      reminderDismissedAt: undefined,
    });
  }

  return archive;
}
