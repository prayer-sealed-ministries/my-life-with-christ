/**
 * A chosen file, turned into notes a person can look at before anything is
 * written down.
 *
 * Nothing in this module touches storage. That is the whole design: parsing
 * produces a proposal, the proposal is reviewed, and only then does
 * `commit.ts` write. "I guessed and already changed your journal" is the
 * outcome this file exists to make impossible.
 */

import { sha256 } from '../export/zip';
import type { Entry, EntryKind, EntrySource, ScriptureRef } from '../types';
import { detectDate, detectKind, detectReferences, labelRef, type DetectedRef } from './detect';
import { docxToText, parseDocx } from './docx';
import {
  ImportError,
  MAX_BODY_CHARS,
  MAX_CANDIDATES,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  PARSER_VERSION,
  describeBytes,
  safeFilename,
} from './limits';
import { hasUsableText, parsePdf } from './pdf';
import { splitMarkdown, splitText, type Section } from './segment';

export type ImportFormat = EntrySource['format'];

/** Why a candidate wants a human eye. Never colour alone in the UI — these are words. */
export type ReviewReason =
  | 'no-date'
  | 'uncertain-date'
  | 'uncertain-kind'
  | 'no-title'
  | 'body-truncated'
  | 'multiple-refs';

export interface Candidate {
  /** Stable within this parse, so React keys and selection survive edits. */
  id: string;
  include: boolean;
  title: string;
  date: string;
  kind: EntryKind;
  /** The chosen primary reference, if any. */
  ref?: ScriptureRef;
  /** Everything found, so a second reference is never lost by choosing a first. */
  detectedRefs: DetectedRef[];
  body: string;
  page?: number;
  reasons: ReviewReason[];
  /** sha-256 of the normalized body, for duplicate detection. */
  fingerprint: string;
}

export interface ParsedDocument {
  filename: string;
  format: ImportFormat;
  /** sha-256 of the file's bytes, so re-importing the same file is noticed. */
  fileFingerprint: string;
  candidates: Candidate[];
  /** Counts for the summary line, computed once here rather than in the view. */
  stats: { notes: number; references: number; dates: number; needReview: number };
  /** Things the reader should know, in plain words. */
  notices: string[];
}

const EXTENSIONS: Record<string, ImportFormat> = {
  txt: 'txt',
  text: 'txt',
  md: 'markdown',
  markdown: 'markdown',
  docx: 'docx',
  pdf: 'pdf',
};

export function formatFromName(filename: string): ImportFormat | null {
  const extension = safeFilename(filename).split('.').pop()?.toLowerCase() ?? '';
  return EXTENSIONS[extension] ?? null;
}

/** Normalized for comparison: whitespace and case are not content. */
const canonicalBody = (body: string): string => body.replace(/\s+/g, ' ').trim().toLowerCase();

async function toCandidate(
  section: Section,
  index: number,
  page: number | undefined,
): Promise<Candidate> {
  const reasons: ReviewReason[] = [];

  let body = section.body;
  if (body.length > MAX_BODY_CHARS) {
    body = body.slice(0, MAX_BODY_CHARS);
    reasons.push('body-truncated');
  }

  // The title line is part of the note's text for detection purposes: a date or
  // a reference in the heading counts.
  const haystack = `${section.title}\n${body}`;

  const detectedRefs = detectReferences(haystack);
  if (detectedRefs.length > 1) reasons.push('multiple-refs');

  const foundDate = detectDate(haystack);
  if (!foundDate) reasons.push('no-date');
  else if (!foundDate.confident) reasons.push('uncertain-date');

  const foundKind = detectKind(section.title, body);
  if (!foundKind.confident) reasons.push('uncertain-kind');

  const title = section.title.trim();
  if (!title) reasons.push('no-title');

  return {
    id: `candidate-${index}`,
    include: true,
    title,
    // Empty rather than today's date: an invented date is a false fact, and the
    // field is editable. The review screen says which notes have none.
    date: foundDate?.date ?? '',
    kind: foundKind.kind,
    ref: detectedRefs[0]?.ref,
    detectedRefs,
    body,
    page,
    reasons,
    fingerprint: await sha256(canonicalBody(haystack)),
  };
}

/**
 * Read a file into candidates. Writes nothing, fetches nothing.
 *
 * @param bytes the file's contents, already read by the caller
 * @param rawName the name the browser reported
 */
export async function parseDocument(bytes: Uint8Array, rawName: string): Promise<ParsedDocument> {
  const filename = safeFilename(rawName);
  const format = formatFromName(filename);
  if (!format) {
    throw new ImportError(
      'That file type is not supported yet. Import handles .txt, .md, .docx and text-based .pdf files.',
    );
  }
  if (bytes.byteLength === 0) {
    throw new ImportError('That file is empty.');
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ImportError(
      `That file is ${describeBytes(bytes.byteLength)}, larger than the ${describeBytes(MAX_FILE_BYTES)} import limit.`,
    );
  }

  const notices: string[] = [];
  const fileFingerprint = await sha256(bytes);
  const fallbackTitle = filename.replace(/\.[^.]+$/, '');

  let sections: Section[];
  const pageOf = new Map<number, number>();

  if (format === 'pdf') {
    const extraction = await parsePdf(bytes);
    if (!hasUsableText(extraction)) {
      throw new ImportError(
        'This PDF appears to contain scanned pages rather than selectable text. Scanned-PDF import is not supported yet.',
      );
    }
    if (extraction.truncated) {
      notices.push('This PDF is very long; only the first pages were read.');
    }
    if (extraction.emptyPages > 0) {
      notices.push(
        `${extraction.emptyPages} ${extraction.emptyPages === 1 ? 'page' : 'pages'} had no selectable text and produced nothing.`,
      );
    }
    notices.push('PDF text extraction is imperfect. Please check the wording before importing.');

    // One note per page is wrong for a book and wrong for a single sermon, so
    // the pages are joined and segmented like any other text. The page a note
    // started on is kept for provenance.
    const joined = extraction.pages.map((page) => page.text).join('\n\n');
    sections = splitText(joined, fallbackTitle);

    // Map each section back to the page its opening text came from.
    let cursor = 0;
    for (const [index, section] of sections.entries()) {
      const at = joined.indexOf(section.body.slice(0, 40), cursor);
      if (at >= 0) cursor = at;
      let offset = 0;
      for (const page of extraction.pages) {
        offset += page.text.length + 2;
        if (cursor < offset) {
          pageOf.set(index, page.page);
          break;
        }
      }
    }
  } else {
    let text: string;
    if (format === 'docx') {
      text = docxToText(await parseDocx(bytes));
    } else {
      text = new TextDecoder().decode(bytes);
    }

    if (text.length > MAX_TEXT_CHARS) {
      throw new ImportError('That file contains more text than can be imported at once.');
    }
    if (!text.trim()) {
      throw new ImportError('That file has no text in it.');
    }

    sections =
      format === 'markdown' || format === 'docx'
        ? splitMarkdown(text, fallbackTitle)
        : splitText(text, fallbackTitle);
  }

  if (sections.length === 0) {
    throw new ImportError('That file has no text in it.');
  }
  if (sections.length > MAX_CANDIDATES) {
    notices.push(
      `This file produced more than ${MAX_CANDIDATES} notes; only the first ${MAX_CANDIDATES} are offered.`,
    );
    sections = sections.slice(0, MAX_CANDIDATES);
  }
  if (sections.length === 1 && sections[0].via === 'whole-document') {
    notices.push(
      'No clear divisions were found, so this is offered as one note rather than split into pieces.',
    );
  }

  const candidates = await Promise.all(
    sections.map((section, index) => toCandidate(section, index, pageOf.get(index))),
  );

  return {
    filename,
    format,
    fileFingerprint,
    candidates,
    stats: {
      notes: candidates.length,
      references: candidates.filter((candidate) => candidate.detectedRefs.length > 0).length,
      dates: candidates.filter((candidate) => candidate.date).length,
      needReview: candidates.filter((candidate) => candidate.reasons.length > 0).length,
    },
    notices,
  };
}

/** What a candidate becomes once the user accepts it. Pure; writes nothing. */
export function candidateToEntry(
  candidate: Candidate,
  document: Pick<ParsedDocument, 'filename' | 'format'>,
  importedAt: string,
  index: number,
): Omit<Entry, 'id' | 'createdAt' | 'updatedAt'> {
  // The primary reference becomes the anchor; every other one is kept as text
  // in scriptureRefs, which is exactly what that field is for. Choosing a
  // primary must never be a reason to lose the rest.
  const others = candidate.detectedRefs
    .filter((hit) => !candidate.ref || labelRef(hit.ref) !== labelRef(candidate.ref))
    .map((hit) => hit.label);

  return {
    kind: candidate.kind,
    title: candidate.title,
    date: candidate.date,
    anchors: candidate.ref ? [{ kind: 'scripture', ...candidate.ref }] : [],
    scriptureRefs: others,
    notes: candidate.body,
    reflection: '',
    links: [],
    tags: [],
    forDescendants: false,
    visibility: 'private',
    source: {
      importedAt,
      filename: document.filename,
      format: document.format,
      itemIndex: index + 1,
      ...(candidate.page !== undefined ? { page: candidate.page } : {}),
      parserVersion: PARSER_VERSION,
    },
  };
}
