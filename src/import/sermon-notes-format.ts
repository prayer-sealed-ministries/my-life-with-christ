/**
 * What a sermon-notes file IS — the facts a caller needs before reading one.
 *
 * Split out of `sermon-notes.ts` for one reason, and it is a measured one. The
 * share handler runs at startup: `main.tsx` mounts `SharedDocuments`, which
 * reaches `incoming.ts`, which needed exactly two things from the reader — a
 * size limit and a filename-to-format rule. Importing them dragged the entire
 * parser onto the startup path, and once recognition was added it dragged that
 * too, which is how three quarters of a megabyte came back into the chunk the
 * previous lane had just emptied.
 *
 * So: the cheap facts live here, where anything may import them, and the
 * expensive machinery — PDF extraction, text recognition — stays behind
 * `readSermonNotes`, which is only reached when somebody actually imports a
 * file. `sermon-notes.ts` re-exports all of it, so no caller had to change.
 *
 * Nothing here parses anything, and nothing here may grow to.
 */

export type SermonNotesFormat = 'txt' | 'markdown' | 'pdf' | 'docx' | 'sermon-notes-json';

/**
 * The file, before anything is read.
 *
 * Measured rather than guessed. A church handout is a page or two of text: the
 * structured JSON for one is a couple of kilobytes, a Markdown or text version
 * the same, and a text-based sermon PDF from a word processor runs from a few
 * kilobytes to a few hundred once fonts are embedded. 8MB is many times the
 * largest thing anyone should be handed on a Sunday, which leaves room for a
 * badly-made PDF full of images — or a scan — without leaving room for a file
 * that was never a handout.
 *
 * Smaller than the document importer's 25MB on purpose. That one takes a
 * lifetime of somebody's own writing in one file; this takes one sermon.
 */
export const MAX_SERMON_NOTES_BYTES = 8 * 1024 * 1024;

/** Which parser a filename asks for, or nothing if this is not a file we read. */
export function sermonNotesFormat(filename: string): SermonNotesFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return 'sermon-notes-json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (lower.endsWith('.txt')) return 'txt';
  if (lower.endsWith('.pdf')) return 'pdf';
  // Churches hand out Word documents. The route decides authorship, not the
  // file type: anything imported here is somebody else's material and goes to
  // Provided notes, exactly as a .txt or a PDF taken through this door does.
  if (lower.endsWith('.docx')) return 'docx';
  return null;
}

/** Extensions and media types to suggest to a picker. Never a guarantee. */
export const SERMON_NOTES_ACCEPT = [
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.pdf',
  '.docx',
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
