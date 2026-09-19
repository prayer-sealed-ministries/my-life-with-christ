import { beforeAll, describe, expect, it } from 'vitest';

import { describeRef, formatEventDate, parseScriptureRef, renderNote } from './notes';
import { buildContext } from './archive';
import { refKey, type ExportContext } from './context';
import { loadPassage, type PassageVerse } from '../lib/bible';
import { BOOK_NAMES as CANON_NAMES, BOOK_ORDER } from '../lib/canon';
import { ALL_ENTRIES, AWKWARD, SERMON } from './fixtures';
import outlinesFile from '../data/sections.json';
import topicsFile from '../data/topics.json';
import type { Entry, EntryAnchor, OutlineBook, ScriptureRef, Topic } from '../types';

/** The real canon names, exactly as the export builder supplies them. */
const BOOK_NAMES = new Map(Object.entries(CANON_NAMES));

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
const PSALM_37_11 = ref('psalms', 37, 11);

/**
 * Real KJV text, loaded the same way the export builder loads it.
 *
 * These are the unit tests' passages, seeded by hand so each case can say
 * exactly what is and is not available. That a *real* archive puts the right
 * refs in here is a separate promise, and "as the archive actually builds it"
 * below is what proves it — a hand-seeded map can otherwise quietly pass for
 * scripture the builder never loads.
 */
const passages = new Map<string, PassageVerse[]>();

beforeAll(async () => {
  for (const target of [MATTHEW_5, ACROSS_CHAPTERS, JOHN_3_16, PSALM_37_11]) {
    passages.set(refKey(target), await loadPassage(target));
  }
});

function context(overrides: Partial<ExportContext> = {}): ExportContext {
  return {
    entries: [],
    excludedCount: 0,
    exportedAt: '2026-09-13T12:00:00.000Z',
    profile: 'public',
    bookNames: BOOK_NAMES,
    bookOrder: new Map(Object.entries(BOOK_ORDER)),
    outlineBooks: new Map(),
    outlineEntries: new Map(),
    topics: new Map([
      ['comfort', { id: 'comfort', name: 'Comfort in grief', description: 'When someone has died.', aliases: [], refs: [] }],
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
// indentation, an unquoted value carrying a colon, a raw line break: all throw.
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
    // A tab used as indentation is not YAML at all. A tab *inside* a quoted
    // value is ordinary content, and rejecting it here would fail a value the
    // writer is entitled to type.
    if (/^[ ]*\t/.test(line)) throw new Error(`tab indentation in front matter: ${line}`);
    // A bare carriage return is a line break to a YAML parser, so a value
    // carrying one would end its own scalar and come back out as something
    // else. Nothing this generator writes may contain one.
    if (line.includes('\r')) throw new Error(`carriage return in front matter: ${line}`);

    const top = /^([A-Za-z_][A-Za-z0-9_]*): ?(.*)$/.exec(line);
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
      const field = /^([A-Za-z_][A-Za-z0-9_]*): (.*)$/.exec(item[1]);
      list.push(field ? { [field[1]]: parseScalar(field[2]) } : parseScalar(item[1]));
      continue;
    }

    const continuation = /^ {4}([A-Za-z_][A-Za-z0-9_]*): (.*)$/.exec(line);
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

  it('omits an optional scalar that holds only whitespace, exactly as the body does', () => {
    const note = renderNote(entry({ place: '   ', speaker: '\n' }), context());
    const front = parseFrontMatter(note);

    expect(front).not.toHaveProperty('place');
    expect(front).not.toHaveProperty('speaker');
    // The body reached the same conclusion, so the two halves cannot disagree.
    expect(bodyOf(note)).toContain('Sermon · 12 April 2026\n');
  });

  it('always writes the fields an entry is required to have, empty or not', () => {
    // An absent `title` would say the format has no such field, which is false,
    // and would stop the front matter alone from rebuilding the entry.
    const front = parseFrontMatter(
      renderNote(entry({ title: '', date: '', notes: '', kind: 'letter' }), context()),
    );

    expect(front.id).toBe('e1');
    expect(front.title).toBe('');
    expect(front.date).toBe('');
    expect(front.kind).toBe('letter');
    expect(front.visibility).toBe('private');
    expect(front.createdAt).toBe('2026-04-12T18:03:00.000Z');
    expect(front.updatedAt).toBe('2026-04-12T18:03:00.000Z');
  });

  it('survives a title that would otherwise break the document', () => {
    const front = parseFrontMatter(
      renderNote(entry({ title: '---\nnot: front matter "really"' }), context()),
    );
    expect(front.title).toBe('---\nnot: front matter "really"');
  });

  it('escapes a Windows line ending instead of letting it end the scalar', () => {
    // yamlString escapes \n but not \r, and YAML reads a bare \r as a line
    // break — so a title typed on Windows would terminate its own quoted scalar
    // and come back out as something other than what went in.
    const note = renderNote(entry({ title: 'Line one\r\nline two', tags: ['a\rb'] }), context());
    expect(note).not.toContain('\r');

    const front = parseFrontMatter(note);
    expect(front.title).toBe('Line one\nline two');
    expect(front.tags).toEqual(['a\nb']);
  });

  it('keeps a tab inside a value, which is legal YAML content', () => {
    const front = parseFrontMatter(renderNote(entry({ place: 'porch\ttab' }), context()));
    expect(front.place).toBe('porch\ttab');
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

  it('spells out a reference that cannot be laid on the book it names', () => {
    // formatRef answers an impossible range with the bare book name, which would
    // print Genesis 99:1-4 as "Genesis" and read as the whole book.
    const impossible = ref('genesis', 99, 1, 99, 4);
    const front = parseFrontMatter(
      renderNote(entry({ anchors: [{ kind: 'scripture', ...impossible }] }), context()),
    );

    expect(front.anchors).toEqual([
      { kind: 'scripture', reference: 'Genesis 99:1-99:4', book: 'genesis', chapterStart: 99, verseStart: 1, chapterEnd: 99, verseEnd: 4 },
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

  it('keeps the heading and the line of facts on one line each', () => {
    // A newline in a title would split the `#` heading and leave half of it
    // reading as body text; the same in a place name breaks the facts line.
    const note = renderNote(
      entry({ title: 'Line one\r\nline two', place: 'the\nback porch' }),
      context(),
    );

    expect(note).toContain('# Line one line two\n');
    expect(note).toContain('Sermon · 12 April 2026 · at the back porch');
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

  it('renders an entry with nothing in it at all without inventing anything', () => {
    const bare = entry({
      title: '',
      date: '',
      notes: '',
      reflection: '',
      anchors: [],
      scriptureRefs: [],
      links: [],
      tags: [],
      kind: 'letter',
    });
    const note = renderNote(bare, context());

    expect(note).toContain('# Untitled');
    expect(bodyOf(note)).toContain('\nLetter\n');
    expect(note).not.toContain('undefined');
    expect(note).not.toContain('null');
    expect(note).not.toContain('NaN');
    expect(note).not.toContain('About:');
    expect(note).not.toContain('Tags:');
    expect(note).not.toContain('Also mentioned:');
    expect(note.endsWith('\n')).toBe(true);
  });

  it('keeps a title that is nothing but punctuation', () => {
    const note = renderNote(AWKWARD, context());
    expect(note).toContain('# ??? — !!!');
    expect(parseFrontMatter(note).title).toBe('??? — !!!');
  });
});

describe('what the entry is about', () => {
  // The anchors answer the first question anyone asks of an entry, and front
  // matter is not where a person reads. Every anchor has to reach the body.
  it('names scripture, topic and whole-book anchors in the body', () => {
    const note = renderNote(
      entry({
        anchors: [
          { kind: 'scripture', ...MATTHEW_5 },
          { kind: 'topic', topicId: 'comfort' },
          { kind: 'book', book: 'matthew' },
        ],
      }),
      context(),
    );

    expect(note).toContain('About: Matthew 5:1-12 · Comfort in grief (topic) · Matthew (whole book)');
  });

  it('names a topic this archive does not carry by its id rather than dropping it', () => {
    const note = renderNote(entry({ anchors: [{ kind: 'topic', topicId: 'lament' }] }), context());
    expect(note).toContain('About: lament (topic)');
  });

  it('still names a passage whose text could not be included', () => {
    // Habakkuk 3:17-19 is a real passage; this archive has no text for it.
    const missing = ref('habakkuk', 3, 17, 3, 19);
    const note = renderNote(entry({ anchors: [{ kind: 'scripture', ...missing }] }), context());

    expect(note).toContain('About: Habakkuk 3:17-19');
    expect(note).not.toContain('## Scripture');
  });

  it('says the same thing once when an entry anchors it twice', () => {
    const note = renderNote(
      entry({ anchors: [{ kind: 'book', book: 'matthew' }, { kind: 'book', book: 'matthew' }] }),
      context(),
    );
    expect(note).toContain('About: Matthew (whole book)\n');
  });

  it('writes the tags where a person will see them', () => {
    const note = renderNote(entry({ tags: ['beatitudes', 'grace'] }), context());
    expect(note).toContain('Tags: beatitudes, grace');
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

  it('leads with the captured title when there is nothing left to click', () => {
    const note = renderNote(
      entry({ links: [{ url: '', capturedTitle: 'Sunday service, 12 April' }] }),
      context(),
    );
    // Not an em dash hanging off nothing.
    expect(note).toContain('- "Sunday service, 12 April"');
    expect(note).not.toContain('- — ');
  });

  it('drops a link that names neither a destination nor a thing', () => {
    const note = renderNote(
      entry({ links: [{ url: '', label: '', capturedAt: '2026-04-13T09:00:00.000Z' }] }),
      context(),
    );
    expect(note).not.toContain('## Links');
    // Dropped from the reading, kept in full for a machine.
    expect(parseFrontMatter(note).links).toEqual([{ url: '', capturedAt: '2026-04-13T09:00:00.000Z' }]);
  });
});

describe('scripture', () => {
  it('embeds the real KJV text of a scripture anchor', () => {
    const note = renderNote(
      entry({ anchors: [{ kind: 'scripture', outlineEntryId: 'mt-5-1', ...MATTHEW_5 }] }),
      context(),
    );

    expect(note).toContain('## Scripture (King James Version)');
    expect(note).toContain('### Matthew 5:1-12');
    expect(note).toContain('**3** Blessed are the poor in spirit');
    expect(note).toContain('**12** Rejoice, and be exceeding glad');
    // Twelve verses, every one of them numbered and on its own line.
    expect(note.match(/^\*\*\d+\*\* /gm)).toHaveLength(12);
  });

  it('says plainly that the quoted text is scripture and not the writer', () => {
    const note = renderNote(entry({ anchors: [{ kind: 'scripture', ...MATTHEW_5 }] }), context());

    expect(note).toContain('## Scripture (King James Version)');
    expect(note).toContain('They are scripture, not the writer\'s words.');
    // The attribution stands above the verses, not after them.
    expect(note.indexOf('King James Version')).toBeLessThan(note.indexOf('**1** And seeing'));
    // And the writer's own sections are above the scripture heading entirely.
    expect(note.indexOf('## Notes')).toBeLessThan(note.indexOf('## Scripture'));
  });

  it('embeds a reference the writer only cited in prose', () => {
    const note = renderNote(entry({ scriptureRefs: ['John 3:16'] }), context());
    expect(note).toContain('### John 3:16');
    expect(note).toContain('**16** For God so loved the world');
    // Quoted, so it is not also listed as something merely mentioned.
    expect(note).not.toContain('Also mentioned:');
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

  it('repeats a citation it could not quote, in the writer\'s own words', () => {
    const note = renderNote(
      entry({ scriptureRefs: ['Nowhere 4:5', 'the bit about the mountain', 'John 3:16'] }),
      context(),
    );

    // John 3:16 is quoted below, so it is not repeated here.
    expect(note).toContain('Also mentioned: Nowhere 4:5; the bit about the mountain');
    expect(note).toContain('### John 3:16');
  });

  it('says nothing at all when no passage resolved, and still records the reference', () => {
    const missing = ref('habakkuk', 3, 17, 3, 19);
    const note = renderNote(
      entry({ anchors: [{ kind: 'scripture', ...missing }], scriptureRefs: ['Nowhere 4:5'] }),
      context(),
    );

    expect(note).not.toContain('## Scripture');
    // Nothing is hidden: both references are still written down in full, in the
    // body as well as the front matter.
    expect(note).toContain('About: Habakkuk 3:17-19');
    expect(note).toContain('Also mentioned: Nowhere 4:5');

    const front = parseFrontMatter(note);
    expect(front.anchors).toEqual([
      { kind: 'scripture', reference: 'Habakkuk 3:17-19', book: 'habakkuk', chapterStart: 3, verseStart: 17, chapterEnd: 3, verseEnd: 19 },
    ]);
    expect(front.scriptureRefs).toEqual(['Nowhere 4:5']);
  });
});

describe('as the archive actually builds it', () => {
  /**
   * The unit tests above seed `ctx.passages` by hand, which can pass for
   * scripture no real export would ever hold. These run against a context built
   * by `buildContext` from the real outline and topic data, so the promise the
   * module makes — the full text of every passage the entry points at — is
   * tested end to end, loader included.
   */
  const built = () =>
    buildContext({
      entries: ALL_ENTRIES,
      outlineBooks: outlinesFile as unknown as OutlineBook[],
      topics: topicsFile.topics as Topic[],
      profile: 'public',
      now: new Date('2026-09-13T12:00:00.000Z'),
    });

  it('quotes a reference the writer only cited in prose', async () => {
    const note = renderNote(SERMON, await built());

    // "Psalm 37:11" is cited in prose and anchored nowhere. The builder has to
    // have loaded it, or the note quotes nothing and the cold read fails.
    expect(SERMON.scriptureRefs).toContain('Psalm 37:11');
    expect(note).toContain('### Psalms 37:11');
    expect(note).toContain('**11** But the meek shall inherit the earth');
    expect(note).not.toContain('Also mentioned:');
  });

  it('renders the shared sermon fixture whole', async () => {
    const note = renderNote(SERMON, await built());

    const front = parseFrontMatter(note);
    expect(front.id).toBe(SERMON.id);
    expect(front.speaker).toBe('Pastor James Whitfield');
    expect(front.scriptureRefs).toEqual(['Matthew 5:1-12', 'Psalm 37:11']);

    expect(note).toContain('# The Beatitudes');
    expect(note).toContain('About: Matthew 5:1-12 · Humility (topic)');
    expect(note).toContain('## Notes');
    expect(note).toContain('## Reflection');
    expect(note).toContain('## Prayer');
    expect(note).toContain('## Links');
    expect(note).toContain('Tags: beatitudes, kingdom, grace');

    // The anchor and the cited reference name the same passage; it prints once.
    expect(note.match(/### Matthew 5:1-12/g)).toHaveLength(1);
    expect(note).toContain('**3** Blessed are the poor in spirit');

    // Markdown in the writing is passed through untouched, italics and all.
    expect(note).toContain('"Blessed" is nearer to *congratulations* than to *lucky*.');
  });

  it('renders every fixture without inventing a word', async () => {
    const ctx = await built();
    for (const fixture of ALL_ENTRIES) {
      const note = renderNote(fixture, ctx);
      expect(note, fixture.id).not.toContain('undefined');
      expect(note, fixture.id).not.toContain('[object Object]');
      expect(note, fixture.id).not.toContain('NaN');
      expect(note, fixture.id).not.toContain('\r');
      // Parses, or the front matter is not front matter.
      parseFrontMatter(note);
    }
  });
});

describe('a future version wrote fields this build does not know', () => {
  it('keeps them rather than dropping them', () => {
    const note = renderNote(
      entry({ _unmigrated: { mood: 'unsettled', weather: { rain: true } } }),
      context(),
    );

    const front = parseFrontMatter(note);
    expect(JSON.parse(String(front._unmigrated))).toEqual({
      mood: 'unsettled',
      weather: { rain: true },
    });
  });

  it('says nothing about _unmigrated when there is nothing to say', () => {
    expect(parseFrontMatter(renderNote(entry(), context()))).not.toHaveProperty('_unmigrated');
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
        { kind: 'topic', topicId: 'comfort' },
        { kind: 'book', book: 'matthew' },
      ],
      scriptureRefs: ['John 3:16'],
      reflection: 'It landed hard.',
      tags: ['grace'],
    });

    const full = renderNote(written, context());
    const lean = renderNote(written, refsOnly());

    expect(lean).toBe(full);
    expect(lean).toContain('About: Matthew 5:1-12 · Comfort in grief (topic) · Matthew (whole book)');
    expect(lean).toContain('### Matthew 5:1-12');
    expect(lean).toContain('**3** Blessed are the poor in spirit');
    // The id is kept as written, never resolved into a title that would vanish.
    expect(lean).toContain('outlineEntryId: mt-5-1');
  });

  it('renders an archive built under refs-only exactly as one built under full', async () => {
    const options = {
      entries: ALL_ENTRIES,
      topics: topicsFile.topics as Topic[],
      now: new Date('2026-09-13T12:00:00.000Z'),
    };
    const full = await buildContext({
      ...options,
      outlineBooks: outlinesFile as unknown as OutlineBook[],
      profile: 'public' as const,
    });
    // Under refs-only there are no outline books at all, not empty ones.
    const lean = await buildContext({ ...options, outlineBooks: [], profile: 'refs-only' as const });

    expect(lean.outlineEntries.size).toBe(0);
    expect(lean.outlineBooks.size).toBe(0);
    for (const fixture of ALL_ENTRIES) {
      expect(renderNote(fixture, lean), fixture.id).toBe(renderNote(fixture, full));
    }
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

  it('accepts "Psalm 23", which is how everyone writes it', () => {
    expect(parseScriptureRef('Psalm 23', BOOK_NAMES)).toEqual(ref('psalms', 23, 1, 23, 6));
    expect(parseScriptureRef('Psalms 23:1', BOOK_NAMES)).toEqual(ref('psalms', 23, 1));
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
    expect(parseScriptureRef('Matthew 0:1', BOOK_NAMES)).toBeNull();
    expect(parseScriptureRef('Matthew 5:0', BOOK_NAMES)).toBeNull();
    expect(parseScriptureRef('', BOOK_NAMES)).toBeNull();
    expect(parseScriptureRef('   ', BOOK_NAMES)).toBeNull();
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
    expect(formatEventDate('2026-00-01')).toBe('2026-00-01');
  });
});

describe('describeRef', () => {
  it('still prints the numbers for a book this build has no canon data for', () => {
    const unknown = ref('book-of-eli', 2, 3, 2, 5);
    expect(describeRef(unknown, context())).toBe('book-of-eli 2:3-2:5');
  });

  it('still prints the numbers for a range the book cannot hold', () => {
    // "Genesis" alone would read as the whole book. Verbose beats wrong.
    expect(describeRef(ref('genesis', 99, 1, 99, 4), context())).toBe('Genesis 99:1-99:4');
    expect(describeRef(ref('genesis', 1, 5, 1, 2), context())).toBe('Genesis 1:5-1:2');
  });

  it('says a whole chapter as a whole chapter', () => {
    expect(describeRef(ref('psalms', 23, 1, 23, 6), context())).toBe('Psalms 23');
  });
});
