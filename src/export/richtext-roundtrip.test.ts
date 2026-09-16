/**
 * Formatting survives the archive.
 *
 * The rich-text editor writes Markdown into the same `notes` and `reflection`
 * strings the schema has always declared as Markdown, so there is no new field
 * and no migration. The claim that needs proving is that this was genuinely
 * free: a formatted note must come back out of an export byte-identical, an
 * unformatted one written years earlier must come back unchanged too, and
 * neither may acquire a warning on the way through.
 */

import { describe, expect, it } from 'vitest';

import { examinedAtLeast } from '../testing/floor';
import { markdownToPlainText, parseMarkdown } from '../lib/markdown';
import type { Entry } from '../types';
import { migrateExport } from './migrate';
import { parseImport } from './importer';

const RICH = [
  '# Sunday morning',
  '',
  'He opened with **grace** and *mercy*, and said this plainly:',
  '',
  '> Nothing can separate us.',
  '',
  'Three points:',
  '',
  '- The first, on Romans 8',
  '- The second, with a [link](https://example.com)',
  '- The third',
  '',
  '1. Read it',
  '2. Pray it',
  '',
  'Ends with `a code span` and a rule.',
  '',
  '---',
].join('\n');

/** A note written long before any renderer existed. */
const PLAIN = 'Just some notes.\nCosts $5 * 3 items.\nAnd a second thought.';

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'rich-1',
  kind: 'sermon',
  title: 'Nothing can separate',
  date: '2025-06-15',
  anchors: [],
  scriptureRefs: [],
  notes: RICH,
  reflection: '**Mine**, with _emphasis_.',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2025-06-15T10:00:00.000Z',
  updatedAt: '2025-06-15T10:00:00.000Z',
  ...overrides,
});

const envelope = (entries: Entry[]) => ({
  format: 'journey-export',
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  entries,
});

describe('rich formatting round-trips through the archive', () => {
  it('returns the Markdown byte for byte', async () => {
    const original = entry();
    const parsed = await parseImport(JSON.stringify(envelope([original])));

    expect(parsed.entries).toHaveLength(1);
    // Not "equivalent" — identical. The field is a string and nothing on the
    // path is entitled to reformat it.
    expect(parsed.entries[0].notes).toBe(RICH);
    expect(parsed.entries[0].reflection).toBe(original.reflection);
  });

  it('carries no warning for a formatted note', async () => {
    const parsed = await parseImport(JSON.stringify(envelope([entry()])));
    // Markdown is not a new field, so the migration has nothing to say about it.
    expect(parsed.warnings).toEqual([]);
  });

  it('still parses to the same structure after the round trip', async () => {
    const parsed = await parseImport(JSON.stringify(envelope([entry()])));
    const before = parseMarkdown(RICH);
    const after = parseMarkdown(parsed.entries[0].notes);

    examinedAtLeast(before.length, 6, 'blocks in the formatted fixture');
    expect(after).toEqual(before);
    // Every block kind the toolbar can produce is exercised here.
    const kinds = new Set(before.map((block) => block.type));
    for (const kind of ['heading', 'paragraph', 'quote', 'list', 'rule']) {
      expect(kinds.has(kind as never), `fixture never exercises a ${kind}`).toBe(true);
    }
  });

  it('leaves a plain-text note written years earlier exactly as it was', async () => {
    const parsed = await parseImport(JSON.stringify(envelope([entry({ notes: PLAIN })])));
    expect(parsed.entries[0].notes).toBe(PLAIN);
    // And it still reads as its own words, with the asterisk intact.
    expect(markdownToPlainText(parsed.entries[0].notes)).toContain('$5 * 3 items');
  });
});

describe('import provenance round-trips', () => {
  const source = {
    importedAt: '2026-02-01T09:00:00.000Z',
    filename: 'Sunday Sermons 2019.docx',
    format: 'docx' as const,
    itemIndex: 7,
    page: 3,
    parserVersion: 1,
  };

  it('survives an export and comes back whole', () => {
    const result = migrateExport(envelope([entry({ source })]));
    expect(result.entries[0].source).toEqual(source);
    // A registered field, so it does not fall through to _unmigrated.
    expect(result.entries[0]._unmigrated).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it('is absent, not invented, on an entry that was typed here', () => {
    const result = migrateExport(envelope([entry()]));
    expect(result.entries[0].source).toBeUndefined();
  });

  it('keeps a malformed provenance block rather than dropping it', () => {
    const result = migrateExport(
      envelope([entry({ source: { nonsense: true } as never })]),
    );
    expect(result.entries[0].source).toBeUndefined();
    expect(result.entries[0]._unmigrated?.source).toEqual({ nonsense: true });
    expect(result.warnings.join(' ')).toMatch(/provenance/i);
  });

  it('refuses a provenance block naming a format this build does not know', () => {
    const result = migrateExport(
      envelope([entry({ source: { ...source, format: 'rtf' } as never })]),
    );
    expect(result.entries[0].source).toBeUndefined();
    expect(result.entries[0]._unmigrated?.source).toMatchObject({ format: 'rtf' });
  });
});

describe('an unknown field is preserved, whatever it is called', () => {
  /**
   * `__proto__` is the case that was silently failing.
   *
   * JSON.parse makes it an OWN property, and `unmigrated[key] = value` then
   * runs the prototype setter instead of storing anything — so the field was
   * dropped in silence by the one module whose stated rule is never to do that.
   */
  it('keeps a field named __proto__ instead of losing it to the prototype', () => {
    const raw = JSON.parse(
      '{"format":"journey-export","version":1,"entries":[{"id":"a","__proto__":{"polluted":1}}]}',
    );
    const result = migrateExport(raw);

    const kept = result.entries[0]._unmigrated;
    expect(Object.keys(kept ?? {})).toContain('__proto__');
    expect(Object.getOwnPropertyDescriptor(kept, '__proto__')?.value).toEqual({ polluted: 1 });
    expect(result.warnings.join(' ')).toMatch(/__proto__/);
  });

  it('does not let such a field reach Object.prototype', () => {
    const raw = JSON.parse(
      '{"format":"journey-export","version":1,"entries":[{"id":"b","__proto__":{"escaped":1}}]}',
    );
    migrateExport(raw);
    expect(({} as Record<string, unknown>).escaped).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).escaped).toBeUndefined();
  });

  it('keeps a constructor-named field too', () => {
    const raw = JSON.parse(
      '{"format":"journey-export","version":1,"entries":[{"id":"c","constructor":"surprise"}]}',
    );
    const result = migrateExport(raw);
    expect(result.entries[0]._unmigrated?.constructor).toBe('surprise');
  });
});
