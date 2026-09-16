import { describe, expect, it } from 'vitest';
import type { Entry, EntryAnchor, OutlineBook, OutlineEntry, Topic } from '../types';

import { renderIndexes } from './indexes';
import { buildNoteFilenames, type ExportContext } from './context';
import { ALL_ENTRIES } from './fixtures';

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
  { id: 'grief', name: 'Grief', description: 'Losing someone, and what to do with the days after.', aliases: [], refs: [] },
  { id: 'money', name: 'Money', description: 'Earning it, owing it, and giving it away.', aliases: [], refs: [] },
  { id: 'faith', name: 'Faith', description: 'Trusting God when nothing is settled yet.', aliases: [], refs: [] },
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

/**
 * A populated outline layer, as the `full` profile carries one.
 *
 * Built with titles and an intro that would be unmistakable in the output, so
 * the refs-only comparison below is a real test: if any index ever started
 * consulting the outline, these strings would appear on one side and not the
 * other and the byte comparison would fail.
 */
function outlineLayer(): { books: Map<string, OutlineBook>; entries: Map<string, OutlineEntry> } {
  const made: OutlineEntry[] = BOOKS.map(([id, name], index) => ({
    id: `${id}-1`,
    ref: `${name} 1`,
    sourceRef: `${name} 1`,
    book: id,
    chapterStart: 1,
    chapterEnd: 1,
    title: `OUTLINE TITLE ${index}`,
    displayTitle: `OUTLINE DISPLAY TITLE ${index}`,
    classicStory: false,
    series: null,
  }));

  return {
    books: new Map(
      BOOKS.map(([id, name], index) => [
        id,
        {
          id,
          name: `OUTLINE BOOK NAME ${name}`,
          testament: index > 2 ? 'NT' : 'OT',
          order: index + 1,
          intro: `OUTLINE INTRO for ${name}.`,
          entries: made.filter((outline) => outline.book === id),
        } satisfies OutlineBook,
      ]),
    ),
    entries: new Map(made.map((outline) => [outline.id, outline])),
  };
}

interface CtxOptions {
  profile?: 'full' | 'refs-only';
  topics?: Topic[];
  /** Entry ids to leave out of the filename map, to test the no-link path. */
  withoutFilenames?: string[];
  /** Populate the outline layer, as the `full` profile does. */
  withOutline?: boolean;
}

function makeCtx(entries: Entry[], options: CtxOptions = {}): ExportContext {
  const filenames = buildNoteFilenames(entries);
  for (const id of options.withoutFilenames ?? []) filenames.delete(id);
  const outline = options.withOutline ? outlineLayer() : { books: new Map(), entries: new Map() };

  return {
    entries,
    excludedCount: 0,
    exportedAt: '2026-09-13T12:00:00.000Z',
    profile: options.profile ?? 'full',
    bookNames: new Map(BOOKS.map(([id, name]) => [id, name])),
    bookOrder: new Map(BOOKS.map(([id, , order]) => [id, order])),
    // Empty under refs-only, and this module must never read them either way.
    outlineBooks: outline.books,
    outlineEntries: outline.entries,
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

/** Only the links that point at an entry's note file. */
function noteLinks(markdown: string): string[] {
  return links(markdown).filter((href) => href.includes('/notes/'));
}

/** Every file in the archive an index is allowed to link to besides a note. */
const NAVIGATION = new Set([
  ...PATHS.map((path) => path.replace('indexes/', '')),
  '../README.txt',
  '../book/my-journey-with-christ.html',
]);

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
        // Every link is either a note the archive holds or a file in the fixed
        // archive layout. Nothing else — a link out of the zip is a dead link.
        const known = expected.has(href) || NAVIGATION.has(href);
        expect(known, `${path} -> ${href}`).toBe(true);
        if (href.includes('/notes/')) total += 1;
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  it('ends every index with a way back to the rest of the archive', () => {
    const files = renderIndexes(makeCtx([entry('a')]));
    for (const [path, content] of Object.entries(files)) {
      const others = PATHS.filter((other) => other !== path).map((other) => other.replace('indexes/', ''));
      for (const sibling of others) expect(content, `${path} -> ${sibling}`).toContain(`](${sibling})`);
      // A file must not link to itself, or the reader goes in a circle.
      expect(content, path).not.toContain(`](${path.replace('indexes/', '')})`);
      expect(content, path).toContain('](../README.txt)');
      expect(content, path).toContain('`notes` folder');
    }
  });

  it('produces byte-identical indexes under the refs-only profile', () => {
    const entries = [
      entry('a', { anchors: [at('genesis', 35, 1, 35, 15)], speaker: 'Rev. Ames' }),
      entry('b', { date: '2021-03-04', anchors: [{ kind: 'topic', topicId: 'money' }], place: 'back porch' }),
    ];
    // The full profile carries an outline layer, refs-only carries none. If any
    // index ever read it, the loud outline strings would show up on one side.
    const full = renderIndexes(makeCtx(entries, { withOutline: true }));
    const refsOnly = renderIndexes(makeCtx(entries, { profile: 'refs-only' }));

    expect(refsOnly).toEqual(full);
    for (const content of Object.values(full)) expect(content).not.toContain('OUTLINE');
  });

  it('never touches the outline layer, however much of it is loaded', () => {
    // The whole-archive shape a refs-only import produces: outline maps empty,
    // every anchor still a resolved scripture range.
    const entries = [entry('a', { anchors: [at('genesis', 1, 1, 1, 31), { kind: 'book', book: 'john' }] })];
    const files = renderIndexes(makeCtx(entries, { profile: 'refs-only' }));

    expect(files['indexes/by-book.md']).toContain('Genesis 1');
    expect(files['indexes/by-book.md']).toContain('John (whole book)');
    expect(Object.keys(files)).toHaveLength(6);
  });

  it('lists an entry without a link rather than pointing at a file that is not there', () => {
    const files = renderIndexes(
      makeCtx([entry('a', { title: 'Orphaned', date: '2020-04-09' })], { withoutFilenames: ['a'] }),
    );
    const content = files['indexes/by-date.md'];
    // The missing file joins the run of facts rather than splitting the line
    // across two em dashes.
    expect(content).toContain('- Orphaned — April 9 · Sermon · note file not in this archive');
    expect(noteLinks(content)).toEqual([]);
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

  it('survives an entry with nothing filled in but the fields that are required', () => {
    const bare = entry('bare', {
      title: '',
      date: '',
      place: '',
      speaker: '',
      anchors: [],
      scriptureRefs: [],
      notes: '',
      reflection: '',
      links: [],
      tags: [],
    });

    const files = renderIndexes(makeCtx([bare]));
    for (const [path, content] of Object.entries(files)) {
      expect(content, path).toContain('# ');
      expect(content.endsWith('\n'), path).toBe(true);
      // Nothing renders as a literal "undefined", and no heading is left blank.
      expect(content, path).not.toContain('undefined');
      expect(content.split('\n'), path).not.toContain('## ');
    }
    expect(files['indexes/by-date.md']).toContain('(untitled)');
    expect(files['indexes/by-date.md']).toContain('Date not recorded');
  });

  it('titles a punctuation-only entry as it was written, and still links it', () => {
    const ctx = makeCtx([entry('a', { title: '??? — !!!' })]);
    const content = renderIndexes(ctx)['indexes/by-date.md'];
    // slugify has nothing to work with, so the file is "untitled" — the index
    // must take that name from ctx.noteFilenames, never re-derive it.
    expect(ctx.noteFilenames.get('a')).toBe('notes/2020-01-01--sermon--untitled.md');
    expect(content).toContain(`[??? — !!!](../${ctx.noteFilenames.get('a')})`);
  });

  it('reads the real fixture journal without dropping or mangling an entry', () => {
    const ctx = makeCtx(ALL_ENTRIES, { withOutline: true });
    const files = renderIndexes(ctx);
    const byDate = files['indexes/by-date.md'];

    // Every entry reaches by-date.md, each linked to its own file.
    expect(noteLinks(byDate).sort()).toEqual([...ctx.noteFilenames.values()].map((p) => `../${p}`).sort());
    expect(noteLinks(byDate)).toHaveLength(ALL_ENTRIES.length);
    // The two entries that collide on filename keep separate links.
    expect(new Set(noteLinks(byDate)).size).toBe(ALL_ENTRIES.length);
    expect(files['indexes/for-descendants.md']).toContain('The Beatitudes');
  });

  it('percent-encodes a note path that carries link-breaking characters', () => {
    const ctx = makeCtx([entry('a', { title: 'Hash' })]);
    // buildNoteFilenames cannot produce these today. The encoding is here so a
    // later change to the naming rules cannot break every link at once.
    ctx.noteFilenames.set('a', 'notes/odd name (1)#2?.md');

    const content = renderIndexes(ctx)['indexes/by-date.md'];
    expect(content).toContain('(../notes/odd%20name%20%281%29%232%3F.md)');
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

  it('keeps the chapter and verse of a reference it cannot place', () => {
    // A book outside the vendored canon. The formatter can only give back the
    // name, and printing that alone would silently lose what the writer wrote.
    const content = renderIndexes(
      makeCtx([
        entry('a', { title: 'Early', anchors: [at('enoch', 12, 3, 12, 9)] }),
        entry('b', { title: 'Later', anchors: [at('enoch', 40, 1, 40, 2)] }),
      ]),
    )['indexes/by-book.md'];

    expect(content).toContain('enoch 12:3-9 (as recorded; no such passage in this Bible)');
    expect(content).toContain('enoch 40:1-2 (as recorded; no such passage in this Bible)');
  });

  it('keeps a chapter number the book does not have, and says so', () => {
    const content = renderIndexes(
      makeCtx([entry('a', { anchors: [at('genesis', 99, 1, 99, 4)] })]),
    )['indexes/by-book.md'];

    expect(content).toContain('Genesis 99:1-4 (as recorded; no such passage in this Bible)');
    // And it cannot be read as an entry about the whole book.
    expect(content).not.toContain('— Genesis · ');
  });

  it('writes an unplaceable single verse and a cross-chapter span readably', () => {
    const content = renderIndexes(
      makeCtx([
        entry('a', { title: 'One verse', anchors: [at('enoch', 3, 7)] }),
        entry('b', { title: 'Across chapters', anchors: [at('enoch', 8, 2, 9, 4)] }),
      ]),
    )['indexes/by-book.md'];

    expect(content).toContain('enoch 3:7 (as recorded');
    expect(content).toContain('enoch 8:2-9:4 (as recorded');
  });

  it('sorts an undated entry to the end of its book, as every other index does', () => {
    // Both anchor the same passage, so only the date tie-break decides. An empty
    // date string sorts before every real one, which would put it first.
    const content = renderIndexes(
      makeCtx([
        entry('undated', { title: 'No date on this one', date: '', anchors: [at('genesis', 1, 1, 1, 31)] }),
        entry('dated', { title: 'Has a date', date: '2019-01-01', anchors: [at('genesis', 1, 1, 1, 31)] }),
      ]),
    )['indexes/by-book.md'];

    expect(content.indexOf('Has a date')).toBeLessThan(content.indexOf('No date on this one'));
  });

  it('names the translation the chapter and verse numbers belong to', () => {
    const content = renderIndexes(
      makeCtx([entry('a', { anchors: [at('genesis', 1, 1, 1, 31)] })]),
    )['indexes/by-book.md'];
    expect(content).toContain('King James Version');
  });

  it('does not count books that are not there when the archive is empty', () => {
    const content = renderIndexes(makeCtx([]))['indexes/by-book.md'];
    expect(content).toContain('— no entries.');
    expect(content).not.toContain('0 books');
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

  it('does not let an asterisk in a description break the emphasis around it', () => {
    const content = renderIndexes(
      makeCtx([entry('a', { anchors: [{ kind: 'topic', topicId: 'star' }] })], {
        topics: [{ id: 'star', name: 'Money*', description: 'Earning it, *owing* it, and giving it away.', aliases: [], refs: [] }],
      }),
    )['indexes/by-topic.md'];

    // One emphasis run over the whole line, not three that close each other.
    expect(content).toContain('*Earning it, \\*owing\\* it, and giving it away.*');
    expect(headings(content, 2)).toEqual(['Money*']);
  });

  it('does not count topics that are not there when the archive is empty', () => {
    const content = renderIndexes(makeCtx([]))['indexes/by-topic.md'];
    expect(content).toContain('— no entries.');
    expect(content).not.toContain('0 topics');
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

  it('keeps a speaker actually called "Not recorded" apart from the ones that are not', () => {
    const content = renderIndexes(
      makeCtx([
        entry('a', { title: 'Named that', speaker: 'Not recorded' }),
        entry('b', { title: 'Has none' }),
      ]),
    )['indexes/by-speaker.md'];

    // Two identical headings would make it impossible to tell which was which.
    const h2 = headings(content, 2);
    expect(new Set(h2).size).toBe(h2.length);
    expect(h2).toEqual(['Not recorded', 'Not recorded — nothing was written here']);
  });

  it('says plainly when nothing in the archive records the field at all', () => {
    const content = renderIndexes(
      makeCtx([entry('a'), entry('b')]),
    )['indexes/by-place.md'];

    expect(content).toContain('2 entries, and they do not record where it happened.');
    expect(content).not.toContain('0 places');
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
    // No entry is linked, but the reader is still shown the way on.
    expect(noteLinks(content)).toEqual([]);
    expect(content).toContain('](by-date.md)');
  });

  it('says so for an archive with no entries at all', () => {
    const content = renderIndexes(makeCtx([]))['indexes/for-descendants.md'];
    expect(content).toContain('none were marked');
  });
});
