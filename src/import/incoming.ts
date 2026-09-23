/**
 * A document arriving from outside the app, on its way to the one importer.
 *
 * Sharing a handout to this app and picking one from the file chooser are the
 * same operation with different doorways. There is therefore no share parser:
 * this module's whole job is to turn what an operating system hands over into
 * the `(bytes, filename)` pair `readSermonNotes` already takes, or to refuse it
 * before any parsing happens.
 *
 * Everything about a shared document is untrusted. The sender chooses the
 * display name and the media type, and neither has to describe the bytes. So
 * the name is sanitised, the type is used only where the name cannot answer,
 * and the bytes themselves settle any disagreement between them.
 *
 * Nothing here decides authorship. A shared document becomes `SourceMaterial`
 * exactly as a picked one does — the church's words, under their own heading,
 * never the reader's notes.
 */

import { ImportError, describeBytes, safeFilename } from './limits';
import {
  MAX_SERMON_NOTES_BYTES,
  sermonNotesFormat,
  type SermonNotesFormat,
} from './sermon-notes-format';

/**
 * What a platform hands over, and the whole of it.
 *
 * Deliberately not a URI, a path, a File or a handle. A `content://` URI is
 * meaningful only inside the process that was granted it and only for as long
 * as that grant lasts; letting one reach the shared importer would put an
 * Android lifetime rule inside code that also runs in a browser. The platform
 * reads the bytes while it still can, and this is what crosses.
 */
export interface IncomingDocument {
  /** The sender's display name. Untrusted; sanitised before use. */
  name: string;
  /** The sender's media type. Untrusted; a hint, never a verdict. */
  mimeType: string;
  bytes: Uint8Array;
}

/**
 * The media types this build will accept from the system.
 *
 * Derived from what the sermon-notes importer actually parses, which is txt,
 * markdown, the structured sermon JSON, and a text-based PDF. DOCX is absent
 * on purpose: `src/import/docx.ts` belongs to the document importer, which
 * turns a lifetime of writing into many entry candidates, and is a different
 * feature with different semantics.
 *
 * Registering for more than this would put the app in the share sheet for
 * files it cannot read, so every extra type is a promise broken at the moment
 * somebody takes it up.
 */
export const SHARED_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'application/json',
  'application/pdf',
] as const;

/** Where a media type can stand in for a missing or unhelpful extension. */
const EXTENSION_FOR_MIME: Record<string, string> = {
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/x-markdown': '.md',
  'application/json': '.json',
  'text/json': '.json',
  'application/pdf': '.pdf',
};

/** `%PDF-`, which every PDF starts with. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];

function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PDF_SIGNATURE.length) return false;
  return PDF_SIGNATURE.every((byte, at) => bytes[at] === byte);
}

/** The media type, lowercased and stripped of any `; charset=` parameters. */
function baseMime(raw: string): string {
  return (raw ?? '').split(';')[0].trim().toLowerCase();
}

export interface AcceptedDocument {
  bytes: Uint8Array;
  /** What to hand `readSermonNotes`, so it picks the same parser as a pick would. */
  filename: string;
  format: SermonNotesFormat;
}

/**
 * Turn an incoming document into something the importer can read, or refuse it.
 *
 * Refusals are `ImportError`, the same class the picker path raises, so a
 * caller shows the same wording in the same place however the file arrived.
 *
 * This does NOT parse. Everything past this point — decoding, the NUL check,
 * the JSON schema, the PDF text extraction, the character limit — is
 * `readSermonNotes`, unchanged and shared. The checks here are only the ones
 * that need the envelope: a size, a name, a media type, and enough of the
 * bytes to catch an envelope that lies about them.
 */
export function acceptIncomingDocument(incoming: IncomingDocument): AcceptedDocument {
  const bytes = incoming.bytes;

  if (!bytes || bytes.byteLength === 0) {
    throw new ImportError('That file is empty.');
  }
  // Before anything else reads it. A refusal by size must cost a length check
  // and nothing more.
  if (bytes.byteLength > MAX_SERMON_NOTES_BYTES) {
    throw new ImportError(
      `That file is ${describeBytes(bytes.byteLength)}, larger than the ${describeBytes(
        MAX_SERMON_NOTES_BYTES,
      )} limit for sermon notes.`,
    );
  }

  const name = safeFilename(incoming.name ?? '');
  const mime = baseMime(incoming.mimeType ?? '');

  // The name first, because that is what the file-chooser path uses and the two
  // doorways must reach the same parser for the same file.
  let format = sermonNotesFormat(name);
  let filename = name;

  // A sender may hand over a name with no extension at all — a mail attachment
  // saved as "sermon", a provider that names by document title. Then, and only
  // then, the media type says which parser to use, and the name gains the
  // extension that states it.
  if (!format) {
    const extension = EXTENSION_FOR_MIME[mime];
    if (extension) {
      format = sermonNotesFormat(extension);
      filename = `${name}${extension}`;
    }
  }

  if (!format) {
    throw new ImportError(
      'Sermon notes can be a .txt, .md, .json or text-based .pdf file. That file is something else.',
    );
  }

  // Where the envelope and the bytes disagree, the bytes win — and the
  // disagreement is reported rather than quietly worked around. A PDF renamed
  // `.txt` would otherwise fail later with "that file is not text", which is
  // true and unhelpful.
  const isPdf = looksLikePdf(bytes);
  if (format === 'pdf' && !isPdf) {
    throw new ImportError('That file is named as a PDF but its contents are not a PDF.');
  }
  if (format !== 'pdf' && isPdf) {
    throw new ImportError(`That file is a PDF. Share it as a PDF and it can be read.`);
  }

  return { bytes, filename, format };
}
