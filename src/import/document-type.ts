/**
 * What a file actually is, decided before any parser is trusted with it.
 *
 * THE RULE
 *
 * A name is a claim. A picker filter is a convenience. A MIME type is a hint
 * from software that was itself told. None of them are evidence about bytes,
 * and until this module existed the import path decided which parser to run
 * from the filename extension alone — so a file called `notes.pdf` reached
 * pdf.js whatever was inside it.
 *
 * A strong verdict here means "safe enough for the specific local parser we
 * are about to hand this to", not "the first four bytes looked plausible".
 * Agreement is required between the claimed type, the byte signature, the
 * structure of the format, and — for PDF and DOCX — the parser itself.
 *
 * Everything fails closed. A check that cannot reach a conclusion rejects.
 *
 * ORDER, AND WHY
 *
 * Cheapest first, so a 25 MB executable named `.pdf` is refused by reading
 * five bytes rather than by feeding it to a document parser to find out.
 *
 *   size → claimed extension → MIME agreement → signature at offset 0 →
 *   container structure → format structure → parser
 *
 * MIME IS EVIDENCE ONLY WHEN IT SAYS SOMETHING
 *
 * Operating-system file providers routinely return nothing, an empty string,
 * or `application/octet-stream`. Treating that as disagreement would refuse
 * ordinary files on ordinary phones. So a specific, recognised MIME type must
 * agree with the bytes; anything else is simply no evidence, and the bytes
 * decide. MIME never overrides bytes in either direction.
 */

import { ImportError } from './limits';
import { DecompressionLimit, listZipPaths, readZipLimited } from './zip-limits';

/**
 * Ceilings for the structural parts of a Word package.
 *
 * Far tighter than the journal-archive limits, because these parts are known
 * quantities: a content-types declaration and a root relationship list are a
 * few kilobytes in every real document ever produced. Giving them the generous
 * allowance a journal export needs would be giving away protection for nothing.
 */
const MAX_OPC_PART_BYTES = 8 * 1024 * 1024;
const MAX_OPC_TOTAL_BYTES = 16 * 1024 * 1024;

/** What this application knows how to read. */
/**
 * What this application knows how to read.
 *
 * Deliberately the same words the import paths already use (`txt`, not
 * `text`), so a verdict can be compared with an `ImportFormat` directly. Two
 * vocabularies for one idea is a translation layer, and a translation layer is
 * somewhere for a mismatch to hide.
 */
export type DocumentKind = 'pdf' | 'docx' | 'txt' | 'markdown' | 'sermon-notes-json' | 'unknown';

/**
 * Why a file was refused, for the code rather than for the reader.
 *
 * Kept separate from the message on purpose: the person is told plainly that
 * nothing was imported, and is not shown which internal gate fired or what the
 * file was found to contain.
 */
export type TypeRejection =
  | 'type-mismatch'
  | 'malformed'
  | 'unsupported-feature'
  | 'active-content'
  | 'encrypted'
  | 'resource-limit';

export interface TypeVerdict {
  /** What the bytes were found to be. `unknown` whenever `ok` is false. */
  kind: DocumentKind;
  ok: boolean;
  rejection?: TypeRejection;
  /** Content-free wording for the person. Never names a gate or a payload. */
  message?: string;
}

const ok = (kind: DocumentKind): TypeVerdict => ({ kind, ok: true });
const no = (rejection: TypeRejection, message: string): TypeVerdict => ({
  kind: 'unknown',
  ok: false,
  rejection,
  message,
});

/* ── wording ─────────────────────────────────────────────────────────────── */

export const TYPE_MESSAGES = {
  pdfMismatch:
    'This file is named as a PDF, but its contents are not a supported PDF. Nothing was imported.',
  docxMismatch:
    'This file is named as a Word document, but its contents are not a supported .docx file. Nothing was imported.',
  macroWord:
    'This Word document contains features this app doesn\u2019t import safely. Save a copy as a standard .docx file without macros and try again.',
  damaged: 'This document appears to be damaged and couldn’t be read. Nothing was imported.',
  // The encrypted case is detected by the parser, which is the only thing that
  // can tell a locked document from a broken one, so its wording lives beside
  // that detection in `pdf.ts` — one sentence rather than two that can drift.
  activePdf:
    'This PDF contains interactive features this app doesn’t open. Nothing was imported.',
} as const;

/* ── claimed type ────────────────────────────────────────────────────────── */

const BY_EXTENSION: Record<string, DocumentKind> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'txt',
  text: 'txt',
  md: 'markdown',
  markdown: 'markdown',
  json: 'sermon-notes-json',
};

/** What the name claims. Nothing more than a claim. */
export function claimedKind(filename: string): DocumentKind {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[extension] ?? 'unknown';
}

/* ── MIME, as a hint ─────────────────────────────────────────────────────── */

const BY_MIME: Record<string, DocumentKind> = {
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'application/json': 'sermon-notes-json',
  'text/json': 'sermon-notes-json',
};

/**
 * What a specific MIME type would mean, or null when it says nothing.
 *
 * Null is the common case and is not a failure: an empty type, a generic
 * `application/octet-stream`, and anything unrecognised all mean the provider
 * declined to tell us, which is not the same as telling us something wrong.
 */
export function mimeKind(mimeType?: string): DocumentKind | null {
  if (!mimeType) return null;
  const value = mimeType.split(';')[0].trim().toLowerCase();
  if (!value || value === 'application/octet-stream' || value === 'application/binary') return null;
  return BY_MIME[value] ?? null;
}

/**
 * Which family a kind belongs to, for deciding what disagreement means.
 *
 * `txt`, `markdown` and `sermon-notes-json` are one family because they are
 * the same bytes read by the same decoder; PDF and DOCX are each their own,
 * because each is a container handed to a parser that interprets structure.
 */
function typeFamily(kind: DocumentKind): 'pdf' | 'docx' | 'text' | 'unknown' {
  if (kind === 'pdf') return 'pdf';
  if (kind === 'docx') return 'docx';
  if (kind === 'unknown') return 'unknown';
  return 'text';
}

/* ── byte signatures ─────────────────────────────────────────────────────── */

export type Signature = 'pdf' | 'zip' | 'ole' | 'executable' | 'other';

const startsWith = (bytes: Uint8Array, ...prefix: number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

/**
 * What the first bytes say, read at offset zero and nowhere else.
 *
 * Offset zero is the whole point. `%PDF-` appearing somewhere inside a file is
 * exactly what a polyglot arranges; a PDF that a reader will open begins with
 * it. The same reasoning applies to `PK`: a ZIP with an executable stub in
 * front of it is not a Word document.
 */
export function signatureOf(bytes: Uint8Array): Signature {
  if (startsWith(bytes, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'pdf'; // %PDF-
  if (startsWith(bytes, 0x50, 0x4b, 0x03, 0x04)) return 'zip';
  // An empty or single-entry archive still begins with a local header; the
  // central-directory-only spellings are not something a .docx arrives as.
  if (startsWith(bytes, 0x50, 0x4b, 0x05, 0x06) || startsWith(bytes, 0x50, 0x4b, 0x07, 0x08)) {
    return 'zip';
  }
  if (startsWith(bytes, 0xd0, 0xcf, 0x11, 0xe0)) return 'ole'; // legacy .doc, .xls
  if (startsWith(bytes, 0x4d, 0x5a)) return 'executable'; // MZ / PE
  if (startsWith(bytes, 0x7f, 0x45, 0x4c, 0x46)) return 'executable'; // ELF
  if (startsWith(bytes, 0xcf, 0xfa, 0xed, 0xfe) || startsWith(bytes, 0xce, 0xfa, 0xed, 0xfe)) {
    return 'executable'; // Mach-O
  }
  return 'other';
}

/* ── PDF structure ───────────────────────────────────────────────────────── */

/** Versions a current reader produces, and that pdf.js opens. */
const PDF_VERSIONS = ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2.0'];

/**
 * How much benign rubbish may follow the final `%%EOF`.
 *
 * Writers legitimately end with a newline, and some end with none. What may
 * not follow is a payload: an appended executable, a second container, a page
 * of HTML. The allowance is whitespace only, and a short run of it.
 */
const MAX_PDF_TAIL_BYTES = 64;

const ascii = (bytes: Uint8Array, start: number, length: number): string => {
  let out = '';
  for (let i = start; i < Math.min(start + length, bytes.length); i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
};

/** Index of the last occurrence of an ASCII needle, or -1. */
function lastIndexOfAscii(bytes: Uint8Array, needle: string): number {
  const codes = [...needle].map((c) => c.charCodeAt(0));
  outer: for (let start = bytes.length - codes.length; start >= 0; start -= 1) {
    for (let i = 0; i < codes.length; i += 1) {
      if (bytes[start + i] !== codes[i]) continue outer;
    }
    return start;
  }
  return -1;
}

/**
 * Is this a structurally plausible PDF, before pdf.js is asked?
 *
 * Three things, each of which a real PDF has and a disguised file does not:
 * the header at offset zero with a version this build supports, a final
 * `%%EOF`, and nothing of substance after it.
 *
 * The LAST `%%EOF` is the one that counts, which is what keeps incremental
 * updates — a perfectly ordinary thing for a church handout that has been
 * edited and re-saved — from being mistaken for an appended payload.
 */
export function inspectPdfStructure(bytes: Uint8Array): TypeVerdict {
  if (signatureOf(bytes) !== 'pdf') return no('type-mismatch', TYPE_MESSAGES.pdfMismatch);

  const version = ascii(bytes, 5, 3);
  if (!PDF_VERSIONS.includes(version)) return no('type-mismatch', TYPE_MESSAGES.pdfMismatch);

  const eof = lastIndexOfAscii(bytes, '%%EOF');
  if (eof === -1) return no('malformed', TYPE_MESSAGES.damaged);

  const tail = bytes.subarray(eof + 5);
  if (tail.length > MAX_PDF_TAIL_BYTES) {
    return no('type-mismatch', TYPE_MESSAGES.pdfMismatch);
  }
  for (const byte of tail) {
    // Space, tab, CR, LF, form feed, NUL-padding some writers emit.
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0d && byte !== 0x0a && byte !== 0x0c && byte !== 0x00) {
      return no('type-mismatch', TYPE_MESSAGES.pdfMismatch);
    }
  }

  // Every PDF a reader opens has a cross-reference pointer, in both the
  // classic and the cross-reference-stream spellings.
  if (lastIndexOfAscii(bytes, 'startxref') === -1) {
    return no('malformed', TYPE_MESSAGES.damaged);
  }

  return ok('pdf');
}

/* ── the verdict ─────────────────────────────────────────────────────────── */

export interface DocumentInput {
  name: string;
  bytes: Uint8Array;
  /** Untrusted, optional, and frequently absent or generic. */
  mimeType?: string;
}

/**
 * Decide what a file is, as far as bytes and structure can say.
 *
 * The parser has the last word for PDF and DOCX and is run by the caller
 * afterwards; this is everything that can be known cheaply and must agree
 * before a parser is handed the file at all.
 */
export function classifyDocument(input: DocumentInput): TypeVerdict {
  const { name, bytes, mimeType } = input;

  if (bytes.byteLength === 0) return no('malformed', TYPE_MESSAGES.damaged);

  const claimed = claimedKind(name);
  if (claimed === 'unknown') {
    return no('type-mismatch', 'This app does not import that kind of file. Nothing was imported.');
  }

  /*
    A specific MIME type that disagrees with the name is a mismatch before a
    single byte of content is considered — but "disagrees" has to mean
    something real.

    Within the text family it does not. A `.json` handed over as `text/plain`,
    a `.md` as `text/plain`, a `.txt` as `text/markdown`: all of these happen
    constantly, all are true statements about the bytes, and none of them is
    evidence of deception. There is also nothing to protect — a text file is
    decoded as text whichever of those names it arrives under, and the
    extension is what chooses the reader.

    Where it means a great deal is across families. PDF and DOCX each hand
    bytes to a parser whose job is to interpret structure, so a provider
    calling one of them by the other's name, or by a text name, is a
    disagreement worth refusing on.
  */
  const hinted = mimeKind(mimeType);
  if (hinted !== null && typeFamily(hinted) !== typeFamily(claimed)) {
    return no(
      'type-mismatch',
      claimed === 'pdf'
        ? TYPE_MESSAGES.pdfMismatch
        : claimed === 'docx'
          ? TYPE_MESSAGES.docxMismatch
          : 'This file’s name and its contents do not agree. Nothing was imported.',
    );
  }

  const signature = signatureOf(bytes);

  if (claimed === 'pdf') {
    if (signature !== 'pdf') return no('type-mismatch', TYPE_MESSAGES.pdfMismatch);
    return inspectPdfStructure(bytes);
  }

  if (claimed === 'docx') {
    // A legacy .doc renamed is the common honest mistake, and it gets the
    // wording that tells somebody what to do about it.
    if (signature === 'ole') return no('type-mismatch', TYPE_MESSAGES.docxMismatch);
    if (signature !== 'zip') return no('type-mismatch', TYPE_MESSAGES.docxMismatch);
    // The package itself is inspected asynchronously; see `inspectDocxPackage`.
    return ok('docx');
  }

  // Text, Markdown and the structured sermon-notes JSON are decided by their
  // decoded content rather than by a signature, which they do not have. What
  // matters here is that they are not something else wearing a text name.
  if (signature === 'executable' || signature === 'ole') {
    return no('type-mismatch', 'This file’s name and its contents do not agree. Nothing was imported.');
  }
  if (signature === 'pdf' || signature === 'zip') {
    return no('type-mismatch', 'This file’s name and its contents do not agree. Nothing was imported.');
  }

  return ok(claimed);
}

/** Refuse, as the error the import paths already raise. */
export function refuse(verdict: TypeVerdict): never {
  throw new ImportError(verdict.message ?? TYPE_MESSAGES.damaged);
}


/* -- DOCX: the package, not just the container -------------------------- */

/**
 * A ZIP is not a Word document.
 *
 * The container signature says only that somebody zipped something. An Open
 * Packaging Convention package that Word produced says three further things,
 * and all three are checked, because each is a way a file can claim to be a
 * document while being something else:
 *
 *   `[Content_Types].xml` declares what the parts ARE. Without it the package
 *   has never said that its main part is a Word document at all.
 *
 *   `_rels/.rels` names the package's official starting point. A package whose
 *   root relationship points somewhere else is not a document we can read, and
 *   following it would mean reading a part nobody declared.
 *
 *   The main part's content type must be the ordinary, NON-MACRO
 *   WordprocessingML document type. The macro-enabled spelling is a different
 *   type, so a `.docm` renamed to `.docx` is caught by what the package says
 *   about itself rather than by the extension that was already a lie.
 *
 * Nothing in the package is executed, nothing external is fetched, and only
 * the small structural parts plus the document body are ever inflated.
 */

/** The ordinary Word main-document content type. */
export const WORD_MAIN_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

/** The macro-enabled spelling. Recognised in order to be refused. */
export const WORD_MACRO_MAIN_TYPE =
  'application/vnd.ms-word.document.macroEnabled.main+xml';

export const CONTENT_TYPES_PATH = '[Content_Types].xml';
export const ROOT_RELS_PATH = '_rels/.rels';
export const MAIN_DOCUMENT_PATH = 'word/document.xml';

/** The relationship type of a package's main Office document part. */
export const OFFICE_DOCUMENT_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

/**
 * Package members that mean "this document wants to run something".
 *
 * Ordinary images are deliberately absent: church handouts are full of logos
 * and photographs, the text parser never opens them, and refusing them would
 * refuse the very documents this feature exists to read.
 */
export const ACTIVE_MEMBERS = [
  'word/vbaproject.bin',
  'word/vbadata.xml',
  'customui/',
  'word/activex/',
];

/**
 * Normalise a ZIP member path for comparison.
 *
 * No member here ever becomes a file system path, so this is not about writing
 * outside a directory - it is about two readers disagreeing about which member
 * is which. `word/document.xml`, `word/./document.xml` and `WORD\\DOCUMENT.XML`
 * must not be three different answers to "where is the document body", because
 * that disagreement is how a package gets one part past a check and hands a
 * different one to the parser.
 */
export function normaliseMemberPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/\.\//g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}

/** Is this member name one no legitimate package would carry? */
export function memberPathIsUnsafe(path: string): boolean {
  const normalised = normaliseMemberPath(path);
  if (normalised.startsWith('/')) return true;
  if (/^[a-z]:/.test(normalised)) return true;
  if (normalised.split('/').includes('..')) return true;
  // Control characters, including the NUL a truncating reader would stop at.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(path)) return true;
  return false;
}

/**
 * Inspect a .docx package before the Word parser is trusted with it.
 *
 * Reads four small members and nothing else: the content types, the root
 * relationships, and (only to confirm it exists) the document body. Embedded
 * images, fonts, headers and anything else in the package are never inflated,
 * because nothing here needs them and inflating them is pure cost and pure
 * risk.
 */
export async function inspectDocxPackage(bytes: Uint8Array): Promise<TypeVerdict> {
  const wanted = new Set([
    normaliseMemberPath(CONTENT_TYPES_PATH),
    normaliseMemberPath(ROOT_RELS_PATH),
    normaliseMemberPath(MAIN_DOCUMENT_PATH),
  ]);

  let members: Awaited<ReturnType<typeof readZipLimited>>;
  let names: string[];
  try {
    // Two passes, both bounded. The first is a names-only walk of the central
    // directory, which costs nothing and is where an unsafe path or an active
    // member is refused before anything is inflated at all.
    names = await listZipPaths(bytes);
    for (const path of names) {
      if (memberPathIsUnsafe(path)) return no('malformed', TYPE_MESSAGES.damaged);
    }
    const seen = new Set<string>();
    for (const path of names) {
      const normalised = normaliseMemberPath(path);
      // Two members that normalise to one name is a parser differential
      // waiting to happen: one reader takes the first, another the second.
      if (seen.has(normalised)) return no('malformed', TYPE_MESSAGES.damaged);
      seen.add(normalised);
      if (ACTIVE_MEMBERS.some((active) => normalised === active || normalised.startsWith(active))) {
        return no('unsupported-feature', TYPE_MESSAGES.macroWord);
      }
    }

    members = await readZipLimited(bytes, {
      only: (path) => wanted.has(normaliseMemberPath(path)),
      maxEntryBytes: MAX_OPC_PART_BYTES,
      maxTotalBytes: MAX_OPC_TOTAL_BYTES,
    });
  } catch (cause) {
    // A damaged or hostile container is refused as a damaged document. The
    // library's own wording never reaches the person.
    if (cause instanceof DecompressionLimit) return no('resource-limit', TYPE_MESSAGES.damaged);
    return no('malformed', TYPE_MESSAGES.damaged);
  }

  const find = (path: string) =>
    members.find((entry) => normaliseMemberPath(entry.path) === normaliseMemberPath(path));

  const contentTypes = find(CONTENT_TYPES_PATH);
  const rootRels = find(ROOT_RELS_PATH);
  const document = find(MAIN_DOCUMENT_PATH);

  // All three, not just the body. Requiring only word/document.xml is what
  // lets any hand-made ZIP claim to be Word.
  if (!contentTypes || !rootRels || !document) {
    return no('type-mismatch', TYPE_MESSAGES.docxMismatch);
  }

  const typesXml = decodeStructuralXml(contentTypes.bytes);
  const relsXml = decodeStructuralXml(rootRels.bytes);
  if (typesXml === null || relsXml === null) {
    // A document type declaration in a structural part has no legitimate use
    // here, and entity expansion is a class of problem worth never entering.
    return no('unsupported-feature', TYPE_MESSAGES.damaged);
  }

  if (MACRO_HINTS.some((hint) => typesXml.toLowerCase().includes(hint))) {
    return no('unsupported-feature', TYPE_MESSAGES.macroWord);
  }

  // The package must declare the body as the ordinary Word main document.
  const declared = declaredContentType(typesXml, MAIN_DOCUMENT_PATH);
  if (declared === null) return no('type-mismatch', TYPE_MESSAGES.docxMismatch);
  if (declared.toLowerCase() === WORD_MACRO_MAIN_TYPE.toLowerCase()) {
    return no('unsupported-feature', TYPE_MESSAGES.macroWord);
  }
  if (declared.toLowerCase() !== WORD_MAIN_TYPE.toLowerCase()) {
    return no('type-mismatch', TYPE_MESSAGES.docxMismatch);
  }

  // And the package's official starting point must be that same body.
  const target = officeDocumentTarget(relsXml);
  if (target === null) return no('type-mismatch', TYPE_MESSAGES.docxMismatch);
  if (normaliseMemberPath(target.replace(/^\//, '')) !== normaliseMemberPath(MAIN_DOCUMENT_PATH)) {
    return no('type-mismatch', TYPE_MESSAGES.docxMismatch);
  }
  if (/^[a-z]+:\/\//i.test(target) || target.toLowerCase().startsWith('file:')) {
    // An external starting point would mean fetching somebody else's server to
    // read a church handout. There is no version of that this app does.
    return no('unsupported-feature', TYPE_MESSAGES.docxMismatch);
  }

  return ok('docx');
}

/** Content types whose presence anywhere means macros. */
const MACRO_HINTS = [
  'application/vnd.ms-office.vbaproject',
  'application/vnd.ms-word.document.macroenabled',
  'application/vnd.ms-word.template.macroenabledtemplate',
];

/**
 * Decode a small structural XML part, refusing a DTD outright.
 *
 * The Word parser already avoids a full entity-resolving stack, and this keeps
 * the structural parts to the same rule: there is no product reason for a
 * `<!DOCTYPE` or an `<!ENTITY` in a content-types or relationships part, and
 * every reason not to begin interpreting one.
 */
function decodeStructuralXml(bytes: Uint8Array): string | null {
  const xml = new TextDecoder().decode(bytes);
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) return null;
  return xml;
}

/** What `[Content_Types].xml` says a given part is. */
export function declaredContentType(typesXml: string, partPath: string): string | null {
  const want = '/' + normaliseMemberPath(partPath);
  const override = new RegExp(
    '<Override\\b[^>]*PartName\\s*=\\s*"([^"]*)"[^>]*ContentType\\s*=\\s*"([^"]*)"',
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = override.exec(typesXml)) !== null) {
    if (normaliseMemberPath(match[1]) === want) return match[2];
  }
  // A package may instead declare the extension by default. Word does not do
  // this for the main document, but a hand-built package might try.
  const extension = partPath.split('.').pop()?.toLowerCase() ?? '';
  const byDefault = new RegExp(
    '<Default\\b[^>]*Extension\\s*=\\s*"([^"]*)"[^>]*ContentType\\s*=\\s*"([^"]*)"',
    'gi',
  );
  while ((match = byDefault.exec(typesXml)) !== null) {
    if (match[1].toLowerCase() === extension) return match[2];
  }
  return null;
}

/** Where `_rels/.rels` says the main Office document lives. */
export function officeDocumentTarget(relsXml: string): string | null {
  const relationship = /<Relationship\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = relationship.exec(relsXml)) !== null) {
    const tag = match[0];
    const type = /Type\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    if (type.toLowerCase() !== OFFICE_DOCUMENT_REL.toLowerCase()) continue;
    const mode = /TargetMode\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? '';
    // An External starting point is refused by the caller; reporting it as-is
    // keeps the decision in one place.
    if (mode.toLowerCase() === 'external') return 'external:';
    return /Target\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? null;
  }
  return null;
}
