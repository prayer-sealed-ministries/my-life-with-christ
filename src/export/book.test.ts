/**
 * The book has to be right for a reader nobody can ask questions of, so these
 * tests assert on the parsed document rather than on strings: heading order,
 * resolvable anchors, escaped content, and the absence of anything the file
 * would have to fetch. What a browser sees is what is checked.
 */

import { describe, expect, it } from 'vitest';

import { escapeHtml, renderBook, renderMarkdown } from './book';
import { buildNoteFilenames, refKey, type ExportContext } from './context';
import type { Entry, ScriptureRef, Topic } from '../types';
import type { PassageVerse } from '../lib/bible';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GENESIS_1_1_3: ScriptureRef = {
  book: 'genesis',
  chapterStart: 1,
  verseStart: 1,
  chapterEnd: 1,
  verseEnd: 3,
};

const MARK_4_35_5_2: ScriptureRef = {
  book: 'mark',
  chapterStart: 4,
  verseStart: 35,
  chapterEnd: 5,
  verseEnd: 2,
};

const GENESIS_VERSES: PassageVerse[] = [
  { chapter: 1, number: 1, text: 'In the beginning God created the heaven and the earth.' },
  { chapter: 1, number: 2, text: 'And the earth was without form, and void.' },
  { chapter: 1, number: 3, text: 'And God said, Let there be light: and there was light.' },
];

const MARK_VERSES: PassageVerse[] = [
  { chapter: 4, number: 35, text: 'And the same day, when the even was come, he saith unto them.' },
  { chapter: 5, number: 1, text: 'And they came over unto the other side of the sea.' },
  { chapter: 5, number: 2, text: 'And when he was come out of the ship, immediately there met him a man.' },
];

function makeEntry(overrides: Partial<Entry> & Pick<Entry, 'id'>): Entry {
  return {
    kind: 'sermon',
    title: 'Untitled',
    date: '2026-03-01',
    anchors: [],
    scriptureRefs: [],
    notes: '',
    reflection: '',
    links: [],
    tags: [],
    forDescendants: false,
    visibility: 'private',
    createdAt: '2026-03-01T12:00:00.000Z',
    updatedAt: '2026-03-01T12:00:00.000Z',
    ...overrides,
  };
}

function makeContext(entries: Entry[], overrides: Partial<ExportContext> = {}): ExportContext {
  const passages = new Map<string, PassageVerse[]>([
    [refKey(GENESIS_1_1_3), GENESIS_VERSES],
    [refKey(MARK_4_35_5_2), MARK_VERSES],
  ]);

  return {
    entries,
    excludedCount: 0,
    exportedAt: '2026-09-13T18:04:00.000Z',
    profile: 'full',
    bookNames: new Map([
      ['genesis', 'Genesis'],
      ['mark', 'Mark'],
      ['psalms', 'Psalms'],
    ]),
    bookOrder: new Map([
      ['genesis', 1],
      ['mark', 41],
      ['psalms', 19],
    ]),
    outlineBooks: new Map(),
    outlineEntries: new Map([
      [
        'gen-1-creation',
        {
          id: 'gen-1-creation',
          ref: 'Genesis 1:1-3',
          sourceRef: 'Gen 1:1-3',
          book: 'genesis',
          chapterStart: 1,
          chapterEnd: 1,
          verseStart: 1,
          verseEnd: 3,
          title: 'The Creation',
          displayTitle: 'The Creation',
          classicStory: true,
          series: null,
        },
      ],
    ]),
    topics: new Map<string, Topic>([
      ['grief', { id: 'grief', name: 'Grief', description: 'When someone is gone.', refs: [] }],
    ]),
    passages,
    noteFilenames: buildNoteFilenames(entries),
    ...overrides,
  };
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Every heading in document order, as level numbers. */
function headingLevels(doc: Document): number[] {
  return [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => Number(h.tagName[1]));
}

const RICH_JOURNAL: Entry[] = [
  makeEntry({
    id: 'a',
    title: 'The first day',
    date: '2026-01-04',
    kind: 'sermon',
    place: 'First Baptist, Tallahassee, FL',
    speaker: 'Rev. Alan Reed',
    sermonSeries: 'Beginnings',
    anchors: [{ kind: 'scripture', outlineEntryId: 'gen-1-creation', ...GENESIS_1_1_3 }],
    scriptureRefs: ['Ps 8:3-4'],
    notes: 'God spoke and it **was**.\nNothing was there before.',
    reflection: 'I keep thinking about the *void*, and how little I make of my own days.',
    prayer: 'Let there be light in me.',
    tags: ['creation', 'beginnings'],
    links: [{ url: 'https://example.org/sermon', label: 'The recording', capturedTitle: 'Genesis 1 — First Baptist', capturedAt: '2026-01-05T09:00:00.000Z' }],
  }),
  makeEntry({
    id: 'b',
    title: 'The other side of the sea',
    date: '2027-06-20',
    kind: 'reflection',
    anchors: [
      { kind: 'scripture', ...MARK_4_35_5_2 },
      { kind: 'topic', topicId: 'grief' },
      { kind: 'book', book: 'psalms' },
    ],
    notes: '- He was asleep\n- They were afraid',
    reflection: 'This is the one I want you to read.',
    forDescendants: true,
  }),
];

// ---------------------------------------------------------------------------
// Document shape
// ---------------------------------------------------------------------------

describe('renderBook: the document', () => {
  it('is a complete, titled, English HTML document', () => {
    const html = renderBook(makeContext(RICH_JOURNAL));
    expect(html.startsWith('<!doctype html>')).toBe(true);

    const doc = parse(html);
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
    expect(doc.title).toBe('My Journey with God');
    expect(doc.querySelector('meta[charset]')).not.toBeNull();
    expect(doc.querySelector('meta[name="viewport"]')).not.toBeNull();
  });

  it('loads nothing from anywhere: no scripts, no links, no external assets', () => {
    const html = renderBook(makeContext(RICH_JOURNAL));
    const doc = parse(html);

    expect(doc.querySelectorAll('script, link, img, iframe, object, embed, video, audio, source, picture')).toHaveLength(0);
    expect(doc.querySelectorAll('style')).toHaveLength(1);
    expect(html).not.toContain('@import');
    expect(html).not.toContain('url(http');
    expect(html).not.toContain('fonts.googleapis');

    // The only absolute URLs in the file are ones the journal-keeper typed.
    const external = [...html.matchAll(/https?:\/\/[^\s"'<)]+/g)].map((m) => m[0]);
    expect(external).toEqual(['https://example.org/sermon', 'https://example.org/sermon']);
  });

  it('has one h1 and never skips a heading level', () => {
    const levels = headingLevels(parse(renderBook(makeContext(RICH_JOURNAL))));

    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  it('provides landmarks and labelled sections', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));

    expect(doc.querySelector('main')).not.toBeNull();
    expect(doc.querySelector('nav#contents')).not.toBeNull();
    expect(doc.querySelector('footer#colophon')).not.toBeNull();

    for (const section of doc.querySelectorAll('section, nav, footer')) {
      const labelledBy = section.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(doc.getElementById(labelledBy!)).not.toBeNull();
    }
  });

  it('keeps list semantics on the lists whose markers are styled away', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    for (const selector of ['.meta', '.toc-sections', '.toc-years', '.toc-entries', '.links']) {
      const list = doc.querySelector(selector);
      expect(list, selector).not.toBeNull();
      expect(list!.getAttribute('role'), selector).toBe('list');
    }
  });

  it('carries print rules for page breaks and paper colours', () => {
    const css = parse(renderBook(makeContext(RICH_JOURNAL))).querySelector('style')!.textContent!;
    expect(css).toContain('@media print');
    expect(css).toContain('@page');
    expect(css).toMatch(/\.entry\s*\{\s*break-inside:\s*avoid/);
    expect(css).toContain('orphans');
    expect(css).toContain('widows');
  });

  it('is deterministic', () => {
    const first = renderBook(makeContext(RICH_JOURNAL));
    const second = renderBook(makeContext(RICH_JOURNAL));
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// Title page, foreword, colophon
// ---------------------------------------------------------------------------

describe('renderBook: front and back matter', () => {
  it('states the date range, the entry count and the export date', () => {
    const page = parse(renderBook(makeContext(RICH_JOURNAL))).querySelector('.title-page')!;

    expect(page.querySelector('h1')!.textContent).toBe('My Journey with God');
    expect(page.querySelector('.span')!.textContent).toBe('January 4, 2026 – June 20, 2027');
    expect(page.querySelector('.count')!.textContent).toBe('2 entries');
    expect(page.querySelector('.exported')!.textContent).toBe('Made September 13, 2026');
  });

  it('uses the singular for one entry and one date', () => {
    const page = parse(renderBook(makeContext([RICH_JOURNAL[0]]))).querySelector('.title-page')!;
    expect(page.querySelector('.count')!.textContent).toBe('1 entry');
    expect(page.querySelector('.span')!.textContent).toBe('January 4, 2026');
  });

  it('says plainly when the copy is partial, and what was kept', () => {
    const ctx = makeContext(RICH_JOURNAL, {
      excludedCount: 47,
      filter: { from: '2026-01-01', to: '2027-12-31', kinds: ['sermon'], forDescendantsOnly: false },
    });
    const page = parse(renderBook(ctx)).querySelector('.title-page')!;

    expect(page.querySelector('.scope')!.textContent).toContain('partial copy');
    expect(page.querySelector('.scope')!.textContent).toContain('2 entries of 49');
    expect(page.querySelector('.scope')!.textContent).toContain('47 entries were left out');
    expect(page.querySelector('.scope-detail')!.textContent).toContain(
      'dated between January 1, 2026 and December 31, 2027',
    );
    expect(page.querySelector('.scope-detail')!.textContent).toContain('of the kinds Sermon');
  });

  it('claims nothing about scope on a full export', () => {
    const page = parse(renderBook(makeContext(RICH_JOURNAL))).querySelector('.title-page')!;
    expect(page.querySelector('.scope')).toBeNull();
    expect(page.querySelector('.scope-detail')).toBeNull();
  });

  it('explains the app, the two kinds of writing, and the KJV', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    const foreword = doc.querySelector('.foreword')!.textContent!;
    const colophon = doc.querySelector('#colophon')!.textContent!;

    expect(foreword).toContain('Journey');
    expect(foreword).toContain('Notes');
    expect(foreword).toContain('Reflection');
    expect(colophon).toContain('King James Version');
    expect(colophon).toContain('1611');
    expect(colophon).toContain('notes');
    expect(colophon).toContain('journey.json');
  });
});

// ---------------------------------------------------------------------------
// The descendants section
// ---------------------------------------------------------------------------

describe('renderBook: for those who come after', () => {
  it('comes before the journal and holds every flagged entry in full', () => {
    const html = renderBook(makeContext(RICH_JOURNAL));
    const doc = parse(html);
    const section = doc.querySelector('#for-those-who-come-after')!;

    expect(section).not.toBeNull();
    expect(html.indexOf('id="for-those-who-come-after"')).toBeLessThan(html.indexOf('id="journal"'));

    const entries = section.querySelectorAll('.entry');
    expect(entries).toHaveLength(1);
    expect(entries[0].querySelector('h3')!.textContent).toBe('The other side of the sea');
    // In full: the reflection travels with it, not just a pointer.
    expect(entries[0].textContent).toContain('This is the one I want you to read.');
  });

  it('points each repeated entry at its place in the chronological body', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    const crossRef = doc.querySelector('#for-those-who-come-after .cross-ref a')!;

    const target = crossRef.getAttribute('href')!.slice(1);
    expect(doc.getElementById(target)).not.toBeNull();
    expect(doc.getElementById(target)!.closest('#journal')).not.toBeNull();
  });

  it('is omitted entirely when nothing is flagged', () => {
    const entries = RICH_JOURNAL.map((entry) => ({ ...entry, forDescendants: false }));
    const doc = parse(renderBook(makeContext(entries)));

    expect(doc.querySelector('#for-those-who-come-after')).toBeNull();
    expect(doc.body.textContent).not.toContain('For those who come after');
  });
});

// ---------------------------------------------------------------------------
// Contents
// ---------------------------------------------------------------------------

describe('renderBook: contents', () => {
  it('links every entry to an id that exists, grouped by year', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    const nav = doc.querySelector('nav#contents')!;

    const years = [...nav.querySelectorAll('.toc-year')].map((el) => el.textContent);
    expect(years).toEqual(['2026', '2027']);

    const links = [...nav.querySelectorAll('a')];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = link.getAttribute('href')!;
      expect(href.startsWith('#')).toBe(true);
      expect(doc.getElementById(href.slice(1))).not.toBeNull();
    }
  });

  it('gives every element in the document a unique id', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    const ids = [...doc.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('files an unparseable date under Undated rather than dropping it', () => {
    const entries = [makeEntry({ id: 'x', title: 'Sometime', date: 'who knows' })];
    const doc = parse(renderBook(makeContext(entries)));

    expect(doc.querySelector('.toc-year')!.textContent).toBe('Undated');
    // No fake machine-readable date is invented for it.
    expect(doc.querySelector('.entry time')).toBeNull();
    expect(doc.querySelector('.entry .meta')!.textContent).toContain('who knows');
  });
});

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

describe('renderBook: an entry', () => {
  it('carries its date, kind, place, speaker and series', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    const meta = doc.querySelector('#journal .entry .meta')!;

    expect(meta.querySelector('time')!.getAttribute('datetime')).toBe('2026-01-04');
    expect(meta.querySelector('time')!.textContent).toBe('Sunday, January 4, 2026');
    expect(meta.textContent).toContain('Sermon');
    expect(meta.textContent).toContain('First Baptist, Tallahassee, FL');
    expect(meta.textContent).toContain('Speaker: Rev. Alan Reed');
    expect(meta.textContent).toContain('Series: Beginnings');
  });

  it('sets the reflection apart from the notes, with its own heading', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    const entry = doc.querySelector('#journal .entry')!;

    const headings = [...entry.querySelectorAll('h4')].map((h) => h.textContent);
    expect(headings).toContain('Notes');
    expect(headings).toContain('Reflection');
    expect(headings).toContain('Prayer');

    const notes = entry.querySelector('.notes')!;
    const reflection = entry.querySelector('.reflection')!;
    expect(notes.textContent).toContain('God spoke and it was.');
    expect(reflection.textContent).toContain('how little I make of my own days');
    // Separate containers, so the two can be told apart by eye and by markup.
    expect(reflection.contains(notes)).toBe(false);
    expect(entry.querySelector('.prayer')!.textContent).toContain('Let there be light in me.');
  });

  it('omits sections the entry does not have', () => {
    const entries = [makeEntry({ id: 'bare', title: 'Just a line', notes: 'Something.' })];
    const entry = parse(renderBook(makeContext(entries))).querySelector('#journal .entry')!;

    expect([...entry.querySelectorAll('h4')].map((h) => h.textContent)).toEqual(['Notes']);
    expect(entry.querySelector('.reflection')).toBeNull();
    expect(entry.querySelector('.prayer')).toBeNull();
    expect(entry.querySelector('.tags')).toBeNull();
    expect(entry.querySelector('.links')).toBeNull();
  });

  it('names an untitled entry by its kind and date', () => {
    const entries = [makeEntry({ id: 'u', title: '   ', kind: 'prayer', date: '2026-04-05' })];
    const doc = parse(renderBook(makeContext(entries)));
    expect(doc.querySelector('#journal .entry h3')!.textContent).toBe('Prayer, April 5, 2026');
  });

  it('links to the note file using the archive path, never a re-derived one', () => {
    const ctx = makeContext(RICH_JOURNAL);
    const doc = parse(renderBook(ctx));
    const link = doc.querySelector('#journal .entry .source-file a')!;

    expect(link.getAttribute('href')).toBe(`../${ctx.noteFilenames.get('a')}`);
    expect(link.getAttribute('href')).toBe('../notes/2026-01-04--sermon--the-first-day.md');
  });

  it('names topic and book anchors, which have nowhere else to go', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    const subjects = doc.querySelector('#journal .entry:nth-of-type(2) .subjects')!;

    expect(subjects.textContent).toContain('Grief');
    expect(subjects.textContent).toContain('The book of Psalms');
  });

  it('keeps free-form references as the writer typed them', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    expect(doc.querySelector('#journal .mentioned')!.textContent).toBe('Also mentioned: Ps 8:3-4');
  });

  it('prints a link URL as visible text, since the link will be dead', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    const item = doc.querySelector('#journal .links li')!;

    expect(item.querySelector('a')!.getAttribute('href')).toBe('https://example.org/sermon');
    expect(item.querySelector('.url')!.textContent).toBe('https://example.org/sermon');
    expect(item.querySelector('.captured')!.textContent).toBe('saved January 5, 2026');
  });

  it('refuses a javascript: link but still shows what it said', () => {
    const entries = [
      makeEntry({ id: 'js', title: 'Odd link', links: [{ url: 'javascript:alert(1)', label: 'Tap me' }] }),
    ];
    const html = renderBook(makeContext(entries));
    const doc = parse(html);

    expect(doc.querySelector('.links a')).toBeNull();
    expect(doc.querySelector('.links li')!.textContent).toContain('Tap me');
    expect(doc.querySelector('.links .url')!.textContent).toBe('javascript:alert(1)');
    expect(html).not.toContain('href="javascript:');
  });
});

// ---------------------------------------------------------------------------
// Scripture
// ---------------------------------------------------------------------------

describe('renderBook: scripture', () => {
  it('prints the KJV text for an anchored passage, with verse numbers', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    const entry = doc.querySelector('#journal .entry')!;

    expect(entry.querySelector('.scripture-heading')!.textContent).toContain('Genesis 1:1-3');
    // The outline layer enriches the heading when it is present.
    expect(entry.querySelector('.outline-title')!.textContent).toBe('The Creation');

    const passage = entry.querySelector('.passage')!;
    expect(passage.textContent).toContain('In the beginning God created the heaven and the earth.');
    expect([...passage.querySelectorAll('.verse-num')].map((el) => el.textContent)).toEqual(['1', '2', '3']);
  });

  it('marks the chapter where a passage crosses a boundary, and only then', () => {
    const doc = parse(renderBook(makeContext(RICH_JOURNAL)));
    const entries = doc.querySelectorAll('#journal .entry');

    expect(entries[0].querySelectorAll('.chapter-mark')).toHaveLength(0);
    const marks = [...entries[1].querySelectorAll('.chapter-mark')].map((el) => el.textContent);
    expect(marks).toEqual(['Chapter 5']);
  });

  it('says so plainly when the text was not included', () => {
    const entries = [
      makeEntry({ id: 'missing', title: 'No text', anchors: [{ kind: 'scripture', ...GENESIS_1_1_3 }] }),
    ];
    const ctx = makeContext(entries, { passages: new Map() });
    const entry = parse(renderBook(ctx)).querySelector('#journal .entry')!;

    expect(entry.querySelector('.scripture-heading')!.textContent).toContain('Genesis 1:1-3');
    expect(entry.querySelector('.absent')!.textContent).toContain('not included in this copy');
  });

  it('prints a repeated reference once', () => {
    const entries = [
      makeEntry({
        id: 'dupe',
        anchors: [
          { kind: 'scripture', ...GENESIS_1_1_3 },
          { kind: 'scripture', outlineEntryId: 'gen-1-creation', ...GENESIS_1_1_3 },
        ],
      }),
    ];
    const entry = parse(renderBook(makeContext(entries))).querySelector('#journal .entry')!;
    expect(entry.querySelectorAll('.passage')).toHaveLength(1);
  });

  it('falls back to spelling out a reference whose book it does not know', () => {
    const ref: ScriptureRef = { book: 'unknown-book', chapterStart: 2, verseStart: 4, chapterEnd: 3, verseEnd: 1 };
    const entries = [makeEntry({ id: 'odd', anchors: [{ kind: 'scripture', ...ref }] })];
    const entry = parse(renderBook(makeContext(entries))).querySelector('#journal .entry')!;

    expect(entry.querySelector('.scripture-heading')!.textContent).toBe('unknown-book 2:4-3:1');
  });
});

// ---------------------------------------------------------------------------
// Profiles and degenerate input
// ---------------------------------------------------------------------------

describe('renderBook: profiles and edges', () => {
  it('reads correctly under refs-only, where no outline resolves', () => {
    const ctx = makeContext(RICH_JOURNAL, {
      profile: 'refs-only',
      outlineBooks: new Map(),
      outlineEntries: new Map(),
    });
    const html = renderBook(ctx);
    const doc = parse(html);

    expect(doc.querySelector('.outline-title')).toBeNull();
    expect(doc.querySelector('#journal .scripture-heading')!.textContent).toBe('Genesis 1:1-3');
    expect(doc.querySelector('#colophon')!.textContent).toContain('chapter and verse');
    // Nothing leaks a failed lookup into the page.
    expect(doc.body.textContent).not.toContain('undefined');
    expect(doc.body.textContent).not.toContain('[object Object]');
  });

  it('still produces a whole book from an empty journal', () => {
    const doc = parse(renderBook(makeContext([])));

    expect(doc.title).toBe('My Journey with God');
    expect(doc.querySelector('.count')!.textContent).toBe('0 entries');
    expect(doc.querySelector('.span')).toBeNull();
    expect(doc.querySelector('#journal .absent')!.textContent).toContain('no entries');
    expect(doc.querySelector('#colophon')).not.toBeNull();
    expect(headingLevels(doc).filter((level) => level === 1)).toHaveLength(1);
  });

  it('names a topic by its id when the topic is not in this archive', () => {
    const entries = [makeEntry({ id: 't', anchors: [{ kind: 'topic', topicId: 'gone' }] })];
    const entry = parse(renderBook(makeContext(entries, { topics: new Map() }))).querySelector('#journal .entry')!;
    expect(entry.querySelector('.subjects')!.textContent).toContain('gone');
  });
});

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

describe('renderBook: user content is never markup', () => {
  it('escapes titles, places and speakers', () => {
    const entries = [
      makeEntry({
        id: 'x',
        title: '<script>alert("x")</script> & Co.',
        place: 'St. <b>Mary</b>’s',
        speaker: "O'Brien & son",
      }),
    ];
    const html = renderBook(makeContext(entries));
    const doc = parse(html);

    expect(doc.querySelectorAll('script')).toHaveLength(0);
    expect(doc.querySelector('#journal .entry h3')!.textContent).toBe('<script>alert("x")</script> & Co.');
    expect(doc.querySelector('#journal .meta')!.textContent).toContain('St. <b>Mary</b>’s');
    expect(doc.querySelector('#journal .meta')!.textContent).toContain("O'Brien & son");
  });

  it('escapes scripture text and tags', () => {
    const ref: ScriptureRef = { book: 'genesis', chapterStart: 1, verseStart: 1, chapterEnd: 1, verseEnd: 1 };
    const entries = [makeEntry({ id: 'v', anchors: [{ kind: 'scripture', ...ref }], tags: ['<i>hope</i>'] })];
    const ctx = makeContext(entries, {
      passages: new Map([[refKey(ref), [{ chapter: 1, number: 1, text: 'a < b & c > d' }]]]),
    });
    const doc = parse(renderBook(ctx));

    expect(doc.querySelector('.passage')!.textContent).toContain('a < b & c > d');
    expect(doc.querySelector('.passage i')).toBeNull();
    expect(doc.querySelector('.tags')!.textContent).toBe('Tags: <i>hope</i>');
  });

  it('shows raw HTML typed into notes as text, not as markup', () => {
    const entries = [
      makeEntry({ id: 'h', notes: 'He said <b>this</b>.\n<img src=x onerror=alert(1)>' }),
    ];
    const doc = parse(renderBook(makeContext(entries)));
    const notes = doc.querySelector('.notes')!;

    expect(notes.querySelector('b')).toBeNull();
    expect(doc.querySelectorAll('img')).toHaveLength(0);
    expect(notes.textContent).toContain('He said <b>this</b>.');
    expect(notes.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

// ---------------------------------------------------------------------------
// The markdown renderer, on its own
// ---------------------------------------------------------------------------

describe('renderMarkdown', () => {
  const text = (html: string): string => {
    const doc = parse(`<div id="root">${html}</div>`);
    return doc.getElementById('root')!.textContent ?? '';
  };

  it('makes a paragraph per blank-line-separated block', () => {
    expect(renderMarkdown('One.\n\nTwo.')).toBe('<p>One.</p>\n<p>Two.</p>');
  });

  it('keeps single newlines as real line breaks', () => {
    expect(renderMarkdown('Ragged\nlines')).toBe('<p>Ragged<br>lines</p>');
  });

  it('renders bold, italic and code', () => {
    expect(renderMarkdown('**loud** and *soft* and `exact`')).toBe(
      '<p><strong>loud</strong> and <em>soft</em> and <code>exact</code></p>',
    );
    expect(renderMarkdown('__loud__ and _soft_')).toBe('<p><strong>loud</strong> and <em>soft</em></p>');
  });

  it('leaves underscores inside words alone', () => {
    expect(renderMarkdown('journey_export_v1 and snake_case_name')).toBe(
      '<p>journey_export_v1 and snake_case_name</p>',
    );
  });

  it('renders bullet lists, including wrapped items', () => {
    expect(renderMarkdown('- one\n- two\n  still two')).toBe('<ul><li>one</li><li>two still two</li></ul>');
  });

  it('renders numbered lists and keeps a start other than one', () => {
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    expect(renderMarkdown('3. c\n4. d')).toBe('<ol start="3"><li>c</li><li>d</li></ol>');
  });

  it('separates two adjacent lists of different kinds', () => {
    expect(renderMarkdown('- a\n1. b')).toBe('<ul><li>a</li></ul>\n<ol><li>b</li></ol>');
  });

  it('renders block quotes and rules', () => {
    expect(renderMarkdown('> quoted\n> again')).toBe('<blockquote><p>quoted<br>again</p></blockquote>');
    expect(renderMarkdown('a\n\n---\n\nb')).toBe('<p>a</p>\n<hr>\n<p>b</p>');
  });

  it('renders a heading as bold text, never as a heading element', () => {
    // A stray `#` in an entry must not inject an h1 and wreck the outline.
    const html = renderMarkdown('# Shout\n\nthen');
    expect(html).toBe('<p class="md-heading"><strong>Shout</strong></p>\n<p>then</p>');
    expect(parse(html).querySelector('h1')).toBeNull();
  });

  it('renders a safe link and neuters an unsafe one without losing it', () => {
    expect(renderMarkdown('[here](https://example.org/a)')).toBe(
      '<p><a href="https://example.org/a" rel="noreferrer">here</a></p>',
    );
    const unsafe = renderMarkdown('[tap](javascript:alert(1))');
    expect(unsafe).not.toContain('<a ');
    expect(text(unsafe)).toContain('tap');
    expect(text(unsafe)).toContain('javascript:alert(1)');
  });

  it('escapes everything it does not turn into markup', () => {
    const html = renderMarkdown('**<b>x</b>** & `<i>y</i>` & [<u>z</u>](https://e.org/?a=1&b=2)');
    expect(parse(html).querySelectorAll('b, i, u')).toHaveLength(0);
    expect(text(html)).toContain('<b>x</b>');
    expect(text(html)).toContain('<i>y</i>');
    expect(html).toContain('href="https://e.org/?a=1&amp;b=2"');
  });

  it('returns nothing for empty or whitespace-only input', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   \n\n  ')).toBe('');
  });

  it('terminates on input that looks like a list but is not', () => {
    // A guard against the block walk failing to consume a line.
    expect(renderMarkdown('-\n*\n+\n>\n#\n1.')).toContain('<p>');
  });
});

describe('escapeHtml', () => {
  it('escapes the five characters that matter in text and attributes alike', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('escapes ampersands once, not twice', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });
});
