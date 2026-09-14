import { describe, expect, it } from 'vitest';

import { renderIndexes } from './indexes';
import { buildNoteFilenames, type ExportContext } from './context';
import type { Entry, EntryAnchor, Topic } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
//
// Real book ids and a real topic shape, so refToString and the canonical
// ordering are exercised against the data the app actually ships.
// ---------------------------------------------------------------------------

const BOOKS: Array<[string, string, number]> = [
  ['genesis', 'Genesis', 1],
  ['exodus', 'Exodus', 2],
  ['psalms', 'Psalms', 19],
  ['john', 'John', 43],
  ['revelation', 'Revelation', 66],
];

const TOPICS: Topic[] = [
  { id: 'grief', name: 'Grief', description: 'Losing someone, and what to do with the days after.', refs: [] },
  { id: 'money', name: 'Money', description: 'Earning it, owing it, and giving it away.', refs: [] },
  { id: 'faith', name: 'Faith', description: 'Trusting God when nothing is settled yet.', refs: [] },
];

function entry(id: string, fields: Partial<Entry> = {}): Entry {
  return {
    id,
    kind: 'sermon',
    title: id,
    date: '2020-01-01',
    anchors: [],
    scriptureRefs: [],
    notes: '',
    reflection: '',
    links: [],
    tags: [],
    forDescendants: false,
    visibility: 'private',
    createdAt: `${fields.date ?? '2020-01-01'}T10:00:00.000Z`,
    updatedAt: `${fields.date ?? '2020-01-01'}T10:00:00.000Z`,
    ...fields,
  };
}

/** A scripture anchor, spelled out. */
function at(book: string, chapterStart: number, verseStart: number, chapterEnd = chapterStart, verseEnd = verseStart): EntryAnchor {
  return { kind: 'scripture', book, chapterStart, verseStart, chapterEnd, verseEnd };
}

interface CtxOptions {
  profile?: 'full' | 'refs-only';
  topics?: Topic[];
  /** Entry ids to leave out of the filename map, to test the no-link path. */
  withoutFilenames?: string[];
}

function makeCtx(entries: Entry[], options: CtxOptions = {}): ExportContext {
  const filenames = buildNoteFilenames(entries);
  for (const id of options.withoutFilenames ?? []) filenames.delete(id);

  return {
    entries,
    excludedCount: 0,
    exportedAt: '2026-09-13T12:00:00.000Z',
    profile: options.profile ?? 'full',
    bookNames: new Map(BOOKS.map(([id, name]) => [id, name])),
    bookOrder: new Map(BOOKS.map(([id, , order]) => [id, order])),
    // Empty under refs-only, and this module must never read them either way.
    outlineBooks: new Map(),
    outlineEntries: new Map(),
    topics: new Map((options.topics ?? TOPICS).map((topic) => [topic.id, topic])),
    passages: new Map(),
    noteFilenames: filenames,
  };
}

const PATHS = [
  'indexes/by-date.md',
  'indexes/by-book.md',
  'indexes/by-topic.md',
  'indexes/by-speaker.md',
  'indexes/by-place.md',
  'indexes/for-descendants.md',
];

/** Every markdown link target in a file. */
function links(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
}

/** The headings at one level, in the order they appear. */
function headings(markdown: string, level: number): string[] {
  const prefix = '#'.repeat(level);
  return markdown
    .split('\n')
    .filter((line) => line.startsWith(`${prefix} `))
    .map((line) => line.slice(prefix.length + 1));
}

// ---------------------------------------------------------------------------

describe('renderIndexes', () => {
  it('writes exactly the six index files', () => {
    const files = renderIndexes(makeCtx([entry('a')]));
    expect(Object.keys(files).sort()).toEqual([...PATHS].sort());
  });

  it('starts every file with an H1 and a one-line description carrying a count', () => {
    const files = renderIndexes(makeCtx([entry('a'), entry('b'), entry('c')]));
    for (const [path, content] of Object.entries(files)) {
      const lines = content.split('\n');
      expect(lines[0], path).toMatch(/^# \S/);
      expect(lines[1], path).toBe('');
      expect(lines[2], path).toMatch(/\S/);
      expect(lines[2], path).toMatch(/\d+ entries|1 entry|no entries|none were marked/);
      expect(content.endsWith('\n'), path).toBe(true);
    }
  });

  it('links only to note files the archive actually contains, relative to indexes/', () => {
    const entries = [
      entry('a', { anchors: [at('genesis', 1, 1, 1, 5), { kind: 'topic', topicId: 'grief' }], speaker: 'Rev. Ames', place: 'Gilead' }),
      entry('b', { date: '2021-06-02', anchors: [{ kind: 'book', book: 'john' }], forDescendants: true }),
    ];
    const ctx = makeCtx(entries);
    const expected = new Set([...ctx.noteFilenames.values()].map((path) => `../${path}`));

    const files = renderIndexes(ctx);
    let total = 0;
    for (const [path, content] of Object.entries(files)) {
      for (const href of links(content)) {
        expect(expected.has(href), `${path} -> ${href}`).toBe(true);
        expect(href.startsWith('../notes/'), href).toBe(true);
        total += 1;
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  it('produces byte-identical indexes under the refs-only profile', () => {
    const entries = [
      entry('a', { anchors: [at('genesis', 35, 1, 35, 15)], speaker: 'Rev. Ames' }),
      entry('b', { date: '2021-03-04', anchors: [{ kind: 'topic', topicId: 'money' }], place: 'back porch' }),
    ];
    // Under refs-only the outline layer is gone; the indexes must not notice.
    expect(renderIndexes(makeCtx(entries, { profile: 'refs-only' }))).toEqual(renderIndexes(makeCtx(entries)));
  });

  it('lists an entry without a link rather than pointing at a file that is not there', () => {
    const files = renderIndexes(makeCtx([entry('a', { title: 'Orphaned' })], { withoutFilenames: ['a'] }));
    expect(files['indexes/by-date.md']).toContain('Orphaned — note file not in this archive');
    expect(links(files['indexes/by-date.md'])).toEqual([]);
  });

  it('escapes brackets in a title so the link survives', () => {
    const ctx = makeCtx([entry('a', { title: 'Psalm 23 [reprise]' })]);
    const content = renderIndexes(ctx)['indexes/by-date.md'];
    expect(content).toContain(`[Psalm 23 \\[reprise\\]](../${ctx.noteFilenames.get('a')})`);
  });

  it('leaves emphasis characters alone, so plain text stays readable', () => {
    const content = renderIndexes(makeCtx([entry('a', { speaker: 'Pastor D. Marsh_Jr' })]))['indexes/by-speaker.md'];
    expect(content).toContain('## Pastor D. Marsh_Jr');
  });
});

// ---------------------------------------------------------------------------

describe('by-date.md', () => {
  it('runs oldest year first, grouped by year then month', () => {
    const files = renderIndexes(
      makeCtx([
        entry('c', { date: '2021-02-02' }),
        entry('a', { date: '2018-03-01' }),
        entry('b', { date: '2018-11-20' }),
      ]),
    );
    const content = files['indexes/by-date.md'];
    expect(headings(content, 2)).toEqual(['2018', '2021']);
    expect(headings(content, 3)).toEqual(['March', 'November', 'February']);
    expect(content.indexOf('2018')).toBeLessThan(content.indexOf('2021'));
  });

  it('says the day of the month on each line, without repeating the year', () => {
    const content = renderIndexes(makeCtx([entry('a', { date: '2019-03-01', kind: 'prayer' })]))['indexes/by-date.md'];
    expect(content).toContain('— March 1 · Prayer');
  });

  it('reads the date as written, with no timezone shift', () => {
    // new Date('2019-01-01') is UTC midnight, which reads as Dec 31 in the US.
    const content = renderIndexes(makeCtx([entry('a', { date: '2019-01-01' })]))['indexes/by-date.md'];
    expect(headings(content, 2)).toEqual(['2019']);
    expect(headings(content, 3)).toEqual(['January']);
  });

  it('gathers undated entries under a named group at the end', () => {
    const content = renderIndexes(
      makeCtx([entry('a', { date: '' }), entry('b', { date: '2020-05-05' })]),
    )['indexes/by-date.md'];

    expect(headings(content, 2)).toEqual(['2020', 'Date not recorded']);
    expect(content.indexOf('## 2020')).toBeLessThan(content.indexOf('## Date not recorded'));
  });

  it('says so plainly when there is nothing to list', () => {
    const content = renderIndexes(makeCtx([]))['indexes/by-date.md'];
    expect(content).toContain('no entries');
    expect(content).toContain('This archive contains no entries.');
  });
});

// ---------------------------------------------------------------------------

describe('by-book.md', () => {
  it('orders books canonically, not alphabetically', () => {
    const content = renderIndexes(
      makeCtx([
        entry('a', { anchors: [at('revelation', 1, 1)] }),
        entry('b', { anchors: [at('exodus', 20, 1, 20, 17)] }),
        entry('c', { anchors: [at('john', 3, 16)] }),
        entry('d', { anchors: [at('genesis', 1, 1, 1, 31)] }),
      ]),
    )['indexes/by-book.md'];

    // Alphabetical would be Exodus, Genesis, John, Revelation.
    expect(headings(content, 2)).toEqual(['Genesis', 'Exodus', 'John', 'Revelation']);
  });

  it('orders within a book by passage position before date', () => {
    const content = renderIndexes(
      makeCtx([
        entry('later-passage', { date: '2018-01-01', title: 'Jacob', anchors: [at('genesis', 35, 1, 35, 15)] }),
        entry('earlier-passage', { date: '2022-01-01', title: 'In the beginning', anchors: [at('genesis', 1, 1, 1, 31)] }),
      ]),
    )['indexes/by-book.md'];

    expect(content.indexOf('In the beginning')).toBeLessThan(content.indexOf('Jacob'));
  });

  it('puts a whole-book anchor ahead of every chapter in that book', () => {
    const content = renderIndexes(
      makeCtx([
        entry('chapter', { title: 'Chapter one', anchors: [at('genesis', 1, 1, 1, 31)] }),
        entry('whole', { title: 'All of it', anchors: [{ kind: 'book', book: 'genesis' }] }),
      ]),
    )['indexes/by-book.md'];

    expect(content.indexOf('All of it')).toBeLessThan(content.indexOf('Chapter one'));
    expect(content).toContain('Genesis (whole book)');
  });

  it('lists an entry under every book it anchors to', () => {
    const content = renderIndexes(
      makeCtx([entry('a', { title: 'Two books', anchors: [at('genesis', 1, 1, 1, 31), at('john', 1, 1, 1, 14)] })]),
    )['indexes/by-book.md'];

    const genesis = content.slice(content.indexOf('## Genesis'), content.indexOf('## John'));
    const john = content.slice(content.indexOf('## John'));
    expect(genesis).toContain('Two books');
    expect(john).toContain('Two books');
    expect(content).toContain('1 entry across 2 books');
  });

  it('lists an entry once per book, carrying all of its references there', () => {
    const content = renderIndexes(
      makeCtx([entry('a', { title: 'Two passages', anchors: [at('genesis', 35, 1, 35, 15), at('genesis', 1, 1, 1, 31)] })]),
    )['indexes/by-book.md'];

    expect(content.match(/Two passages/g)).toHaveLength(1);
    expect(content).toContain('Genesis 35:1-15, Genesis 1');
    // Positioned at its earliest passage, not the first anchor listed.
    expect(content).toContain('1 entry across 1 book');
  });

  it('prints references through the shared formatter', () => {
    const content = renderIndexes(
      makeCtx([
        entry('a', { anchors: [at('john', 3, 16)] }),
        entry('b', { anchors: [at('genesis', 1, 1, 2, 3)] }),
      ]),
    )['indexes/by-book.md'];

    expect(content).toContain('John 3:16');
    expect(content).toContain('Genesis 1:1-2:3');
  });

  it('says how many entries name no book instead of quietly dropping them', () => {
    const content = renderIndexes(
      makeCtx([
        entry('a', { anchors: [at('genesis', 1, 1, 1, 31)] }),
        entry('b', { anchors: [{ kind: 'topic', topicId: 'grief' }] }),
        entry('c'),
      ]),
    )['indexes/by-book.md'];

    expect(content).toContain('2 entries in this archive name no book');
    expect(content).toContain('by-date.md');
  });

  it('keeps a book whose canonical order is unknown, at the end', () => {
    const ctx = makeCtx([
      entry('a', { anchors: [at('genesis', 1, 1, 1, 31)] }),
      entry('b', { anchors: [at('enoch', 1, 1)] }),
    ]);
    const content = renderIndexes(ctx)['indexes/by-book.md'];
    expect(headings(content, 2)).toEqual(['Genesis', 'enoch']);
  });
});

// ---------------------------------------------------------------------------

describe('by-topic.md', () => {
  it('omits topics nobody wrote under, and keeps the curated order', () => {
    const content = renderIndexes(
      makeCtx([
        entry('a', { anchors: [{ kind: 'topic', topicId: 'faith' }] }),
        entry('b', { anchors: [{ kind: 'topic', topicId: 'grief' }] }),
      ]),
    )['indexes/by-topic.md'];

    // TOPICS is curated grief, money, faith — money has nothing and is dropped.
    expect(headings(content, 2)).toEqual(['Grief', 'Faith']);
    expect(content).not.toContain('Money');
  });

  it('carries each topic description, so a reader knows what the heading means', () => {
    const content = renderIndexes(
      makeCtx([entry('a', { anchors: [{ kind: 'topic', topicId: 'grief' }] })]),
    )['indexes/by-topic.md'];
    expect(content).toContain('*Losing someone, and what to do with the days after.*');
  });

  it('keeps an anchor to a topic it has no description for, at the end', () => {
    const content = renderIndexes(
      makeCtx([
        entry('a', { anchors: [{ kind: 'topic', topicId: 'grief' }] }),
        entry('b', { anchors: [{ kind: 'topic', topicId: 'sabbath' }] }),
      ]),
    )['indexes/by-topic.md'];

    expect(headings(content, 2)).toEqual(['Grief', 'sabbath']);
    expect(content).toContain('No description of this topic was exported.');
  });

  it('lists an entry once per topic even when it anchors twice', () => {
    const content = renderIndexes(
      makeCtx([
        entry('a', {
          title: 'Doubled',
          anchors: [
            { kind: 'topic', topicId: 'grief' },
            { kind: 'topic', topicId: 'grief' },
          ],
        }),
      ]),
    )['indexes/by-topic.md'];

    expect(content.match(/Doubled/g)).toHaveLength(1);
  });

  it('runs chronologically within a topic', () => {
    const content = renderIndexes(
      makeCtx([
        entry('late', { title: 'Later', date: '2022-01-01', anchors: [{ kind: 'topic', topicId: 'grief' }] }),
        entry('early', { title: 'Earlier', date: '2011-01-01', anchors: [{ kind: 'topic', topicId: 'grief' }] }),
      ]),
    )['indexes/by-topic.md'];

    expect(content.indexOf('Earlier')).toBeLessThan(content.indexOf('Later'));
  });
});

// ---------------------------------------------------------------------------

describe('by-speaker.md and by-place.md', () => {
  const entries = [
    entry('a', { title: 'One', date: '2019-01-01', speaker: 'Rev. Ames', place: 'Gilead Methodist' }),
    entry('b', { title: 'Two', date: '2020-01-01', speaker: 'Ada Boughton', place: 'back porch' }),
    entry('c', { title: 'Three', date: '2021-01-01' }),
    entry('d', { title: 'Four', date: '2018-01-01', speaker: 'Rev. Ames', place: 'Gilead Methodist' }),
  ];

  it('groups speakers alphabetically with the unrecorded ones last', () => {
    const content = renderIndexes(makeCtx(entries))['indexes/by-speaker.md'];
    expect(headings(content, 2)).toEqual(['Ada Boughton', 'Rev. Ames', 'Not recorded']);
    expect(content).toContain('These entries do not record who was speaking.');
  });

  it('groups places alphabetically with the unrecorded ones last', () => {
    const content = renderIndexes(makeCtx(entries))['indexes/by-place.md'];
    expect(headings(content, 2)).toEqual(['back porch', 'Gilead Methodist', 'Not recorded']);
    expect(content).toContain('These entries do not record where they happened.');
  });

  it('counts the grouped entries and the unrecorded ones separately', () => {
    const content = renderIndexes(makeCtx(entries))['indexes/by-speaker.md'];
    expect(content).toContain('3 entries across 2 speakers, and 1 entry with none recorded');
  });

  it('does not repeat the heading field on its own lines, but keeps the other', () => {
    const content = renderIndexes(makeCtx(entries))['indexes/by-speaker.md'];
    const ames = content.slice(content.indexOf('## Rev. Ames'), content.indexOf('## Not recorded'));
    expect(ames).not.toContain('· Rev. Ames');
    expect(ames).toContain('at Gilead Methodist');
  });

  it('runs chronologically within a group', () => {
    const content = renderIndexes(makeCtx(entries))['indexes/by-speaker.md'];
    expect(content.indexOf('Four')).toBeLessThan(content.indexOf('One'));
  });

  it('sorts undated entries to the end of a group, as by-date.md does', () => {
    const content = renderIndexes(
      makeCtx([
        entry('a', { title: 'No date on this one', date: '', speaker: 'Rev. Ames' }),
        entry('b', { title: 'Has a date', date: '2019-01-01', speaker: 'Rev. Ames' }),
      ]),
    )['indexes/by-speaker.md'];

    expect(content.indexOf('Has a date')).toBeLessThan(content.indexOf('No date on this one'));
  });

  it('treats whitespace-only values as not recorded', () => {
    const content = renderIndexes(makeCtx([entry('a', { speaker: '   ' })]))['indexes/by-speaker.md'];
    expect(headings(content, 2)).toEqual(['Not recorded']);
  });

  it('does not merge names that differ only in case', () => {
    const content = renderIndexes(
      makeCtx([entry('a', { speaker: 'de Vries' }), entry('b', { speaker: 'De Vries' })]),
    )['indexes/by-speaker.md'];
    // Both kept, and sorted next to each other so a reader can see they are one man.
    expect(headings(content, 2).sort()).toEqual(['De Vries', 'de Vries']);
    expect(content).toContain('2 entries across 2 speakers');
  });
});

// ---------------------------------------------------------------------------

describe('for-descendants.md', () => {
  it('lists only the marked entries, oldest first, after a human opening', () => {
    const content = renderIndexes(
      makeCtx([
        entry('a', { title: 'Kept later', date: '2021-01-01', forDescendants: true }),
        entry('b', { title: 'Not kept', date: '2020-01-01' }),
        entry('c', { title: 'Kept earlier', date: '2019-01-01', forDescendants: true }),
      ]),
    )['indexes/for-descendants.md'];

    expect(content).toContain('2 entries');
    expect(content).not.toContain('Not kept');
    expect(content.indexOf('Kept earlier')).toBeLessThan(content.indexOf('Kept later'));

    // The opening paragraph comes before the first list item.
    const firstItem = content.indexOf('\n- ');
    const opening = content.slice(0, firstItem);
    expect(opening).toContain('passed on');
    expect(opening.split('\n').filter((line) => line.trim()).length).toBeGreaterThan(4);
  });

  it('says plainly that nothing was marked rather than showing an empty list', () => {
    const content = renderIndexes(makeCtx([entry('a'), entry('b')]))['indexes/for-descendants.md'];

    expect(content).toContain('none were marked');
    expect(content).toContain('That is not the same');
    expect(content).not.toContain('\n- ');
    expect(links(content)).toEqual([]);
  });

  it('says so for an archive with no entries at all', () => {
    const content = renderIndexes(makeCtx([]))['indexes/for-descendants.md'];
    expect(content).toContain('none were marked');
  });
});
