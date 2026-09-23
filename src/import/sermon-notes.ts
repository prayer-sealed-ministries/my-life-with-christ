/**
 * Reading sermon notes a church handed out.
 *
 * Distinct from the document importer beside it, and deliberately so. That one
 * takes files the READER wrote and turns them into journal entries: its output
 * is `notes`, the reader's own words. This one takes material SOMEBODY ELSE
 * wrote and produces `SourceMaterial`, which is kept beside an entry and never
 * inside it. The two share their limits, their filename hygiene and their PDF
 * engine; they must never share a destination field.
 *
 * Nothing here touches storage, and nothing here creates an entry. It turns
 * bytes into a proposal that a person looks at first. A file that cannot be
 * read leaves the journal exactly as it was, because at the point of failure
 * the journal has not been opened.
 *
 * Offline, entirely. The PDF engine is the one already vendored here with
 * every network path switched off; JSON and text are parsed in this file.
 */

import { sha256 } from '../export/zip';
import type { SourceMaterial } from '../types';
import { ImportError, MAX_TEXT_CHARS, describeBytes, safeFilename } from './limits';
/*
 * Re-exported, not redefined.
 *
 * These four facts moved to a module of their own because the share handler
 * needs them at startup and importing them from here dragged the whole parser
 * — and, through it, the PDF engine — onto the path between tapping the widget
 * and typing a sentence. Every caller that imported them from this file goes on
 * doing so. See sermon-notes-format.ts.
 */
import {
  MAX_SERMON_NOTES_BYTES,
  SERMON_NOTES_ACCEPT,
  sermonNotesFormat,
  type SermonNotesFormat,
} from './sermon-notes-format';

export {
  MAX_SERMON_NOTES_BYTES,
  SERMON_NOTES_ACCEPT,
  sermonNotesFormat,
  type SermonNotesFormat,
};
import { hasUsableText, parsePdf } from './pdf';

/** The identifier a structured file must carry to be one of these. */
export const SERMON_NOTES_FORMAT = 'my-life-with-christ-sermon-notes';

/** The only version this build understands. */
export const SERMON_NOTES_VERSION = 1;

/** Bumped whenever extraction changes in a way that alters `body`. */
export const SERMON_NOTES_PARSER_VERSION = 1;

/**
 * The provided text, after parsing.
 *
 * About 200,000 characters — some forty thousand words, or a small book. No
 * sermon handout is near it, and a page that renders it is still a page rather
 * than a hang. Anything longer is refused rather than silently cut, because a
 * truncated outline presented as the church's material would be this feature
 * telling a small lie about somebody else's words.
 */
export const MAX_SERMON_NOTES_CHARS = 200_000;

/** What a file, once read, proposes. Nothing is saved until a person says so. */
export interface SermonNotesProposal {
  material: SourceMaterial;
  /** Metadata the file stated outright, offered to seed the entry's own fields. */
  suggested: {
    title?: string;
    date?: string;
    speaker?: string;
    scripture?: string[];
  };
  /** Pages read, for a PDF. Absent for the other formats. */
  pages?: number;
  /** Characters of provided text, so a preview can say how much there is. */
  characters: number;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** A byte that is valid UTF-8 and is the clearest single sign of a binary file. */
const NUL = String.fromCharCode(0);

/**
 * Bytes to text, refusing anything that was plainly never text.
 *
 * `TextDecoder` with `fatal` rejects invalid UTF-8 outright rather than
 * scattering replacement characters through a church's outline. A NUL byte is
 * checked separately because it decodes perfectly well.
 */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ImportError(
      'That file is not readable text. It may be a different kind of file, or saved in an encoding this app cannot read.',
    );
  }
  if (text.includes(NUL)) {
    throw new ImportError('That file is not readable text. It looks like a binary file.');
  }
  // Normalise line endings so a Windows handout and a Mac one produce the same
  // stored body.
  return text.replace(/\r\n?/g, '\n');
}

// ---------------------------------------------------------------------------
// Structured JSON
// ---------------------------------------------------------------------------

/**
 * Read a structured sermon-notes file.
 *
 * Field by field, never spread. This object came from a file that may not have
 * been written by the church it names, and an entry's provided material must
 * not become a place to smuggle arbitrary keys into the journal — the same
 * reasoning as `migrateSource` in the export migration, for the same reason.
 *
 * Unknown fields are ignored rather than preserved: this is not the journal's
 * own archive format, where dropping a field would lose somebody's writing. It
 * is an interchange format with a stated version, and a church that adds a
 * field this build has never heard of should get the parts it understands
 * rather than a refusal.
 */
export function parseSermonNotesJson(text: string): {
  material: Omit<SourceMaterial, 'filename' | 'importedAt' | 'sha256'>;
  suggested: SermonNotesProposal['suggested'];
} {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ImportError('That file is not valid JSON, so it could not be read.');
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ImportError('That file is not a sermon-notes file.');
  }
  // Own properties only, on an object with no prototype. A literal "__proto__"
  // key survives JSON.parse as an ordinary own property; copying through a
  // null-prototype map makes it unreachable as anything but data, and makes
  // every inherited name (`constructor`, `toString`) read as absent.
  const value: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(raw)) value[key] = item;

  if (value.format !== SERMON_NOTES_FORMAT) {
    throw new ImportError('That file is not a sermon-notes file this app can read.');
  }
  if (typeof value.version !== 'number' || !Number.isInteger(value.version)) {
    throw new ImportError('That sermon-notes file does not say which version it is.');
  }
  if (value.version > SERMON_NOTES_VERSION) {
    throw new ImportError(
      `That file is version ${value.version} of the sermon-notes format, and this app understands version ${SERMON_NOTES_VERSION}. A newer version of the app will read it.`,
    );
  }
  if (value.version < 1) {
    throw new ImportError('That sermon-notes file states a version this app cannot read.');
  }

  const body = optionalText(value.bodyMarkdown);
  if (!body) {
    throw new ImportError('That sermon-notes file has no notes in it.');
  }
  guardLength(body);

  const church = optionalText(value.church);
  const speaker = optionalText(value.speaker);
  const title = optionalText(value.title);
  const date = optionalDate(value.date);
  const scripture = optionalTextList(value.scripture);

  const material: Omit<SourceMaterial, 'filename' | 'importedAt' | 'sha256'> = {
    format: 'sermon-notes-json',
    body,
    parserVersion: SERMON_NOTES_PARSER_VERSION,
  };
  if (church) material.church = church;
  if (speaker) material.speaker = speaker;
  if (date) material.date = date;
  if (scripture.length > 0) material.scripture = scripture;

  const suggested: SermonNotesProposal['suggested'] = {};
  if (title) suggested.title = title;
  if (date) suggested.date = date;
  if (speaker) suggested.speaker = speaker;
  if (scripture.length > 0) suggested.scripture = scripture;

  return { material, suggested };
}

/** A string with something in it, trimmed. Anything else is nothing. */
function optionalText(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.replace(/\r\n?/g, '\n').trim();
  return trimmed ? trimmed : undefined;
}

/** A calendar date, or nothing. Never a guess at what a malformed one meant. */
function optionalDate(raw: unknown): string | undefined {
  const text = optionalText(raw);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? text : undefined;
}

/** Up to a sensible handful of short strings. Anything else is dropped. */
function optionalTextList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => optionalText(item))
    .filter((item): item is string => item !== undefined)
    .map((item) => item.slice(0, 200))
    .slice(0, 25);
}

function guardLength(body: string): void {
  if (body.length > MAX_SERMON_NOTES_CHARS) {
    throw new ImportError(
      `Those notes are ${Math.round(body.length / 1000)},000 characters long, past the ${Math.round(
        MAX_SERMON_NOTES_CHARS / 1000,
      )},000 this app imports. That is far longer than a sermon handout.`,
    );
  }
}

// ---------------------------------------------------------------------------
// The whole thing
// ---------------------------------------------------------------------------

/**
 * What a scan is told, and why it is worded this way.
 *
 * Two facts, in the order a reader needs them: what this file appears to be,
 * and what this app can do about it. The previous wording said only the
 * second, which left somebody holding a photocopy to work out for themselves
 * why a PDF full of words was "not readable".
 *
 * "not available yet" rather than "not supported": recognising text on the
 * device is a real possibility that was measured and deferred on package size,
 * not a thing this product has decided against. See the OCR investigation in
 * the lane report.
 */
const NO_READABLE_TEXT =
  'This PDF appears to contain scanned pages rather than selectable text. ' +
  'Scanned-document text recognition is not available yet.';

/**
 * Read a chosen file into a proposal.
 *
 * Throws `ImportError` with wording written for a person, and nothing else:
 * the underlying message from a malformed PDF is a library's internal string
 * and none of it helps a reader.
 */
export async function readSermonNotes(
  bytes: Uint8Array,
  rawFilename: string,
): Promise<SermonNotesProposal> {
  const filename = safeFilename(rawFilename);
  const format = sermonNotesFormat(filename);
  if (!format) {
    throw new ImportError(
      'Sermon notes can be a .txt, .md, .json or text-based .pdf file. That file is something else.',
    );
  }
  if (bytes.byteLength === 0) {
    throw new ImportError('That file is empty.');
  }
  if (bytes.byteLength > MAX_SERMON_NOTES_BYTES) {
    throw new ImportError(
      `That file is ${describeBytes(bytes.byteLength)}, larger than the ${describeBytes(
        MAX_SERMON_NOTES_BYTES,
      )} limit for sermon notes.`,
    );
  }

  const importedAt = new Date().toISOString();
  const digest = await sha256(bytes);

  if (format === 'pdf') {
    const extraction = await parsePdf(bytes);
    if (!hasUsableText(extraction)) throw new ImportError(NO_READABLE_TEXT);

    // Deterministic page order, with a blank line between pages so a reader can
    // see where one ended. No attempt at columns or visual layout: a PDF has
    // ink at coordinates, not paragraphs, and claiming otherwise would be
    // inventing structure in somebody else's material.
    const body = extraction.pages
      .map((page) => page.text.trim())
      .filter(Boolean)
      .join('\n\n');
    if (!body) throw new ImportError(NO_READABLE_TEXT);
    guardLength(body);

    return {
      material: {
        format: 'pdf',
        filename,
        importedAt,
        sha256: digest,
        body,
        parserVersion: SERMON_NOTES_PARSER_VERSION,
      },
      suggested: {},
      pages: extraction.pages.length + extraction.emptyPages,
      characters: body.length,
    };
  }

  const text = decodeText(bytes);
  if (text.length > MAX_TEXT_CHARS) {
    throw new ImportError('That file holds more text than this app can import.');
  }

  if (format === 'sermon-notes-json') {
    const { material, suggested } = parseSermonNotesJson(text);
    return {
      material: { ...material, filename, importedAt, sha256: digest },
      suggested,
      characters: material.body.length,
    };
  }

  const body = text.trim();
  if (!body) throw new ImportError('That file has no notes in it.');
  guardLength(body);

  // No date, speaker or church is read out of unstructured text. Guessing a
  // church's name from a heading — or from the filename — would put words in
  // somebody's mouth on the record of a life. A structured file states them.
  return {
    material: {
      format,
      filename,
      importedAt,
      sha256: digest,
      body,
      parserVersion: SERMON_NOTES_PARSER_VERSION,
    },
    suggested: {},
    characters: body.length,
  };
}
