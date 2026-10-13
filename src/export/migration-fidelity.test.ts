import { describe, expect, it } from 'vitest';

import type { DraftForm, EntryDraft } from '../types';
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
      form: { futureEditor: { caret: 5 } },
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
    const raw = {
      ...READING,
      source: { ...source, page: { invalid: true }, itemIndex: 'bad', parserVersion: null },
      sourceMaterial: { ...sourceMaterial, church: 7, parserVersion: 'bad' },
      links: [{ ...link, label: 7, capturedAt: {} }],
      anchors: [{ ...scripture, note: { invalid: true }, outlineEntryId: 7 }],
    };
    const { entries: [entry] } = migrateExport({ entries: [raw] });
    expect(entry.source).toMatchObject({ itemIndex: 0, parserVersion: 0, ...extension });
    expect(entry.source).not.toHaveProperty('page');
    expect(entry.sourceMaterial).toMatchObject({ parserVersion: 0, ...extension });
    expect(entry.sourceMaterial).not.toHaveProperty('church');
    expect(entry.links[0]).not.toHaveProperty('label');
    expect(entry.links[0]).not.toHaveProperty('capturedAt');
    expect(entry.anchors[0]).not.toHaveProperty('note');
    expect(entry.anchors[0]).not.toHaveProperty('outlineEntryId');
    expect(entry._unmigrated).toMatchObject({
      source: raw.source, sourceMaterial: raw.sourceMaterial, links: raw.links, anchors: raw.anchors,
    });
    expect(migrateExport({ entries: [entry] }).entries).toEqual([entry]);
  });

  const partiallyMalformedBlocks = [
    ['source', { ...source, itemIndex: 'future-index' }],
    ['source', { ...source, parserVersion: { major: 2 } }],
    ['source', { ...source, page: { pageIndex: 3 } }],
    ['sourceMaterial', { ...sourceMaterial, parserVersion: 'next' }],
    ['sourceMaterial', { ...sourceMaterial, sha256: { digest: 'opaque' } }],
    ['sourceMaterial', { ...sourceMaterial, church: { name: 'Fictional church' } }],
    ['sourceMaterial', { ...sourceMaterial, speaker: ['Fictional speaker'] }],
    ['sourceMaterial', { ...sourceMaterial, date: { value: '2026-10-11' } }],
    ['sourceMaterial', { ...sourceMaterial, scripture: ['Luke 14:12', { reference: 'Luke 14:14' }] }],
    ['sourceMaterial', { ...sourceMaterial, scripture: { reference: 'Luke 14:14' } }],
    ['links', [{ ...link, label: { text: 'Fictional label' } }]],
    ['links', [{ ...link, capturedTitle: ['Fictional title'] }]],
    ['links', [{ ...link, capturedAt: { date: WHEN } }]],
    ['anchors', [{ ...scripture, note: { text: 'Fictional annotation' } }]],
    ['anchors', [{ ...scripture, outlineEntryId: { id: 'fictional' } }]],
    ['anchors', [{ ...scripture, kind: 'future-anchor' }]],
    ['anchors', [{ ...scripture, note: ['Fictional annotation'] }, 'unresolved-outline']],
  ] as const;

  it.each(partiallyMalformedBlocks)('preserves altered nested known values in the %s block: %j', (key, malformed) => {
    const input = { ...READING, [key]: malformed };
    const original = JSON.stringify(input);
    const { entries: [entry], warnings } = migrateExport({ entries: [input] });
    expect(entry._unmigrated?.[key]).toEqual(malformed);
    expect(warnings.join(' ')).toContain('preserved');
    expect(migrateExport({ entries: [entry] }).entries).toEqual([entry]);
    expect(JSON.stringify(input)).toBe(original);
  });

  it.each(partiallyMalformedBlocks)('rejects nested known %s loss when preservation already contains a different value: %j', (key, malformed) => {
    const input = { ...READING, [key]: malformed, _unmigrated: { [key]: { older: true } } };
    const original = JSON.stringify(input);
    expect(() => migrateExport({ entries: [input] })).toThrow(/cannot be preserved/);
    expect(JSON.stringify(input)).toBe(original);
  });

  it('allows absent legacy provenance defaults without duplicating valid nested fields', () => {
    const legacySource = { format: 'txt', filename: 'fictional.txt', importedAt: WHEN };
    const legacyMaterial = { format: 'txt', filename: 'fictional.txt', importedAt: WHEN, body: 'Fictional text' };
    const { entries: [entry], warnings } = migrateExport({ entries: [{
      ...READING, source: legacySource, sourceMaterial: legacyMaterial,
    }] });
    expect(entry.source).toEqual({ ...legacySource, itemIndex: 0, parserVersion: 0 });
    expect(entry.sourceMaterial).toEqual({ ...legacyMaterial, parserVersion: 0 });
    expect(entry._unmigrated).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it.each([null, false, 7, 'Fictional unstructured writing'])('refuses malformed entry rows instead of silently restoring only valid rows: %j', (malformed) => {
    expect(() => migrateExport({ entries: [rawEntry(), malformed] })).toThrow(/entry.*malformed/i);
  });

  it('still rejects malformed draft links before returning a restorable journal', () => {
    const input = rawDraft();
    expect(() => migrateExport({ entries: [], drafts: [{
      ...input, form: { ...input.form, links: [{ ...link, capturedTitle: false }] },
    }] })).toThrow(/draft.*links/i);
  });

  it('keeps a malformed provided-material block intact in unmigrated data, never in Notes', () => {
    const malformed = { ...sourceMaterial, body: 7 };
    const { entries: [entry] } = migrateExport({ entries: [{ ...READING, sourceMaterial: malformed }] });
    expect(entry.sourceMaterial).toBeUndefined();
    expect(entry._unmigrated?.sourceMaterial).toEqual(malformed);
    expect(entry.notes).toBe(READING.notes);
  });

  it('survives import, IndexedDB reopen, full archive, restore and a second export unchanged', async () => {
    const [{ DexieStorageProvider }, { buildArchive }, { applyImport, parseImport }] = await Promise.all([
      import('../storage/db'), import('./archive'), import('./importer'),
    ]);
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
    const [{ DexieStorageProvider }, { buildArchive }, { applyImport, parseImport }] = await Promise.all([
      import('../storage/db'), import('./archive'), import('./importer'),
    ]);
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

  it('defaults only absent companion draft link fields while keeping extensions and the input intact', () => {
    const urlOnly = { url: link.url, ...extension };
    const input = {
      ...rawDraft(), entryId: READING.id,
      form: { ...rawDraft().form, links: [urlOnly] },
    };
    const { drafts: [draft] } = migrateExport({ entries: [rawEntry()], drafts: [input] });
    expect(draft.form.links).toEqual([{ ...urlOnly, label: '', capturedTitle: '' }]);
    expect(input.form.links).toEqual([urlOnly]);
    expect(migrateExport({ entries: [rawEntry()], drafts: [draft] }).drafts).toEqual([draft]);
  });

  it.each(['label', 'capturedTitle', 'capturedAt'])('rejects malformed present draft link %s values', (field) => {
    for (const malformed of [false, 7, null, {}, []]) {
      const input = { ...rawDraft(), form: {
        ...rawDraft().form, links: [{ ...link, [field]: malformed }],
      } };
      expect(() => migrateExport({ entries: [], drafts: [input] })).toThrow(/draft.*links/i);
    }
  });

  it('rejects malformed draft Scripture notes instead of treating a known field as an extension', () => {
    const input = { ...rawDraft(), form: {
      ...rawDraft().form, anchors: [{ ...scripture, note: { invalid: true } }],
    } };
    expect(() => migrateExport({ entries: [], drafts: [input] })).toThrow(/draft.*anchors/i);
  });

  it.each(['futureField', '__proto__', 'constructor'])('keeps both draft form extension values when %s already occupies its preserved slot', (key) => {
    const older = { version: 'older form value' };
    const incoming = { version: 'newer form value' };
    const input = {
      ...rawDraft(), form: { ...rawDraft().form, [key]: incoming },
      _unmigrated: { form: { [key]: older } },
    };
    const { drafts: [draft], warnings } = migrateExport({ entries: [], drafts: [input] });
    expect(Object.hasOwn(draft.form, key)).toBe(true);
    expect((draft.form as unknown as Record<string, unknown>)[key]).toEqual(incoming);
    expect(draft._unmigrated?.form).toEqual({ [key]: older, futureEditor: { caret: 5 } });
    expect(Object.getPrototypeOf(draft.form)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(draft._unmigrated?.form)).toBe(Object.prototype);
    expect(warnings.join(' ')).toContain('both values are preserved');
    expect(migrateExport({ entries: [], drafts: [draft] }).drafts).toEqual([draft]);
  });

  it.each([null, 'opaque older form', ['older form']])('preserves opaque _unmigrated.form data: %j', (older) => {
    const input = { ...rawDraft(), _unmigrated: { form: older } };
    const { drafts: [draft], warnings } = migrateExport({ entries: [], drafts: [input] });
    expect(draft._unmigrated?.form).toEqual(older);
    expect((draft.form as DraftForm & { futureEditor: unknown }).futureEditor).toEqual({ caret: 5 });
    expect(warnings.join(' ')).toContain('both values are preserved');
    expect(migrateExport({ entries: [], drafts: [draft] }).drafts).toEqual([draft]);
  });

  it.each([
    ['source', { format: 'future-source', body: 'New provenance' }],
    ['sourceMaterial', { ...sourceMaterial, body: 7 }],
    ['notes', { markdown: 'New notes' }],
    ['anchors', ['unknown-outline-id']],
    ['links', [null]],
    ['tags', ['tag', 7]],
    ['forDescendants', { choice: true }],
    ['visibility', 'future-visibility'],
    ['kind', 'future-kind'],
  ])('rejects a malformed known %s field when its preservation slot contains a different value', (key, malformed) => {
    const input = { ...READING, [key as string]: malformed, _unmigrated: {
      [key as string]: { older: 'Must not be overwritten' },
    } };
    const before = JSON.stringify(input);
    expect(() => migrateExport({ entries: [input] })).toThrow(
      `Entry ${READING.id}: ${key} cannot be preserved because _unmigrated.${key} already contains a different value. Nothing was restored.`,
    );
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(['source', 'sourceMaterial', 'notes'])('accepts an identical already-preserved malformed %s value regardless of object-key order', (key) => {
    const original = { first: 'Fictional original value', second: { detail: true } };
    const carried = { second: { detail: true }, first: 'Fictional original value' };
    const { entries: [entry] } = migrateExport({ entries: [{
      ...READING, [key]: original, _unmigrated: { [key]: carried },
    }] });
    expect(entry._unmigrated?.[key]).toEqual(original);
    expect(migrateExport({ entries: [entry] }).entries).toEqual([entry]);
  });

  it('preserves an already validated draft form with extensions on subsequent migrations', () => {
    const first = migrateExport(envelope());
    const second = migrateExport({ version: 1, entries: first.entries, drafts: first.drafts });
    expect(second.entries).toEqual(first.entries);
    expect(second.drafts).toEqual(first.drafts);
    expect((second.drafts[0].form as DraftForm & { futureEditor: unknown }).futureEditor).toEqual({ caret: 5 });
    expect(second.drafts[0]._unmigrated?.form).toEqual({ futureEditor: { caret: 5 } });
  });
});
