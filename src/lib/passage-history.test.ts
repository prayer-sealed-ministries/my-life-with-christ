/**
 * A passage as a doorway into a life.
 *
 * Retrieval is `entriesAnchoredTo`, already tested against the overlap
 * contract; these assert the things this lane adds on top — that the order is
 * the story's order, that the years are the reader's own, and that the line
 * quoted back to them is theirs unless it says otherwise.
 */

import { describe, expect, it } from 'vitest';

import {
  EXCERPT_LIMIT,
  excerptFor,
  groupByYear,
  matchingAnchors,
  passageHistory,
} from './passage-history';
import { parseReferenceQuery, refLabel } from './search';
import { ENTRY_KINDS, ENTRY_KIND_LABELS } from './entry-kinds';
import type { Entry, EntryKind, ScriptureRef } from '../types';

let seq = 0;
const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: `e${(seq += 1)}`,
  kind: 'sermon',
  title: '',
  date: '2026-03-01',
  anchors: [],
  scriptureRefs: [],
  notes: '',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  ...overrides,
});

/** A scripture anchor, written the way the editor writes them. */
const at = (book: string, cs: number, vs: number, ce = cs, ve = vs) =>
  ({ kind: 'scripture', book, chapterStart: cs, verseStart: vs, chapterEnd: ce, verseEnd: ve }) as const;

const ref = (text: string): ScriptureRef => {
  const parsed = parseReferenceQuery(text);
  if (!parsed) throw new Error(`test wrote an unparseable reference: ${text}`);
  return parsed;
};

const ids = (entries: Entry[]) => entries.map((each) => each.id);

describe('the reference the page is about', () => {
  it('canonicalises the ways a person writes one passage', () => {
    // One passage, one address. These must all land on the same ref, or a
    // bookmarked history page depends on how it was typed.
    for (const spelling of ['John 15', 'john 15', 'Jn 15', 'JN 15']) {
      expect(refLabel(ref(spelling)), spelling).toBe('John 15');
    }
    expect(refLabel(ref('John 15:5'))).toBe('John 15:5');
    expect(refLabel(ref('Jn 15:1-8'))).toBe('John 15:1-8');
  });

  it('keeps a canonical label parsing back to itself', () => {
    // The view replaces the URL with the label, so a label that re-parsed to
    // something else would navigate forever.
    for (const text of ['John 15', 'John 15:5', 'John 15:1-8', '1 John 1:9', 'Song of Solomon 2']) {
      expect(refLabel(ref(refLabel(ref(text)))), text).toBe(refLabel(ref(text)));
    }
  });

  it('refuses what is not a passage, rather than guessing', () => {
    for (const rubbish of ['', '   ', 'forgiveness', 'John 999', 'Nowhere 3', '15']) {
      expect(parseReferenceQuery(rubbish), rubbish).toBeNull();
    }
  });
});

describe('which moments belong to a passage', () => {
  const corpus = [
    entry({ id: 'chapter', anchors: [at('john', 15, 1, 15, 27)] }),
    entry({ id: 'verse', anchors: [at('john', 15, 5)] }),
    entry({ id: 'range', anchors: [at('john', 15, 1, 15, 8)] }),
    entry({ id: 'later-verse', anchors: [at('john', 15, 20)] }),
    entry({ id: 'other-chapter', anchors: [at('john', 14, 6)] }),
    entry({ id: 'other-book', anchors: [at('mark', 15, 5)] }),
    entry({ id: 'spanning', anchors: [at('john', 14, 30, 15, 3)] }),
    entry({ id: 'unanchored' }),
  ];

  it('gathers everything overlapping the chapter', () => {
    expect(ids(passageHistory(corpus, ref('John 15')).entries).sort()).toEqual(
      ['chapter', 'later-verse', 'range', 'spanning', 'verse'],
    );
  });

  it('narrows to what overlaps a single verse', () => {
    expect(ids(passageHistory(corpus, ref('John 15:5')).entries).sort()).toEqual(
      ['chapter', 'range', 'verse'],
    );
  });

  it('narrows to what overlaps a range', () => {
    expect(ids(passageHistory(corpus, ref('John 15:1-8')).entries).sort()).toEqual(
      ['chapter', 'range', 'spanning', 'verse'],
    );
  });

  it('never brings in another book that shares the chapter number', () => {
    // The exact false positive this contract exists to prevent.
    const found = ids(passageHistory(corpus, ref('John 15')).entries);
    expect(found).not.toContain('other-book');
    expect(ids(passageHistory(corpus, ref('Mark 15')).entries)).toEqual(['other-book']);
  });

  it('handles a range that spans two chapters from either side', () => {
    expect(passageHistory(corpus, ref('John 14')).total).toBeGreaterThan(0);
    expect(ids(passageHistory(corpus, ref('John 14:30')).entries)).toContain('spanning');
    expect(ids(passageHistory(corpus, ref('John 15:3')).entries)).toContain('spanning');
    expect(ids(passageHistory(corpus, ref('John 15:4')).entries)).not.toContain('spanning');
  });

  it('names the anchor that put the entry on the page, not every anchor it has', () => {
    const many = entry({ anchors: [at('john', 3, 16), at('john', 15, 5), { kind: 'topic', topicId: 'grace' }] });
    const matched = matchingAnchors(many, ref('John 15'));
    expect(matched).toHaveLength(1);
    expect(refLabel(matched[0])).toBe('John 15:5');
  });
});

describe('the order is the order it happened', () => {
  it('runs oldest to newest, the opposite of search', () => {
    const corpus = [
      entry({ id: 'middle', date: '2027-06-01', anchors: [at('john', 15, 1, 15, 27)] }),
      entry({ id: 'newest', date: '2028-01-09', anchors: [at('john', 15, 1, 15, 27)] }),
      entry({ id: 'oldest', date: '2026-02-02', anchors: [at('john', 15, 1, 15, 27)] }),
    ];
    expect(ids(passageHistory(corpus, ref('John 15')).entries)).toEqual(['oldest', 'middle', 'newest']);
  });

  it('breaks a same-day tie by when it was written', () => {
    const corpus = [
      entry({ id: 'second', date: '2026-02-02', createdAt: '2026-02-02T18:00:00.000Z', anchors: [at('john', 15, 2)] }),
      entry({ id: 'first', date: '2026-02-02', createdAt: '2026-02-02T09:00:00.000Z', anchors: [at('john', 15, 2)] }),
    ];
    expect(ids(passageHistory(corpus, ref('John 15')).entries)).toEqual(['first', 'second']);
  });
});

describe('years', () => {
  const inYear = (year: string, id: string) =>
    entry({ id, date: `${year}-05-05`, anchors: [at('john', 15, 1, 15, 27)] });

  it('groups consecutively, oldest first', () => {
    const years = groupByYear([inYear('2026', 'a'), inYear('2026', 'b'), inYear('2028', 'c')]);
    expect(years.map((each) => each.year)).toEqual(['2026', '2028']);
    expect(ids(years[0].entries)).toEqual(['a', 'b']);
    expect(ids(years[1].entries)).toEqual(['c']);
  });

  it('shows no empty years between two that have entries', () => {
    // 2027 has nothing in it and must not appear as a heading over nothing.
    const years = groupByYear([inYear('2026', 'a'), inYear('2028', 'b')]);
    expect(years.map((each) => each.year)).not.toContain('2027');
    expect(years).toHaveLength(2);
  });

  it('keeps a date the calendar does not have, rather than inventing a year', () => {
    const odd = entry({ id: 'odd', date: 'sometime in the spring', anchors: [at('john', 15, 2)] });
    expect(groupByYear([odd])[0].year).toBe('sometime in the spring');
  });

  it('is empty for an empty history', () => {
    expect(groupByYear([])).toEqual([]);
  });
});

describe('the line quoted back to the reader', () => {
  it('prefers what it meant to them over what was taught', () => {
    // Notes are what was taught; reflection is what it meant. A page about
    // someone's own history is asking the second question.
    const both = entry({ notes: 'He preached on the vine.', reflection: 'I have been striving.' });
    expect(excerptFor(both)).toMatchObject({ source: 'reflection', label: null });
    expect(excerptFor(both)?.text).toBe('I have been striving.');
  });

  it('falls back through notes to prayer', () => {
    expect(excerptFor(entry({ notes: 'The vine and the branches.' }))?.source).toBe('notes');
    expect(excerptFor(entry({ prayer: 'Keep me abiding.' }))?.source).toBe('prayer');
  });

  it('labels a handout as a handout, and only uses it last', () => {
    const handout = {
      body: 'Point three: abiding is not striving.',
      importedAt: '2026-03-01T00:00:00.000Z',
      filename: 'h.md',
      format: 'markdown' as const,
      parserVersion: 1,
    };
    const onlyProvided = entry({ sourceMaterial: handout });
    expect(excerptFor(onlyProvided)).toMatchObject({ source: 'provided', label: 'Provided notes' });

    // Their own words win whenever there are any.
    const withOwn = entry({ reflection: 'Mine.', sourceMaterial: handout });
    expect(excerptFor(withOwn)).toMatchObject({ source: 'reflection', label: null });
  });

  it('quotes verbatim and invents nothing', () => {
    const exact = 'He opened by saying the Beatitudes are not entry requirements.';
    expect(excerptFor(entry({ reflection: exact }))?.text).toBe(exact);
  });

  it('says nothing at all rather than writing on their behalf', () => {
    // A dated title and kind is a perfectly good record of a moment. A
    // placeholder sentence here would be the page authoring their journal.
    expect(excerptFor(entry({ title: 'Just a title' }))).toBeNull();
    expect(excerptFor(entry({ notes: '   ' }))).toBeNull();
  });

  it('trims a long passage without cutting a word in half', () => {
    const long = `${'word '.repeat(200)}end`;
    const text = excerptFor(entry({ reflection: long }))!.text;
    expect(text.length).toBeLessThanOrEqual(EXCERPT_LIMIT + 1);
    expect(text.endsWith('…')).toBe(true);
    expect(text).not.toMatch(/wor…$/);
  });
});

describe('every kind of moment counts', () => {
  it('includes all six canonical kinds', () => {
    // A prayer anchored to John 15 is part of a history with John 15, and so
    // is a letter. Nothing here restricts this to sermons and readings.
    const corpus = ENTRY_KINDS.map((kind) =>
      entry({ id: kind, kind: kind as EntryKind, anchors: [at('john', 15, 5)] }),
    );
    const found = passageHistory(corpus, ref('John 15')).entries;

    expect(found).toHaveLength(ENTRY_KINDS.length);
    expect(ids(found).sort()).toEqual([...ENTRY_KINDS].sort());
    // The floor: a loop over an empty list proves nothing.
    expect(ENTRY_KINDS.length).toBe(6);
    for (const kind of ENTRY_KINDS) expect(ENTRY_KIND_LABELS[kind]).toBeTruthy();
  });
});

describe('the count is descriptive, not a score', () => {
  it('counts exactly what is shown', () => {
    const corpus = [
      entry({ anchors: [at('john', 15, 5)] }),
      entry({ anchors: [at('john', 15, 6)] }),
      entry({ anchors: [at('mark', 15, 5)] }),
    ];
    const history = passageHistory(corpus, ref('John 15'));
    expect(history.total).toBe(2);
    expect(history.total).toBe(history.entries.length);
    expect(history.years.reduce((sum, year) => sum + year.entries.length, 0)).toBe(history.total);
  });
});
