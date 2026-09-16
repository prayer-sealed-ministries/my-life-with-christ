/**
 * Two halves are tested here, and they are tested differently on purpose.
 *
 * The ranking and profile rules are exercised against a hand-built scheme of a
 * few segments, where every expected position is checkable by eye. The fact
 * that a real person's words find a real passage is exercised against whatever
 * divisions this build actually ships — that is the claim that matters, and a
 * fixture cannot make it.
 */

import { describe, expect, it } from 'vitest';

import { hasOutlineTitles, segmentTitle, segmentsForBook } from '../app/data';
import { examinedAtLeast, sentinelFound } from '../testing/floor';
import type { OutlineEntry, PassageSegment } from '../types';
import { findPassages, type PassageSources } from './passage-search';

/** A titled division, shaped like the ones both schemes produce. */
function titled(
  id: string,
  title: string,
  chapterStart: number,
  verseStart: number,
  chapterEnd: number,
  verseEnd: number,
): PassageSegment {
  const entry = {
    id,
    ref: id,
    sourceRef: id,
    book: 'john',
    chapterStart,
    chapterEnd,
    verseStart,
    verseEnd,
    title,
    displayTitle: title,
    classicStory: false,
    series: null,
  } as OutlineEntry;
  return { kind: 'outline', id, ref: id, entry, chapterStart, verseStart, chapterEnd, verseEnd };
}

const WELL = titled('john-4-1-26', 'Jesus and the Samaritan Woman', 4, 1, 4, 26);
const FAREWELL = titled('john-14-1-14', 'Jesus Comforts His Disciples: Farewell', 14, 1, 14, 14);
const WELLSPRING = titled('john-7-37-39', 'Wellspring of Living Water', 7, 37, 7, 39);
const CHAPTER_ONE = titled('john-1-1-5', 'The Beginning', 1, 1, 1, 5);

const FIXTURE: PassageSegment[] = [CHAPTER_ONE, WELL, WELLSPRING, FAREWELL];

const fixtureSources = (overrides: Partial<PassageSources> = {}): PassageSources => ({
  segmentsForBook: (bookId) => (bookId === 'john' ? FIXTURE : []),
  segmentTitle: (segment) => (segment.kind === 'outline' ? segment.entry.displayTitle : segment.ref),
  hasOutlineTitles: true,
  ...overrides,
});

describe('findPassages — what it refuses to do', () => {
  it('does not search on a query too short to mean anything', () => {
    const result = findPassages('a', fixtureSources());
    expect(result.searched).toBe(false);
    expect(result.matches).toEqual([]);
  });

  it('reports that it searched no titles when the build carries none', () => {
    const result = findPassages('samaritan', fixtureSources({ hasOutlineTitles: false }));
    expect(result.searched).toBe(true);
    expect(result.searchedTitles).toBe(false);
    // Silence would be indistinguishable from "no such passage".
    expect(result.matches).toEqual([]);
  });

  it('still finds a passage by reference when there are no titles to search', () => {
    const result = findPassages('John 4:2', fixtureSources({ hasOutlineTitles: false }));
    expect(result.matches.map((match) => match.segmentId)).toEqual(['john-4-1-26']);
    expect(result.matches[0].matched).toBe('reference');
  });
});

describe('findPassages — ranking', () => {
  it('puts a title that starts with the words above one that merely contains them', () => {
    const result = findPassages('well', fixtureSources());
    const ids = result.matches.map((match) => match.segmentId);
    // "Wellspring" starts with it; "the Well" would start a word; "Farewell"
    // buries it mid-word and must come last.
    expect(ids.indexOf('john-7-37-39')).toBeLessThan(ids.indexOf('john-14-1-14'));
  });

  it('ranks a word-start match above a mid-word one', () => {
    const result = findPassages('samaritan', fixtureSources());
    expect(result.matches.map((match) => match.segmentId)).toEqual(['john-4-1-26']);
  });

  it('answers a typed reference before any name match', () => {
    const result = findPassages('John 1', fixtureSources());
    expect(result.matches[0].segmentId).toBe('john-1-1-5');
    expect(result.matches[0].matched).toBe('reference');
  });

  it('lists every division a reference spans, not just the first', () => {
    const result = findPassages('John 4:1-7:39', fixtureSources());
    expect(result.matches.map((match) => match.segmentId)).toEqual([
      'john-4-1-26',
      'john-7-37-39',
    ]);
  });

  it('never lists the same passage twice when both halves find it', () => {
    // "John 4" matches by reference; the fixture title also contains "john"…
    const result = findPassages('John 4', fixtureSources());
    const keys = result.matches.map((match) => match.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('admits how many it did not show', () => {
    // Two fixture titles begin with "Jesus"; only one is asked for.
    const result = findPassages('jesus', fixtureSources(), 1);
    expect(result.matches).toHaveLength(1);
    expect(result.more).toBe(1);
  });
});

describe('findPassages — partial word overlap', () => {
  const A = titled('a', 'The Woman at the Well', 4, 1, 4, 26);
  const B = titled('b', 'Jesus and the Samaritan Woman', 4, 1, 4, 26);
  const C = titled('c', 'The Farmer and His Field', 4, 1, 4, 26);

  const sources = (): PassageSources => ({
    segmentsForBook: (bookId) => (bookId === 'john' ? [A, B, C] : []),
    segmentTitle: (segment) => (segment.kind === 'outline' ? segment.entry.displayTitle : segment.ref),
    hasOutlineTitles: true,
  });

  it('finds a title that kept only one of the words typed', () => {
    const result = findPassages('woman at the well', sources());
    const ids = result.matches.map((match) => match.segmentId);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).not.toContain('c');
  });

  it('ranks the title that kept more of the words typed above the one that kept fewer', () => {
    const result = findPassages('woman at the well', sources());
    const ids = result.matches.map((match) => match.segmentId);
    // "a" contains both "woman" and "well"; "b" contains only "woman".
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('b'));
  });
});

  it('does not let a word match as a mere substring of another word', () => {
    // "well" is a real, meaningful word in the query; it must not credit
    // "Dwell" or "Farewell" for containing those five letters.
    const dwell = titled('dwell', 'God Will Dwell among the People', 4, 1, 4, 5);
    const farewell = titled('farewell', "Paul's Farewell to the Ephesians", 4, 1, 4, 5);
    const genuine = titled('genuine', 'The Woman at the Well', 4, 1, 4, 5);

    const result = findPassages('the well', {
      segmentsForBook: (bookId) => (bookId === 'john' ? [dwell, farewell, genuine] : []),
      segmentTitle: (segment) => (segment.kind === 'outline' ? segment.entry.displayTitle : segment.ref),
      hasOutlineTitles: true,
    });

    expect(result.matches.map((match) => match.segmentId)).toEqual(['genuine']);
  });

describe('findPassages — what a match carries', () => {
  it('always carries a resolved scripture range, with the segment id on top', () => {
    const result = findPassages('samaritan', fixtureSources());
    const match = result.matches[0];
    expect(match.ref).toEqual({
      book: 'john',
      chapterStart: 4,
      verseStart: 1,
      chapterEnd: 4,
      verseEnd: 26,
    });
    // The enhancement, never the identity.
    expect(match.outlineEntryId).toBe('john-4-1-26');
    expect(match.reference).toBe('John 4:1-26');
    expect(match.title).toBe('Jesus and the Samaritan Woman');
  });

  it('blanks the title where it is only the reference restated', () => {
    const uncovered: PassageSegment = {
      kind: 'uncovered',
      id: 'john-5',
      ref: 'John 5',
      chapterStart: 5,
      verseStart: 1,
      chapterEnd: 5,
      verseEnd: 47,
    };
    const result = findPassages('John 5', {
      segmentsForBook: () => [uncovered],
      segmentTitle: (segment) => segment.ref,
      hasOutlineTitles: true,
    });
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].title).toBe('');
    expect(result.matches[0].reference).toBe('John 5');
    expect(result.matches[0].outlineEntryId).toBeUndefined();
  });
});

describe('findPassages — against the divisions this build ships', () => {
  const sources: PassageSources = { segmentsForBook, segmentTitle, hasOutlineTitles };

  /**
   * The name to search for is taken from the build, never written down here.
   *
   * The two schemes title John 4 differently — "Jesus and the Samaritan Woman"
   * under `public`, "Jesus with the Woman at Well in Samaria" under `full` — and
   * under `refs-only` it has no title at all. A literal from one profile is a
   * test that passes only under that profile, which is instrument failure #3 in
   * the operating contract, committed again.
   */
  const johnFour = segmentsForBook('john').find(
    (segment) => segment.kind === 'outline' && segment.chapterStart === 4,
  );

  /** Floor: a clean pass over an empty scheme would prove nothing at all. */
  it('has a division scheme to search', () => {
    const counted = ['genesis', 'matthew', 'john'].reduce(
      (total, bookId) => total + segmentsForBook(bookId).length,
      0,
    );
    examinedAtLeast(counted, 3, 'divisions in three books of this build');
  });

  it('finds a passage from a typed reference under every profile', () => {
    const result = findPassages('John 4:7', sources);
    examinedAtLeast(result.matches.length, 1, 'passages found for John 4:7');
    const match = result.matches[0];
    expect(match.book).toBe('john');
    expect(match.ref.chapterStart).toBeLessThanOrEqual(4);
    expect(match.ref.chapterEnd).toBeGreaterThanOrEqual(4);
  });

  it.runIf(hasOutlineTitles)('finds a titled passage by the whole name this build gives it', () => {
    expect(johnFour).toBeDefined();
    const title = segmentTitle(johnFour!);
    // Proves the needle is a name and not a reference in disguise — searching
    // "John 4" would pass this test through the reference half and tell us
    // nothing about title matching.
    sentinelFound(
      title !== johnFour!.ref && /[a-z]{4}/i.test(title),
      title,
      'the titles this build ships for John 4',
    );

    const result = findPassages(title, sources);
    expect(result.matches.map((match) => match.segmentId)).toContain(johnFour!.id);
    expect(result.matches[0].matched).toBe('title');
  });

  /**
   * The actual scenario: a pastor spoke about Jesus at the well, and the person
   * writing it up remembers a word or two, not a chapter number. So every word
   * of the title long enough to be worth typing has to find it on its own.
   */
  /**
   * The scenario that sent me back to fix this: "woman at the well" against
   * the published heading "Jesus and the Samaritan Woman" found nothing,
   * because the whole typed phrase was matched as one contiguous run.
   *
   * A first fix required every remaining word to appear somewhere in the
   * title, which passed here under `full` — "Jesus with the Woman at Well in
   * Samaria" contains both "woman" and "well" — and then failed against the
   * live `public` build, whose BSB heading drops "well" entirely. Nobody knows
   * in advance which words a build's title kept, so this only requires at
   * least one to be there, never all of them.
   */
  it.runIf(hasOutlineTitles)('finds a passage from a phrase spoken loosely, even if the title kept only part of it', () => {
    expect(johnFour).toBeDefined();
    const result = findPassages('woman at the well', sources);
    expect(
      result.matches.map((match) => match.segmentId),
      `title was: ${JSON.stringify(segmentTitle(johnFour!))}`,
    ).toContain(johnFour!.id);
  });

  it.runIf(hasOutlineTitles)('finds it from any single substantial word of its name', () => {
    expect(johnFour).toBeDefined();
    const words = segmentTitle(johnFour!)
      .split(/[^\p{L}]+/u)
      .filter((word) => word.length >= 5);
    examinedAtLeast(words.length, 1, 'substantial words in the title of John 4');

    for (const word of words) {
      const result = findPassages(word, sources, 200);
      expect(
        result.matches.map((match) => match.segmentId),
        `searching "${word}" did not reach ${johnFour!.id}`,
      ).toContain(johnFour!.id);
    }
  });
});
