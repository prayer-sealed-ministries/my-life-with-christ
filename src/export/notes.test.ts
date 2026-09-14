import { beforeAll, describe, expect, it } from 'vitest';

import { describeRef, formatEventDate, parseScriptureRef, renderNote } from './notes';
import { refKey, type ExportContext } from './context';
import { loadPassage, type PassageVerse } from '../lib/bible';
import versification from '../data/kjv/versification.json';
import type { Entry, EntryAnchor, ScriptureRef } from '../types';

const counts = versification as Record<string, number[]>;

/**
 * "song-of-solomon" -> "Song of Solomon".
 *
 * The real context gets display names from the canon data; a test only needs
 * them to be the names a person would type, so that the free-text reference
 * parser is exercised against something realistic.
 */
const prettyName = (id: string): string =>
  id
    .split('-')
    .map((part) => (/^\d+$/.test(part) ? part : part[0].toUpperCase() + part.slice(1)))
    .join(' ');

const BOOK_NAMES = new Map(Object.keys(counts).map((id) => [id, prettyName(id)]));

const ref = (
  book: string,
  chapterStart: number,
  verseStart: number,
  chapterEnd = chapterStart,
  verseEnd = verseStart,
): ScriptureRef => ({ book, chapterStart, verseStart, chapterEnd, verseEnd });

const MATTHEW_5 = ref('matthew', 5, 1, 5, 12);
const ACROSS_CHAPTERS = ref('matthew', 5, 47, 6, 2);
const JOHN_3_16 = ref('john', 3, 16);

/** Real KJV text, loaded the same way the export builder loads it. */
const passages = new Map<string, PassageVerse[]>();

beforeAll(async () => {
  for (const target of [MATTHEW_5, ACROSS_CHAPTERS, JOHN_3_16]) {
    passages.set(refKey(target), await loadPassage(target));
  }
});

function context(overrides: Partial<ExportContext> = {}): ExportContext {
  return {
    entries: [],
    excludedCount: 0,
    exportedAt: '2026-09-13T12:00:00.000Z',
    profile: 'full',
    bookNames: BOOK_NAMES,
    bookOrder: new Map(Object.keys(counts).map((id, index) => [id, index + 1])),
    outlineBooks: new Map(),
    outlineEntries: new Map(),
    topics: new Map([
      ['comfort', { id: 'comfort', name: 'Comfort in grief', description: 'When someone has died.', refs: [] }],
    ]),
    passages,
    noteFilenames: new Map([['e1', 'notes/2026-04-12--sermon--the-beatitudes.md']]),
    ...overrides,
  };
}

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    kind: 'sermon',
    title: 'The Beatitudes',
    date: '2026-04-12',
    anchors: [],
    scriptureRefs: [],
    notes: 'He preached from the mountain.',
    reflection: '',
    links: [],
    tags: [],
    forDescendants: false,
    visibility: 'private',
    createdAt: '2026-04-12T18:03:00.000Z',
    updatedAt: '2026-04-12T18:03:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// A deliberately strict YAML reader.
//
// The promise this module makes is that a parser in 2060 can read the front
// matter, so the test does not eyeball strings — it parses them, and refuses
// anything outside the small subset the generator claims to emit. Bad
// indentation, an unquoted value carrying a colon, a stray tab: all throw.
// ---------------------------------------------------------------------------

// An interface breaks the reference cycle a bare recursive type alias cannot.
type YamlScalar = string | number | boolean;
interface YamlMap {
  [key: string]: YamlValue;
}
type YamlValue = YamlScalar | YamlValue[] | YamlMap;

function parseScalar(text: string): YamlValue {
  if (text === '[]') return [];
  if (text === "''") return '';
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) throw new Error(`unterminated quote: ${text}`);
    return text
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (/[:#]/.test(text)) throw new Error(`unquoted value would not parse: ${text}`);
  return text;
}

function parseFrontMatter(markdown: string): Record<string, YamlValue> {
  const lines = markdown.split('\n');
  if (lines[0] !== '---') throw new Error('no front matter');
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new Error('front matter is not closed');

  const out: Record<string, YamlValue> = {};
  let listKey: string | null = null;

  for (const line of lines.slice(1, end)) {
    if (line.includes('\t')) throw new Error(`tab in front matter: ${line}`);

    const top = /^([A-Za-z][A-Za-z0-9]*): ?(.*)$/.exec(line);
    if (top && !line.startsWith(' ')) {
      const [, key, value] = top;
      if (value === '') {
        listKey = key;
        out[key] = [];
      } else {
        listKey = null;
        out[key] = parseScalar(value);
      }
      continue;
    }

    if (!listKey) throw new Error(`unreadable line: ${line}`);
    const list = out[listKey] as YamlValue[];

    const item = /^ {2}- (.*)$/.exec(line);
    if (item) {
      const field = /^([A-Za-z][A-Za-z0-9]*): (.*)$/.exec(item[1]);
      list.push(field ? { [field[1]]: parseScalar(field[2]) } : parseScalar(item[1]));
      continue;
    }

    const continuation = /^ {4}([A-Za-z][A-Za-z0-9]*): (.*)$/.exec(line);
    if (!continuation) throw new Error(`unreadable line: ${line}`);
    const last = list[list.length - 1];
    if (typeof last !== 'object' || Array.isArray(last)) throw new Error(`orphan field: ${line}`);
    (last as Record<string, YamlValue>)[continuation[1]] = parseScalar(continuation[2]);
  }

  return out;
}

const bodyOf = (markdown: string): string => markdown.split('\n---\n').slice(1).join('\n---\n');

// ---------------------------------------------------------------------------

describe('front matter', () => {
  it('carries every structured field, and parses back to what went in', () => {
    const anchors: EntryAnchor[] = [
      { kind: 'scripture', outlineEntryId: 'mt-5-1', ...MATTHEW_5 },
      { kind: 'topic', topicId: 'comfort' },
      { kind: 'book', book: 'matthew' },
    ];
    const note = renderNote(
      entry({
        title: 'Blessed: a sermon',
        place: 'First Baptist, Tallahassee, FL',
        speaker: 'Bill Smith',
        sermonSeries: 'Sermon on the Mount',
        anchors,
        scriptureRefs: ['John 3:16'],
        tags: ['blessing', 'grief'],
        links: [{ url: 'https://example.org/a', label: 'Audio', capturedTitle: 'Part 1', capturedAt: '2026-04-13T09:00:00.000Z' }],
        forDescendants: true,
      }),
      context(),
    );

    const front = parseFrontMatter(note);
    expect(front.id).toBe('e1');
    expect(front.title).toBe('Blessed: a sermon');
    expect(front.kind).toBe('sermon');
    expect(front.date).toBe('2026-04-12');
    expect(front.place).toBe('First Baptist, Tallahassee, FL');
    expect(front.speaker).toBe('Bill Smith');
    expect(front.sermonSeries).toBe('Sermon on the Mount');
    expect(front.tags).toEqual(['blessing', 'grief']);
    expect(front.scriptureRefs).toEqual(['John 3:16']);
    expect(front.forDescendants).toBe(true);
    expect(front.visibility).toBe('private');
    expect(front.createdAt).toBe('2026-04-12T18:03:00.000Z');
    expect(front.updatedAt).toBe('2026-04-12T18:03:00.000Z');

    expect(front.anchors).toEqual([
      {
        kind: 'scripture',
        reference: 'Matthew 5:1-12',
        book: 'matthew',
        chapterStart: 5,
        verseStart: 1,
        chapterEnd: 5,
        verseEnd: 12,
        outlineEntryId: 'mt-5-1',
      },
      { kind: 'topic', topicId: 'comfort', topic: 'Comfort in grief' },
      { kind: 'book', book: 'matthew', bookName: 'Matthew' },
    ]);

    expect(front.links).toEqual([
      { url: 'https://example.org/a', label: 'Audio', capturedTitle: 'Part 1', capturedAt: '2026-04-13T09:00:00.000Z' },
    ]);
  });

  it('omits optional scalars that hold nothing, but keeps empty lists visible', () => {
    const front = parseFrontMatter(renderNote(entry(), context()));

    expect(front).not.toHaveProperty('place');
    expect(front).not.toHaveProperty('speaker');
    expect(front).not.toHaveProperty('sermonSeries');
    expect(front.tags).toEqual([]);
    expect(front.anchors).toEqual([]);
    expect(front.scriptureRefs).toEqual([]);
    expect(front.links).toEqual([]);
  });

  it('survives a title that would otherwise break the document', () => {
    const front = parseFrontMatter(
      renderNote(entry({ title: '---\nnot: front matter "really"' }), context()),
    );
    expect(front.title).toBe('---\nnot: front matter "really"');
  });

  it('leaves outlineEntryId out when the anchor has none', () => {
    const front = parseFrontMatter(
      renderNote(entry({ anchors: [{ kind: 'scripture', ...MATTHEW_5 }] }), context()),
    );
    expect(front.anchors).toEqual([
      {
        kind: 'scripture',
        reference: 'Matthew 5:1-12',
        book: 'matthew',
        chapterStart: 5,
        verseStart: 1,
        chapterEnd: 5,
        verseEnd: 12,
      },
    ]);
  });
});

describe('the human part', () => {
  it('spells the date out and labels what would otherwise be a bare name', () => {
    const note = renderNote(
      entry({
        place: 'First Baptist, Tallahassee, FL',
        speaker: 'Bill Smith',
        sermonSeries: 'Sermon on the Mount',
      }),
      context(),
    );

    expect(bodyOf(note)).toContain('# The Beatitudes');
    expect(bodyOf(note)).toContain(
      'Sermon · 12 April 2026 · at First Baptist, Tallahassee, FL · Speaker: Bill Smith · Series: Sermon on the Mount',
    );
  });

  it('keeps notes and reflection apart, verbatim', () => {
    const note = renderNote(
      entry({ notes: 'He said:\n\n- one\n- two', reflection: 'I have been the one who walked away.' }),
      context(),
    );

    expect(note).toContain('## Notes\n\nHe said:\n\n- one\n- two\n\n## Reflection\n\nI have been the one who walked away.');
  });

  it('never leaves a heading standing over nothing', () => {
    const note = renderNote(entry({ reflection: '   \n\n', prayer: '' }), context());
    expect(note).not.toContain('## Reflection');
    expect(note).not.toContain('## Prayer');
    expect(note).not.toContain('## Links');
    expect(note.endsWith('\n')).toBe(true);
    expect(note.endsWith('\n\n')).toBe(false);
  });

  it('renders a prayer when there is one', () => {
    const note = renderNote(entry({ prayer: 'Teach me to be poor in spirit.' }), context());
    expect(note).toContain('## Prayer\n\nTeach me to be poor in spirit.');
  });
});

describe('links', () => {
  it('still says what a dead link was', () => {
    const note = renderNote(
      entry({
        links: [
          {
            url: 'https://firstbaptist.example/sermons/2026-04-12',
            label: 'Sermon audio',
            capturedTitle: 'The Beatitudes, Part 1',
            capturedAt: '2026-04-13T09:00:00.000Z',
          },
        ],
      }),
      context(),
    );

    expect(note).toContain(
      '- [Sermon audio](https://firstbaptist.example/sermons/2026-04-12) — "The Beatitudes, Part 1" (captured 13 April 2026)',
    );
  });

  it('shows the URL itself when there is no label', () => {
    const note = renderNote(entry({ links: [{ url: 'https://example.org/x' }] }), context());
    expect(note).toContain('- <https://example.org/x>');
  });

  it('does not let a URL with parentheses break out of the link', () => {
    const note = renderNote(
      entry({ links: [{ url: 'https://example.org/a_(b)', label: 'Notes' }] }),
      context(),
    );
    expect(note).toContain('- [Notes](<https://example.org/a_(b)>)');
  });
});

describe('scripture', () => {
  it('embeds the real KJV text of a scripture anchor', () => {
    const note = renderNote(
      entry({ anchors: [{ kind: 'scripture', outlineEntryId: 'mt-5-1', ...MATTHEW_5 }] }),
      context(),
    );

    expect(note).toContain('## Scripture (King James Version)');
    expect(note).toContain('King James Version');
    expect(note).toContain('### Matthew 5:1-12');
    expect(note).toContain('**3** Blessed are the poor in spirit');
    expect(note).toContain('**12** Rejoice, and be exceeding glad');
    // Twelve verses, every one of them numbered and on its own line.
    expect(note.match(/^\*\*\d+\*\* /gm)).toHaveLength(12);
  });

  it('embeds a reference the writer only cited in prose', () => {
    const note = renderNote(entry({ scriptureRefs: ['John 3:16'] }), context());
    expect(note).toContain('### John 3:16');
    expect(note).toContain('**16** For God so loved the world');
  });

  it('prints a passage once when it is both the anchor and a cited reference', () => {
    const note = renderNote(
      entry({ anchors: [{ kind: 'scripture', ...JOHN_3_16 }], scriptureRefs: ['John 3:16'] }),
      context(),
    );
    expect(note.match(/### John 3:16/g)).toHaveLength(1);
  });

  it('numbers verses with their chapter only when the passage crosses one', () => {
    const note = renderNote(
      entry({ anchors: [{ kind: 'scripture', ...ACROSS_CHAPTERS }] }),
      context(),
    );

    expect(note).toContain('### Matthew 5:47-6:2');
    expect(note).toContain('**5:47** ');
    expect(note).toContain('**6:1** ');
    expect(note).not.toContain('**1** Take heed');
  });

  it('says nothing at all when no passage resolved, and still records the reference', () => {
    const missing = ref('habakkuk', 3, 17, 3, 19);
    const note = renderNote(
      entry({ anchors: [{ kind: 'scripture', ...missing }], scriptureRefs: ['Nowhere 4:5'] }),
      context(),
    );

    expect(note).not.toContain('## Scripture');
    // Nothing is hidden: both references are still written down in full.
    const front = parseFrontMatter(note);
    expect(front.anchors).toEqual([
      { kind: 'scripture', reference: 'Habakkuk 3:17-19', book: 'habakkuk', chapterStart: 3, verseStart: 17, chapterEnd: 3, verseEnd: 19 },
    ]);
    expect(front.scriptureRefs).toEqual(['Nowhere 4:5']);
  });
});

describe('under the refs-only profile', () => {
  /**
   * The outline layer is absent entirely. Nothing in a note may depend on it —
   * the file has to read exactly as well without it.
   */
  const refsOnly = () =>
    context({ profile: 'refs-only', outlineBooks: new Map(), outlineEntries: new Map() });

  it('reads identically to the full profile', () => {
    const written = entry({
      anchors: [
        { kind: 'scripture', outlineEntryId: 'mt-5-1', ...MATTHEW_5 },
        { kind: 'book', book: 'matthew' },
      ],
      scriptureRefs: ['John 3:16'],
      reflection: 'It landed hard.',
    });

    const full = renderNote(written, context());
    const lean = renderNote(written, refsOnly());

    expect(lean).toBe(full);
    expect(lean).toContain('### Matthew 5:1-12');
    expect(lean).toContain('**3** Blessed are the poor in spirit');
    // The id is kept as written, never resolved into a title that would vanish.
    expect(lean).toContain('outlineEntryId: mt-5-1');
  });
});

describe('parseScriptureRef', () => {
  it('reads the forms a person actually writes', () => {
    expect(parseScriptureRef('Matthew 5:1-12', BOOK_NAMES)).toEqual(MATTHEW_5);
    expect(parseScriptureRef('John 3:16', BOOK_NAMES)).toEqual(JOHN_3_16);
    expect(parseScriptureRef('Matthew 5:47-6:2', BOOK_NAMES)).toEqual(ACROSS_CHAPTERS);
    expect(parseScriptureRef('1 John 4', BOOK_NAMES)).toEqual(ref('1-john', 4, 1, 4, 21));
    expect(parseScriptureRef('Song of Solomon 2', BOOK_NAMES)).toEqual(ref('song-of-solomon', 2, 1, 2, 17));
  });

  it('treats a bare range as chapters, not verses', () => {
    const parsed = parseScriptureRef('Acts 7-8', BOOK_NAMES);
    expect(parsed).toEqual(ref('acts', 7, 1, 8, 40));
  });

  it('tolerates trailing punctuation and an en dash', () => {
    expect(parseScriptureRef('Mark 4:1–9.', BOOK_NAMES)).toEqual(ref('mark', 4, 1, 4, 9));
  });

  it('refuses anything it is not sure of rather than guessing', () => {
    // Guessing an abbreviation could quote the wrong scripture under the
    // writer's words, which is worse than quoting none.
    expect(parseScriptureRef('Matt 5:1', BOOK_NAMES)).toBeNull();
    expect(parseScriptureRef('the bit about the mountain', BOOK_NAMES)).toBeNull();
    expect(parseScriptureRef('Matthew 99:1', BOOK_NAMES)).toBeNull();
    expect(parseScriptureRef('Matthew 5:60', BOOK_NAMES)).toBeNull(); // chapter 5 ends at 48
    expect(parseScriptureRef('Matthew 5:12-1', BOOK_NAMES)).toBeNull();
    expect(parseScriptureRef('', BOOK_NAMES)).toBeNull();
  });
});

describe('formatEventDate', () => {
  it('does not shift a date across a timezone', () => {
    // new Date('2026-04-12') is UTC midnight, which prints as the 11th in any
    // western timezone. The day an entry is dated must never move.
    expect(formatEventDate('2026-04-12')).toBe('12 April 2026');
    expect(formatEventDate('2026-01-01')).toBe('1 January 2026');
    expect(formatEventDate('2026-12-31')).toBe('31 December 2026');
  });

  it('shows whatever was written when it is not a plain date', () => {
    expect(formatEventDate('sometime in the spring')).toBe('sometime in the spring');
    expect(formatEventDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('describeRef', () => {
  it('still prints the numbers for a book this build has no canon data for', () => {
    const unknown = ref('book-of-eli', 2, 3, 2, 5);
    expect(describeRef(unknown, context())).toBe('book-of-eli 2:3-2:5');
  });
});
