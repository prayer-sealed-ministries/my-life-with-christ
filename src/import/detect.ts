/**
 * Reading structure out of somebody else's prose.
 *
 * The governing instinct here is timidity. Every function in this file would
 * rather return nothing than return a guess, because the cost of the two is not
 * symmetric: a missed reference is a field the user fills in during review, and
 * a wrong one is a false fact filed into a journal meant to outlive them.
 *
 * Nothing in this file is authoritative. Everything it produces is shown for
 * review before a single record is written.
 */

import { versification } from '../lib/bible';
import { normalize, resolveBook } from '../lib/book-aliases';
import { BOOK_NAMES } from '../lib/canon';
import type { EntryKind, ScriptureRef } from '../types';

export interface DetectedRef {
  /** The text exactly as it appeared, so the UI can show what it matched. */
  text: string;
  ref: ScriptureRef;
  /** How it reads once normalized — "John 3:16-18". */
  label: string;
}

/**
 * Candidate references, found by shape and then confirmed against the canon.
 *
 * Two passes, because either alone is wrong. The pattern alone matches "Room
 * 3:16" and "Psalm 200"; the book list alone cannot find where a reference
 * starts. So the pattern proposes and `resolveBook` plus the verse counts
 * dispose — a chapter past the end of the book is not a reference, it is a
 * coincidence.
 *
 * Deliberately NOT matched: a bare book name with no numbers. "I was reading
 * Mark" is a sentence, not a citation, and treating it as one would attach
 * Mark 1 to any note that mentions a friend called Mark.
 */
const REFERENCE_PATTERN =
  /\b((?:[123]\s*|(?:1st|2nd|3rd|first|second|third)\s+)?[A-Z][a-z]{1,15}(?:\s+of\s+[A-Z][a-z]{1,15})?\.?)\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3}))?(?:\s*[-–—]\s*(?:(\d{1,3})\s*[:.]\s*)?(\d{1,3}))?/g;

const verseCount = (book: string, chapter: number): number | undefined =>
  versification[book]?.[chapter - 1];

const chapterCount = (book: string): number => versification[book]?.length ?? 0;

/**
 * Find every scripture reference in a stretch of text.
 *
 * Results are de-duplicated by what they resolve to, not by how they were
 * written: a note citing "Jn 3:16" and "John 3:16" is citing one passage.
 */
export function detectReferences(text: string, limit = 25): DetectedRef[] {
  const found: DetectedRef[] = [];
  const seen = new Set<string>();

  // An explicit exec loop rather than matchAll, so a rejected match can be
  // retried from INSIDE itself.
  //
  // Without that, "Quoted 1 Cor 10:31" finds nothing at all: the pattern first
  // matches "Quoted 1" — a capitalised word followed by a number, which is
  // exactly the shape of a reference — and "Quoted" is not a book, so the match
  // is dropped. But it has already consumed the "1", and the scan resumes at
  // "Cor 10:31", where a bare "Cor" is ambiguous between the two letters to
  // Corinth and resolves to nothing. The reference is lost between two
  // rejections. Resuming one character in gives "1 Cor 10:31" its chance.
  const pattern = new RegExp(REFERENCE_PATTERN.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (found.length >= limit) break;

    const [whole, rawBook, rawChapter, rawVerse, rawEndChapter, rawEnd] = match;
    const retryInside = () => {
      pattern.lastIndex = match!.index + 1;
    };

    const book = resolveBook(rawBook.replace(/\.$/, ''));
    if (!book) {
      retryInside();
      continue;
    }

    const chapter = Number(rawChapter);
    if (chapter < 1 || chapter > chapterCount(book)) {
      retryInside();
      continue;
    }

    const verses = verseCount(book, chapter);
    if (verses === undefined) {
      retryInside();
      continue;
    }

    let ref: ScriptureRef;
    if (!rawVerse) {
      // A whole chapter. "Romans 8", "Psalm 23".
      ref = { book, chapterStart: chapter, verseStart: 1, chapterEnd: chapter, verseEnd: verses };
    } else {
      const verse = Number(rawVerse);
      if (verse < 1 || verse > verses) {
        retryInside();
        continue;
      }

      if (!rawEnd) {
        ref = { book, chapterStart: chapter, verseStart: verse, chapterEnd: chapter, verseEnd: verse };
      } else {
        const endChapter = rawEndChapter ? Number(rawEndChapter) : chapter;
        const endVerse = Number(rawEnd);
        const endVerses = verseCount(book, endChapter);
        const badRange =
          endChapter < chapter ||
          endVerses === undefined ||
          endVerse < 1 ||
          endVerse > endVerses ||
          (endChapter === chapter && endVerse < verse);
        if (badRange) {
          retryInside();
          continue;
        }
        ref = {
          book,
          chapterStart: chapter,
          verseStart: verse,
          chapterEnd: endChapter,
          verseEnd: endVerse,
        };
      }
    }

    const key = `${ref.book}:${ref.chapterStart}:${ref.verseStart}:${ref.chapterEnd}:${ref.verseEnd}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ text: whole.trim(), ref, label: labelRef(ref) });
  }

  return found;
}

/** Render a detected reference the way a person writes one. */
export function labelRef(ref: ScriptureRef): string {
  const name = BOOK_NAMES[ref.book] ?? ref.book;
  const whole = ref.verseStart === 1 && ref.verseEnd === (verseCount(ref.book, ref.chapterEnd) ?? -1);

  if (ref.chapterStart !== ref.chapterEnd) {
    return `${name} ${ref.chapterStart}:${ref.verseStart}-${ref.chapterEnd}:${ref.verseEnd}`;
  }
  if (whole) return `${name} ${ref.chapterStart}`;
  if (ref.verseStart === ref.verseEnd) return `${name} ${ref.chapterStart}:${ref.verseStart}`;
  return `${name} ${ref.chapterStart}:${ref.verseStart}-${ref.verseEnd}`;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const MONTH_NAMES = Object.keys(MONTHS).join('|');

/** "14 September 2024", "September 14, 2024", "Sep 14 2024". */
const NAMED_DATE = new RegExp(
  String.raw`\b(?:(\d{1,2})\s+)?(${MONTH_NAMES})\.?\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(\d{4})\b`,
  'i',
);

/** ISO, which is unambiguous. */
const ISO_DATE = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/;

/**
 * Slash dates, which are not unambiguous at all.
 *
 * 9/14/2024 can only be month-first, because there is no fourteenth month. But
 * 9/1/2024 is September 1st to an American and 9th January to most of the rest
 * of the world, and nothing in the document says which. Rather than pick, this
 * refuses the ambiguous ones — see `parseDate`.
 */
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;

const pad = (n: number) => String(n).padStart(2, '0');

const isRealDate = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // A year outside this range in a sermon note is a page number or a verse.
  if (y < 1000 || y > 2999) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getMonth() === m - 1 && probe.getDate() === d;
};

export interface DetectedDate {
  /** ISO yyyy-mm-dd. */
  date: string;
  /** What it looked like in the document. */
  text: string;
  /**
   * False when the reading required a choice this parser is not entitled to
   * make — an ambiguous slash date. The candidate is flagged for review rather
   * than filled in.
   */
  confident: boolean;
}

/**
 * The first date in a stretch of text, if there certainly is one.
 *
 * Bare numbers are never dates here. "Psalm 119" is not the year 119, "3 John"
 * is not the third of anything, and a page footer reading "12" is a page
 * footer. Only the three shapes above are recognised, and each is validated as
 * a real calendar day before it is believed.
 */
export function detectDate(text: string): DetectedDate | null {
  const iso = ISO_DATE.exec(text);
  if (iso) {
    const [whole, y, m, d] = iso;
    if (isRealDate(Number(y), Number(m), Number(d))) {
      return { date: `${y}-${pad(Number(m))}-${pad(Number(d))}`, text: whole, confident: true };
    }
  }

  const named = NAMED_DATE.exec(text);
  if (named) {
    const [whole, leadingDay, monthWord, trailingDay, year] = named;
    const month = MONTHS[monthWord.toLowerCase()];
    const day = Number(leadingDay ?? trailingDay ?? 1);
    if (month && isRealDate(Number(year), month, day)) {
      return {
        date: `${year}-${pad(month)}-${pad(day)}`,
        text: whole,
        // A month and a year with no day is a real reading, but the day is this
        // parser's invention, so it is not offered as certain.
        confident: Boolean(leadingDay ?? trailingDay),
      };
    }
  }

  const slash = SLASH_DATE.exec(text);
  if (slash) {
    const [whole, a, b, year] = slash;
    const first = Number(a);
    const second = Number(b);
    // Only where the order cannot be anything else.
    if (second > 12 && isRealDate(Number(year), first, second)) {
      return { date: `${year}-${pad(first)}-${pad(second)}`, text: whole, confident: true };
    }
    if (first > 12 && isRealDate(Number(year), second, first)) {
      return { date: `${year}-${pad(second)}-${pad(first)}`, text: whole, confident: true };
    }
    // Ambiguous. Read it the common way and say plainly that it was a guess.
    if (isRealDate(Number(year), first, second)) {
      return { date: `${year}-${pad(first)}-${pad(second)}`, text: whole, confident: false };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Kind
// ---------------------------------------------------------------------------

/**
 * Hints only, and weak ones.
 *
 * These map onto the five kinds the app already has; no new categories are
 * invented. A word has to appear near the start of the note to count — "prayer"
 * in the middle of a sermon note is the subject, not the type.
 */
const KIND_HINTS: Array<{ kind: EntryKind; words: string[] }> = [
  { kind: 'sermon', words: ['sermon', 'preached', 'preaching', 'message by', 'homily'] },
  { kind: 'prayer', words: ['prayer', 'praying', 'prayed', 'intercession'] },
  { kind: 'reading', words: ['bible study', 'study notes', 'devotional', 'quiet time', 'reading'] },
  { kind: 'letter', words: ['letter to', 'dear '] },
];

/*
 * There is no row for `service`, `worship`, `liturgy` or `communion`.
 *
 * There was, while `service` was a kind. Those words did not move to `sermon`
 * when it went. `sermon` is tested first, so anything added to it wins outright,
 * and "worship" or "communion" is at least as likely to head a prayer or a
 * reflection as a sermon note — the list would have become confidently wrong
 * instead of usefully quiet.
 *
 * So a note headed "Morning service" now falls through to `reflection` and is
 * marked unconfident, which flags it for review rather than presenting a guess
 * as a finding. The reader picks, on a screen that already exists for it.
 */

/** How far into a note a type word still describes the note. */
const HINT_WINDOW = 400;

export interface DetectedKind {
  kind: EntryKind;
  /** False when nothing matched and the default was used. */
  confident: boolean;
}

/**
 * Guess what sort of note this is, and admit when it is a guess.
 *
 * The fallback is `reflection`, which is also what `migrate.ts` falls back to
 * for an unknown kind — the app's existing answer to "some writing, type
 * unclear". An unconfident result is flagged for review rather than presented
 * as a finding.
 */
export function detectKind(title: string, body: string): DetectedKind {
  const haystack = normalize(`${title}\n${body.slice(0, HINT_WINDOW)}`);

  for (const { kind, words } of KIND_HINTS) {
    if (words.some((word) => haystack.includes(normalize(word)))) {
      return { kind, confident: true };
    }
  }
  return { kind: 'reflection', confident: false };
}
