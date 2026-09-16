/**
 * Deciding where one note ends and the next begins.
 *
 * The bias is strongly against splitting. A document that arrives as one note
 * when it was really six costs the reader some editing; a document shredded
 * into sixty fragments costs them their material, because nobody reassembles
 * sixty fragments by hand. So a boundary has to be *evidenced* — a heading, or
 * a date standing alone on its own line, repeated enough times to be a pattern
 * rather than an accident — and when the evidence is thin the whole document is
 * offered as a single note.
 */

import { detectDate } from './detect';

export interface Section {
  title: string;
  body: string;
  /** How the boundary was found, for the review screen to explain itself. */
  via: 'heading' | 'date-line' | 'whole-document';
}

/** Below this, a "pattern" of headings is a coincidence. */
const MIN_BOUNDARIES = 2;

/** A heading line in Markdown. Level 1 and 2 only: deeper ones are structure inside a note. */
const MD_HEADING = /^(#{1,2})\s+(.+?)\s*#*\s*$/;

/** Setext underlines — the other Markdown heading form. */
const SETEXT = /^(=|-){3,}\s*$/;

const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

/** Collapse runs of blank lines to at most two, and strip trailing spaces. */
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A first line worth using as a title: short, and not a whole paragraph. */
function titleFrom(body: string, fallback: string): string {
  const first = body.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  if (first.length > 0 && first.length <= 80 && !/[.!?]$/.test(first)) return first;
  if (first.length > 0) return first.slice(0, 60).trim().replace(/\s+\S*$/, '') || fallback;
  return fallback;
}

/**
 * Split Markdown on its own headings.
 *
 * Only `#` and `##`. A document whose author used `###` for each sermon is
 * possible, but a document that uses `###` for sub-points inside one sermon is
 * far more common, and splitting the second kind ruins it.
 */
export function splitMarkdown(text: string, fallbackTitle: string): Section[] {
  const lines = normalizeNewlines(text).split('\n');
  const boundaries: Array<{ line: number; title: string }> = [];

  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // A heading inside a fenced code block is code, not a heading.
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;

    const atx = MD_HEADING.exec(line);
    if (atx) {
      boundaries.push({ line: i, title: atx[2].trim() });
      continue;
    }
    // Setext: the underline belongs to the line above it.
    if (SETEXT.test(line) && i > 0 && lines[i - 1].trim().length > 0 && !MD_HEADING.test(lines[i - 1])) {
      boundaries.push({ line: i - 1, title: lines[i - 1].trim() });
    }
  }

  if (boundaries.length < MIN_BOUNDARIES) {
    const body = tidy(text);
    return body ? [{ title: titleFrom(body, fallbackTitle), body, via: 'whole-document' }] : [];
  }

  const sections: Section[] = [];
  for (let i = 0; i < boundaries.length; i += 1) {
    const start = boundaries[i].line;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].line : lines.length;
    // Drop the heading line itself, and a setext underline if one follows.
    let from = start + 1;
    if (from < end && SETEXT.test(lines[from] ?? '')) from += 1;

    const body = tidy(lines.slice(from, end).join('\n'));
    const title = boundaries[i].title || fallbackTitle;
    if (body || title) sections.push({ title, body, via: 'heading' });
  }
  return sections;
}

/**
 * Split plain text.
 *
 * Two kinds of evidence, in order of how much they prove:
 *
 *  1. A date alone on its own line, more than once. Somebody keeping a journal
 *     in one long file almost always dates the entries, and a line that is
 *     nothing but a date is not prose.
 *  2. A repeated short heading-like line — no terminal punctuation, short, with
 *     a blank line before it.
 *
 * If neither is found often enough, the document is one note. Blank-line runs
 * alone are NOT a boundary: paragraphs are separated by blank lines too, and
 * splitting on them turns an essay into a pile of paragraphs.
 */
export function splitText(text: string, fallbackTitle: string): Section[] {
  const lines = normalizeNewlines(text).split('\n');

  const dateLines: number[] = [];
  const headingLines: number[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.length > 80) continue;

    const blankBefore = i === 0 || lines[i - 1].trim() === '';

    // A line that is *only* a date, give or take a stray comma or dash.
    const stripped = line.replace(/^[-–—*\s]+|[-–—*\s]+$/g, '');
    const asDate = detectDate(stripped);
    if (asDate && asDate.text.trim().length >= stripped.length - 2) {
      dateLines.push(i);
      continue;
    }

    // A short, unpunctuated line with air above it reads as a heading.
    if (blankBefore && line.length <= 60 && !/[.!?,;:]$/.test(line) && /[A-Za-z]/.test(line)) {
      headingLines.push(i);
    }
  }

  const boundaries = dateLines.length >= MIN_BOUNDARIES ? dateLines : headingLines;
  const via: Section['via'] = dateLines.length >= MIN_BOUNDARIES ? 'date-line' : 'heading';

  if (boundaries.length < MIN_BOUNDARIES) {
    const body = tidy(text);
    return body ? [{ title: titleFrom(body, fallbackTitle), body, via: 'whole-document' }] : [];
  }

  const sections: Section[] = [];
  // Anything before the first boundary is a preamble; keep it rather than lose it.
  const preamble = tidy(lines.slice(0, boundaries[0]).join('\n'));
  if (preamble) {
    sections.push({ title: titleFrom(preamble, fallbackTitle), body: preamble, via: 'whole-document' });
  }

  for (let i = 0; i < boundaries.length; i += 1) {
    const start = boundaries[i];
    const end = i + 1 < boundaries.length ? boundaries[i + 1] : lines.length;
    const heading = lines[start].trim();
    const body = tidy(lines.slice(start + 1, end).join('\n'));
    if (!heading && !body) continue;
    sections.push({ title: heading || titleFrom(body, fallbackTitle), body, via });
  }

  return sections;
}
