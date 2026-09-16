/**
 * Whether this runtime can read a compressed archive.
 *
 * THE RISK THIS FILE EXISTS TO KEEP VISIBLE
 *
 * Writing an archive and reading one are not equally supported. `export/zip.ts`
 * degrades when `CompressionStream` is missing — it stores instead of deflating,
 * and still produces a valid, readable archive. Reading has no such fallback:
 * without `DecompressionStream` there is no way to inflate a deflated member,
 * so import fails outright.
 *
 * The consequence is specific and bad: on such a runtime a person could export
 * a journal for years and then be unable to restore it. Not "a degraded
 * experience" — an archive they cannot open on the device that made it.
 *
 * Compression Streams reached WKWebView in iOS 16.4, which is why this is an
 * open question for the native editions rather than a settled one. It is
 * recorded as Spike 1 in docs/ADR-NATIVE-APP-ARCHITECTURE.md and must be
 * answered by measurement on a real device before a native build ships.
 *
 * WHAT THIS MODULE DOES AND DOES NOT DO
 *
 * It centralises the check, so the assumption lives in one place with this
 * explanation attached rather than as a bare `typeof` test in two files. It
 * does NOT solve the problem: no ZIP library is bundled, no polyfill is loaded,
 * and behaviour is unchanged. Solving it is a decision for after the spike,
 * because the honest options — raise the minimum OS, or carry an inflate
 * implementation — have different costs and neither should be chosen by an
 * agent in a hurry.
 */

/** Can this runtime inflate? Reading an archive depends on it. */
export function canDecompress(): boolean {
  return typeof DecompressionStream !== 'undefined';
}

/** Can this runtime deflate? Only affects archive SIZE, never readability. */
export function canCompress(): boolean {
  return typeof CompressionStream !== 'undefined';
}

/**
 * The message shown when an archive cannot be read here.
 *
 * "Device", not "browser": this exact string is reachable inside an installed
 * application, where there is no browser from the reader's point of view.
 */
export const CANNOT_DECOMPRESS =
  'This device cannot open compressed archives, so this file cannot be read here.';

/**
 * Throw unless this runtime can inflate.
 *
 * Called at the point of use rather than at startup, so a runtime that cannot
 * read archives still runs the journal perfectly well — writing, reading and
 * exporting all work. Only import is refused, and only when it is attempted.
 */
export function requireDecompression(): void {
  if (!canDecompress()) throw new Error(CANNOT_DECOMPRESS);
}
