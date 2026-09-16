/**
 * Finding a passage by what it is called.
 *
 * This exists because of how people actually describe what they heard: "the
 * sermon on the mount", "Jesus at the well". Neither is a reference, and asking
 * someone to know the second one is John 4 defeats the point of carrying titled
 * divisions at all.
 *
 * Two ways in, because both are how people talk:
 *
 *   - a typed reference ("Matthew 5", "John 4:1-26") goes through the same
 *     permissive parser the search box uses, and yields every division that
 *     overlaps it;
 *   - a name is matched against the division titles this build carries.
 *
 * The title half only exists where the build has titles. Under `refs-only`
 * `segmentTitle` returns the reference itself, so matching on it would quietly
 * turn a name search into a second, worse reference search — so it is switched
 * off and *reported* as unavailable rather than faked. Same honesty as
 * `search.ts`: say what was looked through.
 *
 * Every match carries a resolved `ScriptureRef`. The segment id rides along as
 * an enhancement for the anchor, never as the thing that identifies the passage
 * (operating contract, rule 2) — so a passage picked under `full` still names a
 * real range after an export into `refs-only`.
 */

import type { PassageSegment, ScriptureRef } from '../types';
import { refToString } from './bible';
import { normalize } from './book-aliases';
import { BOOK_NAMES, CANON } from './canon';
import { segmentRef } from './passages';
import { parseReferenceQuery } from './search';

/** Shorter than this and a name search matches most of the Bible. */
export const MIN_PASSAGE_QUERY = 2;

/**
 * Words that carry no signal in a passage title.
 *
 * Dropped so the words somebody actually says still land. "Woman at the well"
 * against "Jesus with the Woman at Well in Samaria" fails on "the" alone if
 * every word has to be there — and nobody recites a heading verbatim.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'with',
]);

/**
 * The words to require, in the order they were typed.
 *
 * If the query is nothing but stop words, they are all we have, so they are
 * kept rather than leaving nothing to search for.
 */
export function queryTokens(needle: string): string[] {
  const all = needle.split(' ').filter(Boolean);
  const meaningful = all.filter((word) => !STOP_WORDS.has(word));
  return meaningful.length ? meaningful : all;
}

export interface PassageMatch {
  /** Stable identity, for React keys and for de-duplication. */
  key: string;
  book: string;
  bookName: string;
  /** The division's id in THIS build. Not portable; see `outlineEntryId`. */
  segmentId: string;
  /** Set only where the division is title-backed — the optional enhancement. */
  outlineEntryId?: string;
  /** The portable anchor. Always present. */
  ref: ScriptureRef;
  /** "John 4:1-26" — always shown, because it always means something. */
  reference: string;
  /** The division's title, or '' where this build has none for it. */
  title: string;
  /** Which half of the search found it. */
  matched: 'reference' | 'title';
}

/**
 * The division scheme to search.
 *
 * Injected rather than imported so this stays pure and so a test can hand it a
 * scheme of three segments instead of three thousand. `hasOutlineTitles` is
 * the caller's to state: this module must not assume a profile.
 */
export interface PassageSources {
  segmentsForBook(bookId: string): PassageSegment[];
  segmentTitle(segment: PassageSegment): string;
  hasOutlineTitles: boolean;
}

export interface PassageSearchResult {
  query: string;
  /** False when the query was too short to look anything up. */
  searched: boolean;
  /** False when this build has no titles to search — say so, do not pretend. */
  searchedTitles: boolean;
  matches: PassageMatch[];
  /** Matches past the limit, so the UI can admit there are more. */
  more: number;
}

/**
 * (chapter, verse) ordering as a tuple compare.
 *
 * Overlap needs no verse index: both ends of both ranges are already chapter
 * and verse, and comparing them lexicographically is exact.
 */
const atOrBefore = (c1: number, v1: number, c2: number, v2: number) =>
  c1 < c2 || (c1 === c2 && v1 <= v2);

function overlaps(segment: PassageSegment, ref: ScriptureRef): boolean {
  return (
    atOrBefore(segment.chapterStart, segment.verseStart, ref.chapterEnd, ref.verseEnd) &&
    atOrBefore(ref.chapterStart, ref.verseStart, segment.chapterEnd, segment.verseEnd)
  );
}

/**
 * Turn one division into the match object the pickers hand around.
 *
 * Exported because a passage reaches the editor two ways — typed into the
 * search box, or picked book-first from a pair of dropdowns — and both must
 * produce an identical anchor. Two constructions of "the same passage" that
 * drifted apart would be invisible until an export disagreed with itself.
 *
 * `segmentTitle` is passed in rather than imported for the reason the whole
 * module takes its sources: this file must not decide what profile it is in.
 */
export function toPassageMatch(
  segment: PassageSegment,
  bookId: string,
  segmentTitle: (segment: PassageSegment) => string,
  matched: PassageMatch['matched'] = 'title',
): PassageMatch {
  const bookName = BOOK_NAMES[bookId] ?? bookId;
  const ref = segmentRef(segment, bookId);
  const reference = refToString(ref, bookName);
  // Under `refs-only` — and for an uncovered gap under `full` — the "title"
  // IS the reference. Blank it rather than print the same words twice.
  const shown = segmentTitle(segment);
  const match: PassageMatch = {
    key: `${bookId}:${segment.id}`,
    book: bookId,
    bookName,
    segmentId: segment.id,
    ref,
    reference,
    title: shown && shown !== reference ? shown : '',
    matched,
  };
  // The enhancement, never the identity: an uncovered gap carries no outline id
  // because there is no outline entry behind it.
  if (segment.kind === 'outline') match.outlineEntryId = segment.id;
  return match;
}

/**
 * Search the division scheme by reference, by name, or both.
 *
 * Reference hits come first: someone who typed a reference asked a precise
 * question and deserves the precise answer at the top. Name hits follow, ranked
 * by where the words landed — the start of the title, then the start of a word
 * inside it, then anywhere. That last tier is not pedantry: searching "well"
 * against the BSB headings matches three separate "Benediction and Farewell"
 * sections, and they must not sit above the woman at the well.
 */
export function findPassages(
  query: string,
  sources: PassageSources,
  limit = 12,
): PassageSearchResult {
  const trimmed = query.trim();
  const needle = normalize(trimmed);

  const result: PassageSearchResult = {
    query: trimmed,
    searched: needle.length >= MIN_PASSAGE_QUERY,
    searchedTitles: sources.hasOutlineTitles,
    matches: [],
    more: 0,
  };
  if (!result.searched) return result;

  const seen = new Set<string>();
  const found: PassageMatch[] = [];

  const add = (segment: PassageSegment, bookId: string, matched: PassageMatch['matched']) => {
    const key = `${bookId}:${segment.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(toPassageMatch(segment, bookId, sources.segmentTitle, matched));
  };

  const parsed = parseReferenceQuery(trimmed);
  if (parsed) {
    for (const segment of sources.segmentsForBook(parsed.book)) {
      if (overlaps(segment, parsed)) add(segment, parsed.book, 'reference');
    }
  }

  if (sources.hasOutlineTitles) {
    // The phrase as typed ranks above any partial match — someone who typed a
    // near-exact heading gets the exact heading back first.
    const startsWith: Array<[PassageSegment, string]> = [];
    const wordStart: Array<[PassageSegment, string]> = [];
    const anywhere: Array<[PassageSegment, string]> = [];

    // Below that: every title this build ships, scored by how many of the
    // query's words it kept — weighted by how RARE each word is across every
    // title, not merely how many matched. Plain counting fails on the exact
    // case this exists for: "Jesus at the well" against "Jesus and the
    // Samaritan Woman" shares only "Jesus", and "Jesus" appears in hundreds of
    // titles, so weighing every shared word the same buried the one match that
    // mattered under everything else that happens to mention Jesus. Weighing a
    // word by its rarity is what a search engine calls TF-IDF; there is
    // exactly one occurrence of each word per title here, so only the IDF half
    // is doing any work.
    const tokens = queryTokens(needle);
    // Whole words, never substrings: "well" must not match inside "Dwell" or
    // "Farewell". That bug is why this is a Set of split words rather than a
    // second round of `.includes` — the first attempt at this scored "God Will
    // Dwell among the People" above the actual well story on "jesus at the
    // well", because "well" the RARE word scored high and "well" the SUBSTRING
    // matched titles it has nothing to do with.
    const remaining: Array<{ segment: PassageSegment; bookId: string; words: Set<string> }> = [];
    const documentFrequency = new Map<string, number>();

    for (const bookId of CANON) {
      for (const segment of sources.segmentsForBook(bookId)) {
        // Only a title-backed division has a name to match. An uncovered gap
        // is reachable by reference, which is the only name it has.
        if (segment.kind !== 'outline') continue;
        const title = normalize(sources.segmentTitle(segment));

        const at = title.indexOf(needle);
        if (at === 0) {
          startsWith.push([segment, bookId]);
          continue;
        }
        if (at > 0 && title[at - 1] === ' ') {
          wordStart.push([segment, bookId]);
          continue;
        }
        if (at > 0) {
          anywhere.push([segment, bookId]);
          continue;
        }

        const words = new Set(title.split(' ').filter(Boolean));
        remaining.push({ segment, bookId, words });
        for (const word of words) {
          documentFrequency.set(word, (documentFrequency.get(word) ?? 0) + 1);
        }
      }
    }

    const totalTitles = remaining.length;
    // Smoothed so a word absent from every OTHER title still scores rather
    // than dividing by zero, and so the rarest real word still outweighs one
    // that appears in every third title.
    const rarity = (word: string) => Math.log((totalTitles + 1) / ((documentFrequency.get(word) ?? 0) + 1)) + 1;

    const scored = remaining
      .map(({ segment, bookId, words }) => {
        const matched = tokens.filter((token) => words.has(token));
        const score = matched.reduce((sum, token) => sum + rarity(token), 0);
        return { segment, bookId, score };
      })
      .filter((row) => row.score > 0);

    // A stable sort keeps ties in the canonical order they were built in.
    scored.sort((a, b) => b.score - a.score);

    const ranked = [
      ...startsWith,
      ...wordStart,
      ...anywhere,
      ...scored.map((row): [PassageSegment, string] => [row.segment, row.bookId]),
    ];
    for (const [segment, bookId] of ranked) add(segment, bookId, 'title');
  }

  result.matches = found.slice(0, limit);
  result.more = found.length - result.matches.length;
  return result;
}

/**
 * What the passage picker says about what it found.
 *
 * Separated out because the wording carries the one thing a search box must not
 * get wrong: the difference between "there is no such passage" and "this build
 * has no titles to search". Under `refs-only` the second is the truth, and
 * reporting it as the first would be a lie about the data rather than about the
 * query — the same honesty `search.ts` owes its empty state.
 */
export function passageStatusText(result: PassageSearchResult): string {
  if (!result.searched) return '';

  const shown = result.matches.length;
  if (shown === 0) {
    return result.searchedTitles
      ? `Nothing matched \u201c${result.query}\u201d. Try a reference, like John 4.`
      : `Nothing matched \u201c${result.query}\u201d. This version of the site carries no passage titles, ` +
          'so search by reference \u2014 like John 4.';
  }

  const total = shown + result.more;
  const noun = total === 1 ? 'passage' : 'passages';
  return result.more
    ? `${total} ${noun} found; showing the first ${shown}. Add a word to narrow it.`
    : `${shown} ${noun} found.`;
}
