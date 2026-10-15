/**
 * Every limit the importer enforces, in one file.
 *
 * An imported file is hostile input. It was not written by this app, it may not
 * have been written by the person importing it, and a browser tab is a poor
 * place to discover that a 40KB archive expands to three gigabytes. So the caps
 * live together rather than scattered through four parsers, and each one says
 * what it is protecting against.
 *
 * Every failure is a message a person can act on. None of them is a stack
 * trace, and none names anything about the machine.
 */

/** The file itself, before anything is read. Comfortably larger than a decade of sermon notes. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Extracted text, after parsing.
 *
 * A 25MB DOCX is mostly images; a 25MB *text* payload is something else. This
 * is the ceiling on what any parser may hand back.
 */
export const MAX_TEXT_CHARS = 5_000_000;

/** Candidates offered for review. Beyond this the review screen is the problem. */
export const MAX_CANDIDATES = 500;

/** One note's body. Longer is kept but truncated, with the candidate flagged. */
export const MAX_BODY_CHARS = 200_000;

/**
 * DOCX: the number of members in the archive.
 *
 * A zip bomb does not need to be large. It needs to be numerous, or deeply
 * nested, or both.
 */
export const MAX_ZIP_ENTRIES = 2_000;

/**
 * DOCX: inflated bytes for any SINGLE member.
 *
 * Distinct from the total below on purpose. A ratio check on the whole archive
 * can be satisfied by one benign large member while a second member expands
 * without bound, so both ends are capped: no one part may exceed this…
 */
export const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;

/** …and everything inflated together may not exceed this. */
export const MAX_ZIP_TOTAL_BYTES = 120 * 1024 * 1024;

/** PDF: pages read. Past this the remainder is skipped and the user is told. */
export const MAX_PDF_PAGES = 500;

/*
  Recognising a scanned page is a different cost from reading a typed one.

  Reading text from five hundred pages is a few seconds of parsing. Rendering
  five hundred pages to images and recognising each one is minutes of work and
  a great deal of memory, and it is not what this feature is for: a church
  handout is a few pages, and a five-hundred-page scanned book is somebody
  trying to do something else.

  Twenty is generous for a handout — a bulletin, a study guide, an order of
  service — and small enough that the worst case is bounded. Past it the person
  is told there are more scanned pages than can be read at once, rather than
  being given a partial import nobody mentioned.
*/
export const MAX_SCANNED_PDF_OCR_PAGES = 20;

/**
 * The most pixels a single page may be rendered at.
 *
 * Checked BEFORE allocation, because the allocation is the attack: an RGBA
 * bitmap costs width x height x 4 bytes in the canvas, again when it is
 * encoded, and again crossing the bridge to the recogniser. A page declaring
 * an enormous MediaBox must be refused rather than rendered and regretted.
 *
 * 4.2 megapixels is roughly A4 at 220 dpi, which the resolution study found
 * sufficient for small print; the ceiling is set above the working resolution
 * so an unusually large page is scaled down rather than refused.
 */
export const MAX_PDF_PAGE_PIXELS = 4_200_000;

/**
 * And the most pixels the whole document may be rendered at, across pages.
 *
 * A per-page ceiling alone permits twenty maximum-size pages, which is twenty
 * times the per-page cost. This bounds the document rather than the page.
 */
export const MAX_PDF_TOTAL_PIXELS = 40_000_000;

/** Bumped whenever extraction changes in a way that alters what it produces. */
export const PARSER_VERSION = 1;

/** A size a person can read, for a message about a limit. */
export function describeBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes} bytes`;
}

/**
 * An import failure a person is meant to read.
 *
 * Carries no cause chain on purpose: the underlying error from a malformed PDF
 * or a truncated archive is a library's internal message, sometimes containing
 * offsets or paths, and none of it helps the reader.
 */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/**
 * The user-visible name of a chosen file, and nothing else.
 *
 * Browsers report `File.name` as a bare basename, but this never assumes that.
 * Provenance is written into the journal and travels into every export, so a
 * directory that happens to be in the string — from a drag-and-drop path, a
 * crafted archive member, or a future caller that passes something else — must
 * not be recorded. Both separators are stripped, including a Windows drive
 * prefix, and the result is length-capped.
 */
export function safeFilename(name: string): string {
  // Take the last segment under either separator, so a Windows path and a POSIX
  // one both reduce to the bare name at the end of them.
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    // Control characters have no business in a filename we display.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    /*
      Characters that change what a name LOOKS like without changing what it
      is: the bidirectional overrides and isolates, the zero-width spaces and
      joiners, and the byte-order mark.

      The old trick is a right-to-left override before a reversed extension, so
      that `fdp.exe` displays as `exe.pdf`. Nothing here executes a file, so
      this is not about running something by accident — it is that the name
      goes into the entry's provenance and is shown to a person, and a record
      that reads as one thing while being another is a lie in the archive.
    */
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'imported file';
  return cleaned.slice(0, 200);
}
