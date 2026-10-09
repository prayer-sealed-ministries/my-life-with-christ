/**
 * Resource ceilings for a complete journal restore.
 *
 * A 50,000-entry synthetic archive measured about 130 MiB in the audit. The
 * input limit leaves almost twice that room; the expanded limit leaves twice
 * again for highly compressible Markdown and JSON. These are safety ceilings,
 * not recommendations, and are intentionally much larger than note-import
 * limits.
 */
export const MAX_JOURNAL_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_JOURNAL_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_JOURNAL_MEMBER_BYTES = 256 * 1024 * 1024;
export const MAX_JOURNAL_ARCHIVE_MEMBERS = 100_000;
// Deflate can legitimately compress long repeated prose/whitespace by roughly
// 1,000:1. The absolute expanded-byte ceilings are the primary defence; this
// catches deliberately impossible metadata without rejecting archives the app
// itself can produce from repetitive notes.
export const MAX_JOURNAL_COMPRESSION_RATIO = 2_000;

export function journalSizeMessage(limit = MAX_JOURNAL_FILE_BYTES): string {
  return `That journal file is larger than the supported ${Math.floor(limit / 1024 / 1024)} MiB limit. Nothing was read or changed.`;
}
