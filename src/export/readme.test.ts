import { describe, expect, it } from 'vitest';

import { renderCsv, renderExportNote, renderReadme, renderSchema } from './readme';
import { buildNoteFilenames } from './context';
import type { ExportContext } from './context';
import type { Entry, JourneyExport } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'e1',
    kind: 'sermon',
    title: 'The Beatitudes',
    date: '2026-09-13',
    anchors: [],
    scriptureRefs: [],
    notes: '',
    reflection: '',
    links: [],
    tags: [],
    forDescendants: false,
    visibility: 'private',
    createdAt: '2026-09-13T18:00:00.000Z',
    updatedAt: '2026-09-13T18:00:00.000Z',
    ...overrides,
  };
}

const SERMON = makeEntry({
  id: 'e1',
  kind: 'sermon',
  title: 'The Beatitudes',
  date: '2019-03-03',
  place: 'First Baptist, Tallahassee, FL',
  speaker: 'Pastor Dan',
  sermonSeries: 'Sermon on the Mount',
  anchors: [
    { kind: 'scripture', book: 'genesis', chapterStart: 1, verseStart: 1, chapterEnd: 1, verseEnd: 5 },
    { kind: 'topic', topicId: 'grief' },
    { kind: 'book', book: 'mark' },
  ],
  scriptureRefs: ['Rom 8:28', 'cf. James 1'],
  notes: 'Blessed are the poor in spirit.',
  reflection: 'I am poor in spirit.',
  tags: ['grace', 'advent'],
});

const LETTER = makeEntry({
  id: 'e2',
  kind: 'letter',
  title: 'To my grandchildren',
  date: '2026-09-01',
  notes: 'Naïve — a café, an emoji 😀',
  reflection: '',
  forDescendants: true,
  visibility: 'shared',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-09-02T09:00:00.000Z',
});

function makeCtx(overrides: Partial<ExportContext> = {}): ExportContext {
  const entries = overrides.entries ?? [SERMON, LETTER];
  return {
    entries,
    excludedCount: 0,
    exportedAt: '2026-09-13T14:02:11.000Z',
    profile: 'full',
    bookNames: new Map([
      ['genesis', 'Genesis'],
      ['mark', 'Mark'],
      ['1-samuel', '1 Samuel'],
    ]),
    bookOrder: new Map([
      ['genesis', 1],
      ['mark', 41],
    ]),
    outlineBooks: new Map(),
    outlineEntries: new Map(),
    topics: new Map([
      ['grief', { id: 'grief', name: 'Grief', description: 'When someone is gone.', refs: [] }],
    ]),
    passages: new Map(),
    noteFilenames: buildNoteFilenames(entries),
    ...overrides,
  };
}

const lines = (text: string): string[] => text.split('\n');
const longestLine = (text: string): number => Math.max(...lines(text).map((line) => line.length));

/**
 * Collapse the hard wrapping before matching prose, so that a sentence which
 * happens to break across two lines is not read as a missing sentence. The
 * wrapping itself is asserted separately, on the raw text.
 */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

// ---------------------------------------------------------------------------
// README.txt
// ---------------------------------------------------------------------------

describe('renderReadme', () => {
  it('hard-wraps every line to 76 columns', () => {
    const text = renderReadme(makeCtx());
    expect(longestLine(text)).toBeLessThanOrEqual(76);
  });

  it('uses no markdown markup a renderer would swallow', () => {
    const text = renderReadme(makeCtx());
    // Headings, bullets, emphasis and links all change meaning when a reader
    // pastes this into something that renders markdown. None may appear.
    expect(text).not.toMatch(/^ {0,3}#/m);
    expect(text).not.toMatch(/^ {0,3}[-*+] /m);
    expect(text).not.toMatch(/\*\*/);
    expect(text).not.toMatch(/\]\(/);
    expect(text).not.toMatch(/^ {0,3}>/m);
    expect(text).not.toMatch(/```/);
  });

  it('accounts for every path the archive writes', () => {
    const text = flat(renderReadme(makeCtx({ excludedCount: 1, filter: { kinds: ['sermon'] } })));
    // A folder the README skips is a folder the reader has to guess about.
    for (const path of [
      'MANIFEST.txt',
      'EXPORT-NOTE.txt',
      'book/',
      'notes/',
      'indexes/',
      'data/',
      'journey.json',
      'schema.json',
      'entries.csv',
    ]) {
      expect(text).toContain(path);
    }
  });

  it('names the first file to open and the complete data file', () => {
    const text = flat(renderReadme(makeCtx()));
    expect(text).toContain('book/my-journey-with-God.html');
    expect(text).toContain('data/journey.json');
    expect(text).toContain('data/schema.json');
    expect(text).toContain('data/entries.csv');
    // "Start here" must be attached to the book, not buried.
    expect(text.slice(text.indexOf('START HERE'), text.indexOf('START HERE') + 400)).toContain(
      'my-journey-with-God.html',
    );
  });

  it('explains what the KJV is and that it is public domain in the US', () => {
    const text = flat(renderReadme(makeCtx()));
    expect(text).toContain('King James Version');
    expect(text).toContain('1611');
    expect(text).toMatch(/public domain/);
    expect(text).toMatch(/United States/);
  });

  it('explains how to read a note with only a text editor', () => {
    const text = flat(renderReadme(makeCtx()));
    expect(text).toMatch(/plain text/i);
    expect(text).toMatch(/text editor/i);
    expect(text).toMatch(/three dashes/);
  });

  it('counts the entries and gives the span of dates in words', () => {
    const text = flat(renderReadme(makeCtx()));
    expect(text).toContain('2 entries');
    expect(text).toContain('3 March 2019');
    expect(text).toContain('1 September 2026');
    expect(text).toContain('1 sermon');
    expect(text).toContain('1 letter');
  });

  it('stamps the export date both readably and exactly', () => {
    const text = flat(renderReadme(makeCtx()));
    expect(text).toContain('13 September 2026');
    expect(text).toContain('2026-09-13T14:02:11.000Z');
  });

  it('quotes a real filename from this archive as the example', () => {
    const ctx = makeCtx();
    const text = renderReadme(ctx);
    const expected = ctx.noteFilenames.get(SERMON.id)?.replace('notes/', '');
    expect(expected).toBeTruthy();
    expect(text).toContain(expected as string);
  });

  it('says nothing about partial copies when the export is complete', () => {
    const text = renderReadme(makeCtx());
    expect(text).not.toContain('EXPORT-NOTE');
    expect(text).not.toMatch(/partial/i);
  });

  it('warns above everything else when entries were left out', () => {
    const raw = renderReadme(makeCtx({ excludedCount: 37, filter: { kinds: ['sermon'] } }));
    const text = flat(raw);
    expect(text).toContain('IMPORTANT: THIS IS A PARTIAL COPY');
    expect(text).toContain('37 entries');
    expect(text).toContain('EXPORT-NOTE.txt');
    expect(text.indexOf('PARTIAL COPY')).toBeLessThan(text.indexOf('WHAT THIS IS'));
    expect(longestLine(raw)).toBeLessThanOrEqual(76);
  });

  it('warns when a filter was recorded even if nothing was counted out', () => {
    const text = flat(renderReadme(makeCtx({ filter: { forDescendantsOnly: true } })));
    expect(text).toContain('IMPORTANT: THIS IS A PARTIAL COPY');
    expect(text).toContain('EXPORT-NOTE.txt');
  });

  it('gets the grammar right for a single excluded entry', () => {
    const text = flat(renderReadme(makeCtx({ excludedCount: 1, filter: { kinds: ['letter'] } })));
    expect(text).toContain('1 entry was left out');
  });

  it('reads correctly under refs-only, where no outline resolves', () => {
    const raw = renderReadme(
      makeCtx({ profile: 'refs-only', outlineBooks: new Map(), outlineEntries: new Map() }),
    );
    const text = flat(raw);
    expect(text).toContain('ABOUT THE PASSAGE NAMES');
    expect(text).toMatch(/book, chapter and verse/);
    expect(text).toContain('book/my-journey-with-God.html');
    expect(longestLine(raw)).toBeLessThanOrEqual(76);
  });

  it('leaves out the passage-names note under the full profile', () => {
    expect(renderReadme(makeCtx())).not.toContain('ABOUT THE PASSAGE NAMES');
  });

  it('calls out the entries marked for descendants', () => {
    const text = flat(renderReadme(makeCtx()));
    expect(text).toContain('WRITTEN FOR WHOEVER CAME AFTER');
    expect(text).toContain('1 entry');
    expect(text).toContain('indexes/for-descendants.md');
    expect(text).toContain('for_descendants');
  });

  it('explains why private entries are in here', () => {
    const text = flat(renderReadme(makeCtx()));
    expect(text).toContain('ABOUT THE PRIVATE ENTRIES');
    expect(text).toMatch(/marked private/);
  });

  it('omits the private and descendants notes when nothing is marked', () => {
    const text = flat(renderReadme(makeCtx({ entries: [makeEntry({ visibility: 'shared' })] })));
    expect(text).not.toContain('ABOUT THE PRIVATE ENTRIES');
    expect(text).not.toContain('WRITTEN FOR WHOEVER CAME AFTER');
  });

  it('survives an empty journal without pretending it holds something', () => {
    const raw = renderReadme(makeCtx({ entries: [] }));
    expect(flat(raw)).toContain('no entries');
    expect(flat(raw)).toContain('book/my-journey-with-God.html');
    expect(longestLine(raw)).toBeLessThanOrEqual(76);
  });

  it('survives an entry with an unusable date', () => {
    const raw = renderReadme(makeCtx({ entries: [makeEntry({ date: 'sometime in 1994' })] }));
    expect(flat(raw)).toContain('1 entry');
    expect(longestLine(raw)).toBeLessThanOrEqual(76);
  });

  it('ends with a newline', () => {
    expect(renderReadme(makeCtx()).endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EXPORT-NOTE.txt
// ---------------------------------------------------------------------------

describe('renderExportNote', () => {
  it('returns null for a complete export', () => {
    expect(renderExportNote(makeCtx())).toBeNull();
  });

  it('returns a note whenever a filter was recorded', () => {
    expect(renderExportNote(makeCtx({ filter: {} }))).not.toBeNull();
  });

  it('returns a note whenever anything was excluded, filter or not', () => {
    const raw = renderExportNote(makeCtx({ excludedCount: 4 }));
    expect(raw).not.toBeNull();
    const text = flat(raw ?? '');
    expect(text).toContain('4 entries');
    // No filter was recorded: say so rather than implying the copy is whole.
    expect(text).toMatch(/no record was kept/);
    expect(text).toMatch(/incomplete/);
  });

  it('leads with the fact that the copy is partial', () => {
    const raw = renderExportNote(makeCtx({ excludedCount: 37, filter: { kinds: ['sermon'] } })) ?? '';
    expect(lines(raw)[0]).toBe('EXPORT NOTE: THIS IS A PARTIAL COPY');
    expect(flat(raw)).toMatch(/does not hold the whole journal/);
  });

  it('counts what is in and what is out', () => {
    const text = flat(renderExportNote(makeCtx({ excludedCount: 37, filter: { kinds: ['sermon'] } })) ?? '');
    expect(text).toMatch(/Entries included:\s+2/);
    expect(text).toMatch(/Entries left out:\s+37/);
  });

  it('states every limit the filter recorded, in human names', () => {
    const text = flat(
      renderExportNote(
        makeCtx({
          excludedCount: 12,
          filter: {
            from: '2020-01-01',
            to: '2021-12-31',
            books: ['genesis', 'mark'],
            topics: ['grief'],
            kinds: ['sermon', 'letter'],
            forDescendantsOnly: true,
          },
        }),
      ) ?? '',
    );

    expect(text).toContain('1 January 2020 through 31 December 2021');
    expect(text).toContain('Genesis and Mark');
    expect(text).toContain('Grief');
    expect(text).toContain('Sermon and Letter');
    expect(text).toMatch(/for descendants/);
  });

  it('prints ids it cannot resolve rather than dropping them', () => {
    const text = flat(
      renderExportNote(
        makeCtx({ excludedCount: 1, filter: { books: ['habakkuk'], topics: ['fear-of-flying'] } }),
      ) ?? '',
    );
    expect(text).toContain('habakkuk');
    expect(text).toContain('fear-of-flying');
  });

  it('is unambiguous about an open-ended date range', () => {
    const fromOnly = flat(renderExportNote(makeCtx({ filter: { from: '2020-01-01' } })) ?? '');
    expect(fromOnly).toContain('1 January 2020 onwards; nothing earlier');

    const toOnly = flat(renderExportNote(makeCtx({ filter: { to: '2020-01-01' } })) ?? '');
    expect(toOnly).toContain('up to and including 1 January 2020; nothing later');
  });

  it('warns when a filter recorded no limits at all', () => {
    const text = flat(renderExportNote(makeCtx({ filter: {} })) ?? '');
    expect(text).toMatch(/named no limits/);
    expect(text).toMatch(/possibly incomplete/);
  });

  it('points at the machine-readable statement of the same fact', () => {
    const text = flat(renderExportNote(makeCtx({ filter: { kinds: ['sermon'] } })) ?? '');
    expect(text).toContain('data/journey.json');
    expect(text).toContain('"filter"');
  });

  it('hard-wraps to 76 columns', () => {
    const text =
      renderExportNote(
        makeCtx({
          excludedCount: 99,
          filter: { books: ['genesis', 'mark', '1-samuel'], kinds: ['sermon', 'reading', 'prayer'] },
        }),
      ) ?? '';
    expect(longestLine(text)).toBeLessThanOrEqual(76);
  });
});

// ---------------------------------------------------------------------------
// data/schema.json
// ---------------------------------------------------------------------------

type Node = Record<string, unknown>;

const isObject = (value: unknown): value is Node =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function resolveRef(root: Node, ref: string): Node {
  let node: unknown = root;
  for (const part of ref.replace(/^#\//, '').split('/')) {
    node = isObject(node) ? node[part] : undefined;
  }
  if (!isObject(node)) throw new Error(`unresolvable $ref ${ref}`);
  return node;
}

function matchesType(type: string, value: unknown): boolean {
  if (type === 'object') return isObject(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  return typeof value === type;
}

/**
 * A validator for the keywords this schema actually uses.
 *
 * Written out here rather than pulled from a library so the test proves the
 * schema is usable by someone with no tooling — which is the whole claim the
 * schema makes.
 */
function validate(node: Node, value: unknown, root: Node, path = '$'): string[] {
  if (typeof node.$ref === 'string') return validate(resolveRef(root, node.$ref), value, root, path);

  const errors: string[] = [];
  if (typeof node.type === 'string' && !matchesType(node.type, value)) {
    return [`${path}: expected ${node.type}`];
  }
  if ('const' in node && value !== node.const) errors.push(`${path}: expected ${String(node.const)}`);
  if (Array.isArray(node.enum) && !node.enum.includes(value)) errors.push(`${path}: not in enum`);
  if (typeof node.minimum === 'number' && typeof value === 'number' && value < node.minimum) {
    errors.push(`${path}: below minimum`);
  }
  if (Array.isArray(node.oneOf)) {
    const matched = node.oneOf.filter(
      (branch) => isObject(branch) && validate(branch, value, root, path).length === 0,
    );
    if (matched.length !== 1) errors.push(`${path}: matched ${matched.length} branches of oneOf`);
  }
  if (Array.isArray(value) && isObject(node.items)) {
    value.forEach((item, index) => errors.push(...validate(node.items as Node, item, root, `${path}[${index}]`)));
  }
  if (isObject(value)) {
    const properties = isObject(node.properties) ? node.properties : {};
    for (const key of (node.required as string[] | undefined) ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required "${key}"`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (isObject(childSchema)) errors.push(...validate(childSchema, child, root, `${path}.${key}`));
      else if (node.additionalProperties === false) errors.push(`${path}: unexpected "${key}"`);
    }
  }
  return errors;
}

/** Visit every named property in every properties block, however nested. */
function eachProperty(node: unknown, visit: (name: string, schema: Node) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) eachProperty(item, visit);
    return;
  }
  if (!isObject(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && isObject(value)) {
      for (const [name, child] of Object.entries(value)) {
        if (isObject(child)) visit(name, child);
      }
    }
    eachProperty(value, visit);
  }
}

/** Every field of Entry populated, so the schema can be checked against it. */
const FULL_ENTRY: Entry = {
  id: 'e1',
  kind: 'reflection',
  title: 'Title',
  date: '2026-09-13',
  place: 'back porch',
  speaker: 'Pastor Dan',
  sermonSeries: 'Sermon on the Mount',
  anchors: [
    { kind: 'scripture', book: 'mark', chapterStart: 4, verseStart: 1, chapterEnd: 5, verseEnd: 20 },
    {
      kind: 'scripture',
      book: 'genesis',
      chapterStart: 1,
      verseStart: 1,
      chapterEnd: 1,
      verseEnd: 1,
      outlineEntryId: 'gen-1',
    },
    { kind: 'topic', topicId: 'grief' },
    { kind: 'book', book: '1-samuel' },
  ],
  scriptureRefs: ['Rom 8:28'],
  notes: 'notes',
  reflection: 'reflection',
  prayer: 'prayer',
  links: [
    { url: 'https://example.org/sermon' },
    { url: 'https://example.org/other', label: 'Recording', capturedTitle: 'Sunday, week 3', capturedAt: '2026-09-13T18:00:00.000Z' },
  ],
  tags: ['grace'],
  forDescendants: true,
  visibility: 'shared',
  createdAt: '2026-09-13T18:00:00.000Z',
  updatedAt: '2026-09-13T18:00:00.000Z',
};

describe('renderSchema', () => {
  const schema = JSON.parse(renderSchema()) as Node;

  it('is JSON Schema draft 2020-12, versioned and self-identifying', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(String(schema.$id)).toContain('1');
    expect(typeof schema.description).toBe('string');
  });

  it('describes every single field', () => {
    const missing: string[] = [];
    eachProperty(schema, (name, node) => {
      if (typeof node.description !== 'string' || node.description.length < 12) missing.push(name);
    });
    expect(missing).toEqual([]);
  });

  it('mirrors the Entry type: same fields, same required set', () => {
    const entry = resolveRef(schema, '#/$defs/entry');
    const properties = Object.keys(entry.properties as Node).sort();
    expect(properties).toEqual(Object.keys(FULL_ENTRY).sort());

    const optional = ['place', 'speaker', 'sermonSeries', 'prayer'];
    expect([...(entry.required as string[])].sort()).toEqual(
      properties.filter((key) => !optional.includes(key)),
    );
  });

  it('mirrors EntryLink: url required, the rest optional', () => {
    const link = resolveRef(schema, '#/$defs/entryLink');
    expect(Object.keys(link.properties as Node).sort()).toEqual([
      'capturedAt',
      'capturedTitle',
      'label',
      'url',
    ]);
    expect(link.required).toEqual(['url']);
  });

  it('describes all three anchor variants, discriminated by kind', () => {
    const anchor = resolveRef(schema, '#/$defs/entryAnchor');
    const branches = anchor.oneOf as Node[];
    expect(branches).toHaveLength(3);
    const kinds = branches.map((branch) => ((branch.properties as Node).kind as Node).const);
    expect(kinds).toEqual(['scripture', 'topic', 'book']);

    const scripture = branches[0];
    expect([...(scripture.required as string[])].sort()).toEqual([
      'book',
      'chapterEnd',
      'chapterStart',
      'kind',
      'verseEnd',
      'verseStart',
    ]);
    // outlineEntryId must stay optional: under refs-only it resolves to nothing.
    expect(scripture.required).not.toContain('outlineEntryId');
  });

  it('accepts a real export document', () => {
    const document: JourneyExport = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-09-13T14:02:11.000Z',
      entries: [FULL_ENTRY, SERMON, LETTER],
    };
    expect(validate(schema, document, schema)).toEqual([]);
  });

  it('accepts a filtered export, filter and all', () => {
    const document: JourneyExport = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-09-13T14:02:11.000Z',
      filter: { from: '2020-01-01', books: ['genesis'], kinds: ['sermon'], forDescendantsOnly: true },
      entries: [],
      _unmigrated: { somethingFromLater: true },
    };
    expect(validate(schema, document, schema)).toEqual([]);
  });

  it('rejects a document that is missing what a reader needs', () => {
    expect(validate(schema, { version: 1, exportedAt: 'x', entries: [] }, schema)).not.toEqual([]);
    expect(
      validate(schema, { format: 'something-else', version: 1, exportedAt: 'x', entries: [] }, schema),
    ).not.toEqual([]);
  });

  it('rejects an anchor with a half-written range', () => {
    const document = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-09-13T14:02:11.000Z',
      entries: [{ ...FULL_ENTRY, anchors: [{ kind: 'scripture', book: 'mark', chapterStart: 4 }] }],
    };
    expect(validate(schema, document, schema)).not.toEqual([]);
  });

  it('rejects an unknown entry kind', () => {
    const document = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-09-13T14:02:11.000Z',
      entries: [{ ...FULL_ENTRY, kind: 'podcast' }],
    };
    expect(validate(schema, document, schema)).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// data/entries.csv
// ---------------------------------------------------------------------------

const HEADER = [
  'id',
  'date',
  'kind',
  'title',
  'speaker',
  'place',
  'sermonSeries',
  'anchors',
  'scripture_refs',
  'tags',
  'for_descendants',
  'visibility',
  'created_at',
  'updated_at',
  'notes_chars',
  'reflection_chars',
  'note_file',
];

/** An RFC 4180 reader, so the test parses the file the way a spreadsheet does. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += char;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const body = (csv: string): string[][] => parseCsv(csv.replace(/^\uFEFF/, '')).slice(1);

describe('renderCsv', () => {
  it('opens with a UTF-8 BOM so Excel reads the accents', () => {
    const csv = renderCsv(makeCtx({ entries: [makeEntry({ place: 'Café Céleste' })] }));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('Café Céleste');
  });

  it('separates records with CRLF and nothing else', () => {
    const csv = renderCsv(makeCtx());
    expect(csv.endsWith('\r\n')).toBe(true);
    // Every LF in the file belongs to a CRLF pair.
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('writes the agreed header, in the agreed order', () => {
    const rows = parseCsv(renderCsv(makeCtx()).replace(/^\uFEFF/, ''));
    expect(rows[0]).toEqual(HEADER);
  });

  it('writes one row per entry, in the order the context gave them', () => {
    const rows = body(renderCsv(makeCtx()));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row[0])).toEqual(['e1', 'e2']);
  });

  it('carries the facts of an entry across', () => {
    const [row] = body(renderCsv(makeCtx({ entries: [SERMON] })));
    const value = (name: string): string => row[HEADER.indexOf(name)];

    expect(value('date')).toBe('2019-03-03');
    expect(value('kind')).toBe('sermon');
    expect(value('title')).toBe('The Beatitudes');
    expect(value('speaker')).toBe('Pastor Dan');
    expect(value('place')).toBe('First Baptist, Tallahassee, FL');
    expect(value('sermonSeries')).toBe('Sermon on the Mount');
    expect(value('scripture_refs')).toBe('Rom 8:28; cf. James 1');
    expect(value('tags')).toBe('grace; advent');
    expect(value('for_descendants')).toBe('false');
    expect(value('visibility')).toBe('private');
    expect(value('created_at')).toBe(SERMON.createdAt);
    expect(value('updated_at')).toBe(SERMON.updatedAt);
  });

  it('renders anchors as something a person can read', () => {
    const [row] = body(renderCsv(makeCtx({ entries: [SERMON] })));
    expect(row[HEADER.indexOf('anchors')]).toBe('Genesis 1:1-5; Topic: Grief; Book: Mark');
  });

  it('falls back to raw ids when nothing resolves, as under refs-only', () => {
    const entry = makeEntry({
      anchors: [
        { kind: 'topic', topicId: 'fear-of-flying' },
        { kind: 'book', book: 'habakkuk' },
      ],
    });
    const [row] = body(renderCsv(makeCtx({ entries: [entry], profile: 'refs-only' })));
    expect(row[HEADER.indexOf('anchors')]).toBe('Topic: fear-of-flying; Book: habakkuk');
  });

  it('leaves optional fields empty rather than writing "undefined"', () => {
    const [row] = body(renderCsv(makeCtx({ entries: [makeEntry()] })));
    expect(row[HEADER.indexOf('speaker')]).toBe('');
    expect(row[HEADER.indexOf('place')]).toBe('');
    expect(row[HEADER.indexOf('sermonSeries')]).toBe('');
    expect(row.join('')).not.toContain('undefined');
  });

  it('escapes commas, quotes and line breaks so the row still parses', () => {
    const entry = makeEntry({ title: 'He said, "come" —\nthen left', place: 'Tallahassee, FL' });
    const [row] = body(renderCsv(makeCtx({ entries: [entry] })));
    expect(row[HEADER.indexOf('title')]).toBe('He said, "come" —\nthen left');
    expect(row[HEADER.indexOf('place')]).toBe('Tallahassee, FL');
    expect(row).toHaveLength(HEADER.length);
  });

  it('counts characters as a person would, not as UTF-16 does', () => {
    const entry = makeEntry({ notes: 'Naïve 😀', reflection: '' });
    const [row] = body(renderCsv(makeCtx({ entries: [entry] })));
    // 5 letters, a space, one emoji: 7, though it is 8 UTF-16 code units.
    expect(row[HEADER.indexOf('notes_chars')]).toBe('7');
    expect(row[HEADER.indexOf('reflection_chars')]).toBe('0');
  });

  it('uses the filename the archive actually wrote', () => {
    const ctx = makeCtx();
    const rows = body(renderCsv(ctx));
    expect(rows[0][HEADER.indexOf('note_file')]).toBe(ctx.noteFilenames.get('e1'));
    expect(rows[1][HEADER.indexOf('note_file')]).toBe(ctx.noteFilenames.get('e2'));
    expect(rows[0][HEADER.indexOf('note_file')]).toMatch(/^notes\/.+\.md$/);
  });

  it('writes an empty cell rather than inventing a filename', () => {
    const ctx = makeCtx({ noteFilenames: new Map() });
    const [row] = body(renderCsv(ctx));
    expect(row[HEADER.indexOf('note_file')]).toBe('');
  });

  it('writes a header and nothing else for an empty journal', () => {
    const csv = renderCsv(makeCtx({ entries: [] }));
    expect(csv).toBe(`\uFEFF${HEADER.join(',')}\r\n`);
  });
});
