/**
 * What the archive does with writing that was never finished.
 *
 * Two promises pull in different directions here and both have to hold. An
 * export that knowingly omitted the words somebody typed five minutes ago
 * would be a quiet lie about what "everything" means. A book handed to a
 * grandchild that contained half-sentences would be a different lie. So drafts
 * travel in the canonical JSON, labelled, and reach nothing that renders the
 * finished record.
 */

import { describe, expect, it } from 'vitest';

import { buildArchive, buildContext, buildJourneyJson } from './archive';
import { renderBook } from './book';
import { renderCsv } from './readme';
import { migrateExport } from './migrate';
import { parseImport, applyImport } from './importer';
import { DexieStorageProvider } from '../storage/db';
import type { DraftForm, Entry, EntryDraft } from '../types';
import { readZip, zipEntryText } from './zip';

let counter = 0;

const form = (overrides: Partial<DraftForm> = {}): DraftForm => ({
  kind: 'sermon',
  title: '',
  date: '2026-03-01',
  place: '',
  speaker: '',
  sermonSeries: '',
  notes: '',
  reflection: '',
  prayer: '',
  tagsText: '',
  links: [],
  anchors: [],
  forDescendants: false,
  scriptureRefs: [],
  sourceMaterial: null,
  ...overrides,
});

const draft = (overrides: Partial<EntryDraft> = {}): EntryDraft => ({
  id: 'd1',
  form: form({ notes: 'A sentence nobody finished' }),
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:04:00.000Z',
  ...overrides,
});

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  kind: 'sermon',
  title: 'A finished entry',
  date: '2026-02-01',
  anchors: [],
  scriptureRefs: [],
  notes: 'Written and saved.',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-02-01T10:00:00.000Z',
  updatedAt: '2026-02-01T10:00:00.000Z',
  ...overrides,
});

const ctx = (entries: Entry[], drafts: EntryDraft[]) =>
  buildContext({ entries, drafts, outlineBooks: [], topics: [], profile: 'public' });

describe('the canonical JSON', () => {
  it('carries unfinished writing, kept apart from the entries', async () => {
    const json = buildJourneyJson(await ctx([entry()], [draft()]));

    expect(json.entries).toHaveLength(1);
    expect(json.drafts).toHaveLength(1);
    expect(json.drafts?.[0].form.notes).toBe('A sentence nobody finished');
    expect(
      json.entries.map((e) => e.id),
      'a draft must never appear in the entries list',
    ).toEqual(['e1']);
  });

  it('omits the key entirely when there is nothing unfinished', async () => {
    const json = buildJourneyJson(await ctx([entry()], []));

    // Absence is the version 1 reading. An archive from a journal with no
    // drafts must be indistinguishable from one written before drafts existed,
    // which is what lets the format version stay where it is.
    expect('drafts' in json).toBe(false);
    expect(json.version).toBe(1);
  });
});

describe('the finished record', () => {
  it('keeps unfinished writing out of the book and the spreadsheet', async () => {
    const built = await ctx([entry()], [
      draft({ form: form({ title: 'HALF A THOUGHT', notes: 'UNFINISHED SENTENCE' }) }),
    ]);

    const book = renderBook(built);
    const csv = renderCsv(built);

    expect(book).toContain('A finished entry');
    expect(book, 'a draft reached the book').not.toContain('UNFINISHED SENTENCE');
    expect(book, 'a draft title reached the book').not.toContain('HALF A THOUGHT');
    expect(csv, 'a draft reached the spreadsheet index').not.toContain('UNFINISHED SENTENCE');
  });
});

describe('reading an archive back', () => {
  it('restores unfinished writing as unfinished writing, not as entries', async () => {
    const archive = await buildArchive({
      entries: [entry()],
      drafts: [draft()],
      outlineBooks: [],
      topics: [],
      profile: 'public',
    });

    const storage = new DexieStorageProvider(`drafts-archive-${(counter += 1)}`);
    await storage.open();

    const parsed = await parseImport(archive.bytes);
    await applyImport(parsed, storage, 'merge');

    expect(await storage.listEntries(), 'one entry, and the draft did not become a second').toHaveLength(1);
    const drafts = await storage.listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].form.notes).toBe('A sentence nobody finished');
  });

  it('round-trips a draft byte for byte, whitespace and all', async () => {
    const ragged = draft({
      id: 'd-ragged',
      form: form({
        notes: 'Line one.\n\n  Indented, and trailing spaces.   ',
        tagsText: ' grace , patience ,,',
        links: [{ url: '', label: 'the audio', capturedTitle: '' }],
      }),
    });

    const archive = await buildArchive({
      entries: [],
      drafts: [ragged],
      outlineBooks: [],
      topics: [],
      profile: 'public',
    });

    const canonical = (await readZip(archive.bytes)).find((f) => f.path === 'data/journey.json');
    const back = migrateExport(JSON.parse(zipEntryText(canonical!)));

    expect(back.drafts).toEqual([ragged]);
  });

  it('replace swaps drafts as well as entries instead of leaving old unfinished text behind', async () => {
    const storage = new DexieStorageProvider(`drafts-replace-${(counter += 1)}`);
    await storage.open();
    await storage.putEntries([entry({ id: 'old-entry' })]);
    await storage.putDraft(draft({ id: 'old-draft' }));

    const archive = await buildArchive({
      entries: [entry({ id: 'restored-entry' })],
      drafts: [],
      outlineBooks: [],
      topics: [],
      profile: 'public',
    });
    await applyImport(await parseImport(archive.bytes), storage, 'replace');

    expect((await storage.listEntries()).map((item) => item.id)).toEqual(['restored-entry']);
    expect(await storage.listDrafts()).toEqual([]);
  });
});

describe('archives written before drafts existed', () => {
  it('still import, and are not treated as damaged', () => {
    // Exactly what a version 1 archive looks like: no drafts key at all.
    const v1 = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      entries: [entry()],
    };

    const result = migrateExport(v1);

    expect(result.entries).toHaveLength(1);
    expect(result.drafts, 'a missing drafts key is the v1 reading, not an error').toEqual([]);
    expect(
      result.warnings.join(' '),
      'an old archive must not be reported as having a problem',
    ).not.toMatch(/draft/i);
  });

  it('refuses a malformed drafts section instead of silently dropping unfinished writing', () => {
    const damaged = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      entries: [entry()],
      drafts: [{ id: 'no-form' }, 'not even an object'],
    };

    expect(() => migrateExport(damaged)).toThrow(/draft/i);
  });
});
