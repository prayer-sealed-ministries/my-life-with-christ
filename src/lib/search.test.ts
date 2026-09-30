import { describe, expect, it } from 'vitest';

import { parseReferenceQuery, refLabel, search, searchTopics } from './search';
import { aliasesFor, resolveBook, searchBooks, SPELLING_COUNT } from './book-aliases';
import { examinedAtLeast } from '../testing/floor';
import topicsFile from '../data/topics.json';
import { CANON } from './canon';
import type { Entry, Topic } from '../types';

const topics = topicsFile.topics as Topic[];

/** No journal, no outlines — a stranger's first visit to the public site. */
const FIRST_VISIT = { entries: [], outlineBooks: [], hasOutlines: false };

const entry = (over: Partial<Entry>): Entry => ({
  id: 'e1', kind: 'sermon', title: '', date: '2026-01-01', anchors: [], scriptureRefs: [],
  notes: '', reflection: '', links: [], tags: [], forDescendants: false, visibility: 'private',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});

describe('the alias table was actually built', () => {
  it('knows many spellings', () => {
    examinedAtLeast(SPELLING_COUNT, 200, 'book spellings');
  });

  it('resolves every canonical book name', () => {
    for (const id of CANON) expect(resolveBook(id.replace(/-/g, ' ')), id).toBe(id);
  });
});

describe('book aliases — how people actually type', () => {
  it.each([
    ['1 Cor', '1-corinthians'],
    ['1cor', '1-corinthians'],
    ['First Corinthians', '1-corinthians'],
    ['I Corinthians', '1-corinthians'],
    ['Song of Songs', 'song-of-solomon'],
    ['Ps', 'psalms'],
    ['psalm', 'psalms'],
    ['Matt', 'matthew'],
    ['mt', 'matthew'],
    ['3 Jn', '3-john'],
    ['Revelations', 'revelation'],
    ['deut', 'deuteronomy'],
  ])('resolves %s', (typed, expected) => {
    expect(resolveBook(typed)).toBe(expected);
  });

  it('finds every John when asked for John', () => {
    expect(searchBooks('john')).toEqual(['john', '1-john', '2-john', '3-john']);
  });

  it('refuses something that is not a book', () => {
    expect(resolveBook('Hezekiah')).toBeNull();
    expect(resolveBook('')).toBeNull();
  });

  it('gives the books with irregular abbreviations some', () => {
    examinedAtLeast(aliasesFor('1-corinthians').length, 1, 'aliases for 1 Corinthians');
  });
});

describe('typed scripture references', () => {
  it.each([
    ['Matt 6:25', 'Matthew 6:25'],
    ['john 3:16', 'John 3:16'],
    ['Ps 23', 'Psalms 23'],
    ['1 cor 13', '1 Corinthians 13'],
    ['Revelation 21:1-8', 'Revelation 21:1-8'],
    ['Genesis 1', 'Genesis 1'],
  ])('reads %s', (typed, label) => {
    const ref = parseReferenceQuery(typed);
    expect(ref, typed).not.toBeNull();
    expect(refLabel(ref!)).toBe(label);
  });

  it('sends a bare book name to its first chapter', () => {
    expect(refLabel(parseReferenceQuery('Jude')!)).toBe('Jude 1');
  });

  it('refuses a verse that does not exist', () => {
    // Matthew 6 ends at 34.
    expect(parseReferenceQuery('Matthew 6:99')).toBeNull();
    expect(parseReferenceQuery('Matthew 99:1')).toBeNull();
  });

  it('refuses an ordinary word', () => {
    expect(parseReferenceQuery('forgiveness')).toBeNull();
    expect(parseReferenceQuery('')).toBeNull();
  });

  it.each([
    // One verse, written the way everyone writes it, and read back the same.
    ['John 3:16', 'John 3:16', 3, 16, 3, 16],
    // A range, with the hyphen a keyboard gives and the en dash a word
    // processor substitutes. Both are the same reference.
    ['John 3:16-18', 'John 3:16-18', 3, 16, 3, 18],
    ['John 3:16\u201318', 'John 3:16-18', 3, 16, 3, 18],
    // A numbered book, where the leading digit must not be read as a chapter.
    ['1 John 4:8', '1 John 4:8', 4, 8, 4, 8],
    ['Psalm 23:1', 'Psalms 23:1', 23, 1, 23, 1],
    ['Romans 8:31-39', 'Romans 8:31-39', 8, 31, 8, 39],
  ])('reads %s as one reference with a start and an end', (typed, label, cs, vs, ce, ve) => {
    const ref = parseReferenceQuery(typed);
    expect(ref, typed).not.toBeNull();
    // The point of the lane, asserted on the stored shape rather than the
    // label: an exact verse is a range whose ends meet, not a second kind of
    // thing. Nothing downstream needs to know which one a reader chose.
    expect([ref!.chapterStart, ref!.verseStart, ref!.chapterEnd, ref!.verseEnd]).toEqual([
      cs,
      vs,
      ce,
      ve,
    ]);
    expect(refLabel(ref!)).toBe(label);
  });

  it('refuses a range that runs backwards', () => {
    /*
     * Both endpoints exist in John 3, so every per-endpoint bounds check passed
     * and this used to come back as a ref with its end before its start.
     *
     * That is worse than a rejection, because the consumers then disagreed:
     * `refLabel` printed "John 3:18-16" as though it were a real reference,
     * while `anchorOverlaps` compares `aFrom <= qTo && qFrom <= aTo` and so
     * matched nothing — the search reported an empty journal rather than a
     * reference it could not read.
     */
    expect(parseReferenceQuery('John 3:18-16')).toBeNull();
    expect(parseReferenceQuery('Romans 8:39-31')).toBeNull();
    // Across chapters too, where the endpoints are also individually fine.
    expect(parseReferenceQuery('John 4:2-3:16')).toBeNull();
  });

  it('still reads a range that runs forwards across a chapter break', () => {
    // The guard above must not cost the cross-chapter case, which the model has
    // always supported and the archive's parser accepts.
    const ref = parseReferenceQuery('John 3:16-4:2');
    expect(ref).not.toBeNull();
    expect([ref!.chapterStart, ref!.verseStart, ref!.chapterEnd, ref!.verseEnd]).toEqual([
      3, 16, 4, 2,
    ]);
  });
});

describe('topic aliases — nobody types the label we picked', () => {
  it('every topic carries some', () => {
    let aliases = 0;
    for (const topic of topics) {
      expect(topic.aliases.length, `${topic.id} has no aliases`).toBeGreaterThan(0);
      aliases += topic.aliases.length;
    }
    examinedAtLeast(aliases, 150, 'topic aliases');
  });

  it.each([
    ['finances', 'money'],
    ['giving', 'money'],
    ['tithing', 'money'],
    ['stewardship', 'money'],
    ['worry', 'anxiety'],
    ['stress', 'anxiety'],
    ['mourning', 'grief'],
    ['sabbath', 'rest'],
  ])('%s reaches %s', (typed, topicId) => {
    expect(searchTopics(typed).map((hit) => hit.topic.id)).toContain(topicId);
  });

  it('says which alias matched, so the result does not look arbitrary', () => {
    const hit = searchTopics('tithing').find((row) => row.topic.id === 'money');
    expect(hit?.matchedAlias).toBe('tithing');
  });
});

describe('search on a first visit — empty journal, no outlines', () => {
  // The bug this was built for: before topics and books were searchable, a
  // stranger's first search on the public site returned nothing at all.
  it('finds something for an ordinary word', () => {
    const results = search('money', FIRST_VISIT);
    examinedAtLeast(results.total, 1, 'results for "money" on a first visit');
    expect(results.topics.map((t) => t.topic.id)).toContain('money');
  });

  it('finds something for an alias', () => {
    expect(search('worry', FIRST_VISIT).total).toBeGreaterThan(0);
  });

  it('offers the passage when a reference is typed', () => {
    const results = search('Matt 6:25', FIRST_VISIT);
    expect(results.references).toHaveLength(1);
    expect(results.references[0].label).toBe('Matthew 6:25');
  });

  it('offers the book when a book is typed', () => {
    expect(search('1 cor', FIRST_VISIT).books.map((b) => b.id)).toContain('1-corinthians');
  });

  it('searches the journal too', () => {
    const results = search('whitfield', {
      ...FIRST_VISIT,
      entries: [entry({ speaker: 'Pastor James Whitfield' })],
    });
    expect(results.entries).toHaveLength(1);
  });
});

describe('the empty state says what was searched', () => {
  it('names every source it looked through', () => {
    const results = search('zzzznothing', FIRST_VISIT);
    expect(results.total).toBe(0);
    examinedAtLeast(results.searched.length, 4, 'named search sources');

    const labels = results.searched.map((s) => s.label);
    expect(labels).toContain('Topics');
    expect(labels).toContain('Books of the Bible');
    expect(labels).toContain('Your journal');
    expect(labels).toContain('Scripture references');
  });

  it('names a source this build cannot search, rather than omitting it', () => {
    const absent = search('zzzznothing', FIRST_VISIT).searched.find(
      (s) => s.label === 'Outline passage titles',
    );
    expect(absent?.available).toBe(false);
    expect(absent?.reason).toMatch(/not included/);
  });

  it('marks the outline as available when the build carries it', () => {
    const present = search('zzzznothing', { ...FIRST_VISIT, hasOutlines: true }).searched.find(
      (s) => s.label === 'Outline passage titles',
    );
    expect(present?.available).toBe(true);
  });
});
