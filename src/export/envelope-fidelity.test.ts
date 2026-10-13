import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import type { EntryDraft } from '../types';
import type { StorageProvider } from '../storage/StorageProvider';
import type { JournalSnapshot } from '../storage/journal';
import type { JournalEnvelopeMetadata } from '../storage/envelope-metadata';
import { DexieStorageProvider } from '../storage/db';
import { mergeEnvelopeMetadata } from '../storage/envelope-metadata';
import { buildArchive, buildContext, buildJourneyJson } from './archive';
import { exportEverything } from './download';
import { applyImport, parseImport } from './importer';
import { readZip, zipEntryText } from './zip';
import { READING } from './fixtures';

const logical = ({ entries, drafts, envelopeMetadata }: JournalSnapshot) => ({ entries, drafts, envelopeMetadata });
const mergeMetadata = async (storage: StorageProvider, metadata: JournalEnvelopeMetadata) => {
  const before = await storage.readJournalSnapshot();
  await storage.replaceJournal(before.entries, before.drafts, before.token,
    mergeEnvelopeMetadata(before.envelopeMetadata ?? [], metadata));
};

const NOW = new Date('2026-10-13T12:00:00.000Z');
const archiveOptions = { outlineBooks: [], topics: [], profile: 'refs-only' as const, now: NOW };
const original = JSON.parse('{"__proto__":{"safe":"literal"},"constructor":false,"future":{"note":"Fictional private root data","revision":1},"_unmigrated":{"future":"earlier original"}}');
let nextStore = 0;
const store = async () => {
  const db = new DexieStorageProvider(`envelope-fidelity-${++nextStore}`);
  await db.open();
  return db;
};
const draft: EntryDraft = {
  id: 'unfinished', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
  form: { kind: 'sermon', title: '', date: '2026-10-13', place: '', speaker: '', sermonSeries: '',
    notes: 'Fictional unfinished sentence  ', reflection: '', prayer: '', tagsText: '', links: [],
    anchors: [], forDescendants: false, scriptureRefs: [], sourceMaterial: null },
};
const json = (extras: Record<string, unknown>, populated = false) => JSON.stringify({
  format: 'journey-export', version: 1, exportedAt: NOW.toISOString(),
  entries: populated ? [READING] : [], drafts: populated ? [draft] : [], ...extras,
});
const canonical = async (bytes: Uint8Array) => {
  const files = await readZip(bytes);
  const file = files.find((item) => item.path === 'data/journey.json');
  expect(file).toBeDefined();
  return JSON.parse(zipEntryText(file!));
};
const captureArchive = async (storage: StorageProvider) => {
  const handed: Uint8Array[] = [];
  const result = await exportEverything({ storage, ...archiveOptions,
    files: { save: async (file) => { handed.push(file.bytes); return { status: 'committed' }; } },
  });
  expect(handed).toHaveLength(1);
  expect(result.delivery).toBe('committed');
  return handed[0];
};

describe('full-envelope backup / restore / re-export wiring', () => {
  it.each([false, true])('persists, backs up, restores and re-exports every original map (populated=%s)', async (populated) => {
    const storage = await store();
    const parsed = await parseImport(json(original, populated));
    expect(parsed.envelopeMetadata).toEqual([original]);
    expect(parsed.warnings.join(' ')).not.toContain('cannot retain');
    await applyImport(parsed, storage, 'replace');
    const conflicting = { future: { note: 'A distinct fictional original', revision: 2 } };
    await applyImport(await parseImport(json(conflicting)), storage);
    const expected = mergeEnvelopeMetadata([original, conflicting]);
    const before = await storage.readJournalSnapshot();
    expect(before.envelopeMetadata).toEqual(expected);
    expect(before.entries).toHaveLength(populated ? 1 : 0);
    expect(before.drafts).toHaveLength(populated ? 1 : 0);

    const bytes = await captureArchive(storage);
    const exported = await canonical(bytes);
    expect(exported.format).toBe('journey-export');
    expect(exported.version).toBe(1);
    expect(exported._unmigrated.companionSourceEnvelopes).toEqual(expected);
    expect(Object.hasOwn(exported._unmigrated.companionSourceEnvelopes.find((item: Record<string, unknown>) => Object.hasOwn(item, '__proto__')), '__proto__')).toBe(true);

    const isolated = await store();
    await applyImport(await parseImport(bytes), isolated, 'replace');
    expect(logical(await isolated.readJournalSnapshot())).toEqual(logical(before));
    expect(await canonical(await captureArchive(isolated))).toEqual(exported);

    // Idempotent cycles use the real provider-backed user-facing exporter.
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await applyImport(await parseImport(await captureArchive(isolated)), isolated);
    }
    expect(logical(await isolated.readJournalSnapshot())).toEqual(logical(before));
    expect(await canonical(await captureArchive(isolated))).toEqual(exported);
  });

  it('exports unchanged v1 envelope shape when there is no opaque metadata', async () => {
    expect(buildJourneyJson(await buildContext({ ...archiveOptions, entries: [] }))).toEqual({
      format: 'journey-export', version: 1, exportedAt: NOW.toISOString(), entries: [],
    });
  });

  it('omits private root metadata from a partial archive at both exporter boundaries', async () => {
    const storage = await store();
    await applyImport(await parseImport(json(original, true)), storage);
    const outcome = await exportEverything({ storage, ...archiveOptions, filter: {},
      files: { save: async () => ({ status: 'committed' }) },
    });
    expect((await canonical(outcome.archive.bytes))._unmigrated).toBeUndefined();
    const direct = await buildArchive({ ...archiveOptions, entries: [READING], filter: {}, envelopeMetadata: [original] });
    expect((await canonical(direct.bytes))._unmigrated).toBeUndefined();
    expect((await storage.readJournalSnapshot()).envelopeMetadata).toEqual([original]);
  });

  it.each(['merge', 'replace'] as const)('refuses %s if metadata changed after review without changing writing', async (mode) => {
    const storage = await store();
    await applyImport(await parseImport(json(original, true)), storage);
    const reviewed = await storage.readJournalSnapshot();
    await mergeMetadata(storage, [{ concurrent: 'keep this' }]);
    const afterConcurrent = await storage.readJournalSnapshot();
    await expect(applyImport(await parseImport(json({ incoming: 'do not commit' })), storage, mode, reviewed.token))
      .rejects.toThrow(/journal changed/i);
    expect(logical(await storage.readJournalSnapshot())).toEqual(logical(afterConcurrent));
  });

  it('upgrades a populated IndexedDB v2 journal additively without altering records/settings', async () => {
    const name = `envelope-v2-upgrade-${++nextStore}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores({ entries: 'id, date, kind, speaker, place, updatedAt, *tags, *anchorKeys', settings: 'key' });
    legacy.version(2).stores({ drafts: 'id, entryId, updatedAt' });
    await legacy.open();
    await legacy.table('entries').put(READING);
    await legacy.table('drafts').put(draft);
    await legacy.table('settings').put({ key: 'singleton', lastExportAt: NOW.toISOString() });
    legacy.close();
    const current = new DexieStorageProvider(name);
    await current.open();
    expect(logical(await current.readJournalSnapshot())).toEqual({ entries: [READING], drafts: [draft], envelopeMetadata: [] });
    expect(await current.getSettings()).toEqual({ lastExportAt: NOW.toISOString() });
    await mergeMetadata(current, [original]);
    expect((await current.readJournalSnapshot()).envelopeMetadata).toEqual([original]);
    const older = new Dexie(name);
    older.version(2).stores({ entries: 'id', drafts: 'id', settings: 'key' });
    // Dexie permits an older declaration to reopen a newer physical store.
    // Historical browser code cannot be retrofitted with a schema refusal.
    await older.open();
    expect(await older.table('entries').toArray()).toMatchObject([READING]);
    expect(await older.table('drafts').toArray()).toEqual([draft]);
    older.close();
    expect((await current.readJournalSnapshot()).envelopeMetadata).toEqual([original]);
  });
});


it('retains main backup freshness behavior when only opaque metadata changes during delivery', async () => {
  const storage = await store();
  await mergeMetadata(storage, [{ before: 'in the archive' }]);
  let handed: Uint8Array | undefined;
  const outcome = await exportEverything({ storage, ...archiveOptions,
    files: { save: async (file) => {
      handed = file.bytes;
      await mergeMetadata(storage, [{ after: 'new committed metadata' }]);
      return { status: 'committed' };
    } },
  });
  expect(outcome.delivery).toBe('committed');
  expect(outcome.current).toBe(false);
  expect(outcome.recorded).toBe(false);
  expect((await storage.getSettings()).lastExportAt).toBeUndefined();
  expect((await parseImport(handed!)).envelopeMetadata).toEqual([{ before: 'in the archive' }]);
});
