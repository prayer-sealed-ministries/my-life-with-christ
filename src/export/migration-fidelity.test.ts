import { describe, expect, it } from 'vitest';

import type { DraftForm, EntryDraft } from '../types';
import { DexieStorageProvider } from '../storage/db';
import { buildArchive } from './archive';
import { applyImport, parseImport } from './importer';
import { migrateExport } from './migrate';
import { READING } from './fixtures';

const WHEN = '2026-10-11T12:00:00.000Z';
const extension = { publisherData: { documentId: 'fictional-example-001', revision: 2 } };
const source = {
  format: 'markdown', filename: 'fictional-notes.md', importedAt: WHEN,
  itemIndex: 1, parserVersion: 1, page: 2, ...extension,
};
const sourceMaterial = {
  format: 'sermon-notes-json', filename: 'fictional-outline.json', importedAt: WHEN,
  body: 'Fictional provided outline', parserVersion: 1, scripture: [], ...extension,
};
const link = {
  url: 'https://example.invalid/fictional', label: 'Fictional source',
  capturedTitle: 'Fictional outline', capturedAt: WHEN, ...extension,
};
const scripture = {
  kind: 'scripture', book: 'luke', chapterStart: 14, verseStart: 12,
  chapterEnd: 14, verseEnd: 14, note: 'A fictional personal annotation', ...extension,
};
const anchors = [
  scripture,
  { kind: 'topic', topicId: 'hospitality', ...extension },
  { kind: 'book', book: 'luke', ...extension },
];
const rawEntry = () => ({ ...READING, source, sourceMaterial, links: [link], anchors });
const rawDraft = () => ({
  id: 'fictional-draft', createdAt: WHEN, updatedAt: WHEN,
  futureDraft: { selection: [1, 7] },
  _unmigrated: { olderExtension: 'keep this too' },
  form: {
    kind: 'sermon', title: '', date: '2026-10-11', place: '', speaker: '', sermonSeries: '',
    notes: 'Fictional unfinished writing  \n', reflection: '', prayer: '', tagsText: '',
    links: [link], anchors, forDescendants: false, scriptureRefs: [], sourceMaterial,
    futureEditor: { caret: 5 },
  },
});
const envelope = (entry = rawEntry(), draft = rawDraft()) => ({
  format: 'journey-export', version: 1, entries: [entry], drafts: [draft],
});

describe('forward migration preserves nested and unfinished-record extensions', () => {
  it('retains source provenance and provided-material extensions without merging prose', () => {
    const { entries: [entry] } = migrateExport(envelope());
    expect(entry.source).toEqual(source);
    expect(entry.sourceMaterial).toEqual(sourceMaterial);
    expect(entry.notes).toBe(READING.notes);
    expect(entry.reflection).toBe(READING.reflection);
  });

  it('retains all three structured anchor variants and the supported Scripture note', () => {
    const { entries: [entry] } = migrateExport(envelope());
    expect(entry.anchors).toHaveLength(3);
    expect(entry.anchors).toEqual(anchors);
  });

  it('retains link metadata and extensions', () => {
    expect(migrateExport(envelope()).entries[0].links).toEqual([link]);
  });

  it('retains draft-record extensions alongside previous unmigrated data and reports them', () => {
    const { drafts: [draft], warnings } = migrateExport(envelope());
    expect(draft._unmigrated).toEqual({
      olderExtension: 'keep this too', futureDraft: { selection: [1, 7] },
    });
    expect(warnings.join('\n')).toContain('futureDraft');
  });

  it('retains draft nested extensions and exact unfinished whitespace', () => {
    const { drafts: [draft] } = migrateExport(envelope());
    expect(draft.form).toEqual(rawDraft().form);
    expect(draft.form.notes).toBe('Fictional unfinished writing  \n');
  });

  it('preserves prototype-looking keys as own data without changing object prototypes', () => {
    const inert = JSON.parse('{"__proto__":{"futureValue":"keep"},"constructor":{"futureValue":"keep too"}}');
    const input = envelope({
      ...rawEntry(), source: { ...source, ...inert }, sourceMaterial: { ...sourceMaterial, ...inert },
      links: [{ ...link, ...inert }], anchors: [{ ...scripture, ...inert }],
    }, { ...rawDraft(), ...inert, form: { ...rawDraft().form, links: [{ ...link, ...inert }] } });
    const result = migrateExport(input);
    const values = [
      result.entries[0].source, result.entries[0].sourceMaterial, result.entries[0].links[0],
      result.entries[0].anchors[0], result.drafts[0]._unmigrated, result.drafts[0].form.links[0],
    ];
    expect(values).toHaveLength(6);
    for (const value of values) {
      expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
      expect(Object.hasOwn(value!, '__proto__')).toBe(true);
      expect(JSON.parse(JSON.stringify(value))).toMatchObject(inert);
    }
    expect(Object.hasOwn(Object.prototype, 'futureValue')).toBe(false);
  });

  it('still validates known optional fields instead of letting extensions activate invalid values', () => {
    const { entries: [entry] } = migrateExport({ entries: [{
      ...READING,
      source: { ...source, page: { invalid: true }, itemIndex: 'bad', parserVersion: null },
      sourceMaterial: { ...sourceMaterial, church: 7, parserVersion: 'bad' },
      links: [{ ...link, label: 7, capturedAt: {} }],
      anchors: [{ ...scripture, note: { invalid: true }, outlineEntryId: 7 }],
    }] });
    expect(entry.source).toMatchObject({ itemIndex: 0, parserVersion: 0, ...extension });
    expect(entry.source).not.toHaveProperty('page');
    expect(entry.sourceMaterial).toMatchObject({ parserVersion: 0, ...extension });
    expect(entry.sourceMaterial).not.toHaveProperty('church');
    expect(entry.links[0]).not.toHaveProperty('label');
    expect(entry.links[0]).not.toHaveProperty('capturedAt');
    expect(entry.anchors[0]).not.toHaveProperty('note');
    expect(entry.anchors[0]).not.toHaveProperty('outlineEntryId');
  });

  it('still rejects malformed draft links before returning a restorable journal', () => {
    const input = rawDraft();
    expect(() => migrateExport({ entries: [], drafts: [{
      ...input, form: { ...input.form, links: [{ ...link, capturedTitle: false }] },
    }] })).toThrow(/draft.*link title/i);
  });

  it('keeps a malformed provided-material block intact in unmigrated data, never in Notes', () => {
    const malformed = { ...sourceMaterial, body: 7 };
    const { entries: [entry] } = migrateExport({ entries: [{ ...READING, sourceMaterial: malformed }] });
    expect(entry.sourceMaterial).toBeUndefined();
    expect(entry._unmigrated?.sourceMaterial).toEqual(malformed);
    expect(entry.notes).toBe(READING.notes);
  });

  it('survives import, IndexedDB reopen, full archive, restore and a second export unchanged', async () => {
    const name = 'fictional-migration-fidelity';
    const storage = new DexieStorageProvider(name);
    await storage.open();
    const parsed = await parseImport(JSON.stringify(envelope()));
    await applyImport(parsed, storage, 'merge');
    const reopened = new DexieStorageProvider(name);
    await reopened.open();
    const savedEntries = await reopened.listEntries();
    const savedDrafts = await reopened.listDrafts();
    expect(savedEntries).toHaveLength(1);
    expect(savedDrafts).toHaveLength(1);
    expect(savedEntries[0].sourceMaterial).toEqual(sourceMaterial);
    expect(savedEntries[0].anchors).toEqual(anchors);
    expect(savedDrafts[0].form).toEqual(rawDraft().form);
    expect(savedDrafts[0]._unmigrated?.futureDraft).toEqual({ selection: [1, 7] });

    const build = (entries = savedEntries, drafts: EntryDraft[] = savedDrafts) => buildArchive({
      entries, drafts, outlineBooks: [], topics: [], profile: 'refs-only', now: new Date(WHEN),
    });
    const archive = await build();
    const restored = await parseImport(archive.bytes);
    expect(restored.entries).toEqual(savedEntries);
    expect(restored.drafts).toEqual(savedDrafts);
    const isolated = new DexieStorageProvider('fictional-migration-fidelity-restored');
    await isolated.open();
    await applyImport(restored, isolated, 'replace');
    expect(await isolated.listEntries()).toEqual(savedEntries);
    expect(await isolated.listDrafts()).toEqual(savedDrafts);
    const second = await build(await isolated.listEntries(), await isolated.listDrafts());
    expect(second.bytes).toEqual(archive.bytes);
  });


  it.each(['futureField', '__proto__', 'constructor'])('keeps both entry extension values when %s already exists in _unmigrated', (key) => {
    const legacy = { version: 'older opaque value' };
    const incoming = { version: 'newer opaque value' };
    const raw = { ...READING, [key]: incoming, _unmigrated: { [key]: legacy } };
    const { entries: [entry], warnings } = migrateExport({ version: 1, entries: [raw] });
    expect(Object.hasOwn(entry, key)).toBe(true);
    expect((entry as unknown as Record<string, unknown>)[key]).toEqual(incoming);
    expect(entry._unmigrated?.[key]).toEqual(legacy);
    expect(warnings.join(' ')).toContain('both values are preserved');
    expect(Object.getPrototypeOf(entry)).toBe(Object.prototype);
    expect(migrateExport({ version: 1, entries: [entry] }).entries).toEqual([entry]);
  });

  it.each(['futureField', '__proto__', 'constructor'])('keeps both draft extension values when %s already exists in _unmigrated', (key) => {
    const legacy = { version: 'older opaque value' };
    const incoming = { version: 'newer opaque value' };
    const raw = { ...rawDraft(), [key]: incoming, _unmigrated: { [key]: legacy } };
    const { drafts: [draft], warnings } = migrateExport({ version: 1, entries: [], drafts: [raw] });
    expect(Object.hasOwn(draft, key)).toBe(true);
    expect((draft as unknown as Record<string, unknown>)[key]).toEqual(incoming);
    expect(draft._unmigrated?.[key]).toEqual(legacy);
    expect(warnings.join(' ')).toContain('both values are preserved');
    expect(Object.getPrototypeOf(draft)).toBe(Object.prototype);
    expect(migrateExport({ version: 1, entries: [], drafts: [draft] }).drafts).toEqual([draft]);
  });

  it('preserves colliding extension pairs through persisted import and isolated archive restore', async () => {
    const extra = { futureField: 'current value', _unmigrated: { futureField: 'earlier value' } };
    const parsed = await parseImport(JSON.stringify({
      format: 'journey-export', version: 1, entries: [{ ...rawEntry(), ...extra }], drafts: [{ ...rawDraft(), ...extra }],
    }));
    const storage = new DexieStorageProvider('fictional-extension-collision-source');
    await storage.open();
    await applyImport(parsed, storage, 'merge');
    const entries = await storage.listEntries();
    const drafts = await storage.listDrafts();
    expect(entries[0]).toMatchObject(extra);
    expect(drafts[0]).toMatchObject(extra);
    const archive = await buildArchive({ entries, drafts, outlineBooks: [], topics: [], profile: 'refs-only' });
    const receiving = new DexieStorageProvider('fictional-extension-collision-receiver');
    await receiving.open();
    await applyImport(await parseImport(archive.bytes), receiving, 'replace');
    expect(await receiving.listEntries()).toEqual(entries);
    expect(await receiving.listDrafts()).toEqual(drafts);
  });

  it('preserves an already validated draft form with extensions on subsequent migrations', () => {
    const first = migrateExport(envelope());
    const second = migrateExport({ version: 1, entries: first.entries, drafts: first.drafts });
    expect(second.entries).toEqual(first.entries);
    expect(second.drafts).toEqual(first.drafts);
    expect((second.drafts[0].form as DraftForm & { futureEditor: unknown }).futureEditor).toEqual({ caret: 5 });
    expect(second.warnings).toEqual([]);
  });
});
