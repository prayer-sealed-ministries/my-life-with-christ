/**
 * A cancelled save is not an export.
 *
 * Found on a real iPhone, mid-proof. Both native plugins already reported
 * whether the file reached the file system — Swift resolves `saved: true` only
 * from `didPickDocumentsAt` in export mode, Java only on RESULT_OK, and both say
 * `saved: false` when the person backs out. The TypeScript adapter awaited that
 * answer and threw it away, because `FileSaver.save` returned `void`.
 *
 * So backing out of the export dialog recorded a successful export: it wrote
 * `lastExportAt`, cleared any reminder dismissal, and left the journal page
 * saying "Last exported today" over a device that still held the only copy.
 *
 * That is the worst direction an error can point in this product. Everything
 * else it gets wrong costs a tap; this one tells a reader their life's writing
 * is safe somewhere it is not.
 */

import { describe, expect, it } from 'vitest';

import { exportEverything } from './download';
import type { FileSaver, OutgoingFile, SaveResult } from '../platform/ports';
import { DexieStorageProvider } from '../storage/db';
import type { StorageProvider } from '../storage/StorageProvider';
import type { DataProfile, Entry, OutlineBook, Topic } from '../types';

/**
 * The archive inputs, at their smallest.
 *
 * An empty outline and topic set is legitimate — it is exactly what a
 * `refs-only` build ships — and it keeps these cases about the save result
 * rather than about the contents of the zip, which `roundtrip.test.ts` owns.
 */
const ARCHIVE_INPUTS: { outlineBooks: OutlineBook[]; topics: Topic[]; profile: DataProfile } = {
  outlineBooks: [],
  topics: [],
  profile: 'refs-only',
};

let dbCounter = 0;
const freshStorage = () => new DexieStorageProvider(`journey-save-result-${(dbCounter += 1)}`);

/** A saver that answers the way a native one does, and records what it was given. */
function saverThat(saved: boolean) {
  const handed: OutgoingFile[] = [];
  const files: FileSaver = {
    async save(file: OutgoingFile): Promise<SaveResult> {
      handed.push(file);
      return saved ? { status: 'saved' } : { status: 'cancelled' };
    },
  };
  return { files, handed };
}

function entry(overrides: Partial<Entry> & { id: string }): Entry {
  return {
    kind: 'sermon',
    title: 'Untitled',
    date: '2026-01-01',
    anchors: [],
    scriptureRefs: [],
    notes: 'Something worth keeping.',
    reflection: '',
    links: [],
    tags: [],
    forDescendants: false,
    visibility: 'private',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function journalWith(settings: Record<string, unknown> = {}) {
  const storage = freshStorage();
  await storage.putEntries([entry({ id: 'one' }), entry({ id: 'two', title: 'Second' })]);
  if (Object.keys(settings).length) await storage.updateSettings(settings);
  return storage;
}

describe('backing out of the save dialog', () => {
  it('does not record an export that did not happen', async () => {
    const storage = await journalWith();
    const { files } = saverThat(false);

    await exportEverything({ storage, files, ...ARCHIVE_INPUTS });

    expect(
      (await storage.getSettings()).lastExportAt,
      'a cancelled save was recorded as an export',
    ).toBeUndefined();
  });

  it('leaves an earlier export date exactly where it was', async () => {
    // The dangerous version of the bug: a real export from months ago, and a
    // cancel today silently making the journal look freshly backed up.
    const months_ago = '2026-01-01T00:00:00.000Z';
    const storage = await journalWith({ lastExportAt: months_ago });
    const { files } = saverThat(false);

    await exportEverything({ storage, files, ...ARCHIVE_INPUTS });

    expect((await storage.getSettings()).lastExportAt).toBe(months_ago);
  });

  it('does not clear a reminder dismissal', async () => {
    const dismissed = '2026-02-01T00:00:00.000Z';
    const storage = await journalWith({ reminderDismissedAt: dismissed });
    const { files } = saverThat(false);

    await exportEverything({ storage, files, ...ARCHIVE_INPUTS });

    expect(
      (await storage.getSettings()).reminderDismissedAt,
      'a cancelled save reset the reminder',
    ).toBe(dismissed);
  });

  it('touches no backup metadata at all', async () => {
    const before = {
      lastExportAt: '2026-01-01T00:00:00.000Z',
      reminderDismissedAt: '2026-02-01T00:00:00.000Z',
      backupReminderDays: 7,
    };
    const storage = await journalWith(before);
    const { files } = saverThat(false);

    await exportEverything({ storage, files, ...ARCHIVE_INPUTS });

    expect(await storage.getSettings()).toEqual(before);
  });

  it('still builds the archive, because the bytes were never the problem', async () => {
    // Cancelling is about where the file went, not whether it could be made.
    const storage = await journalWith();
    const { files, handed } = saverThat(false);

    const { archive, save } = await exportEverything({ storage, files, ...ARCHIVE_INPUTS });

    expect(save.status, 'a cancelled save was reported as saved').toBe('cancelled');
    expect(archive.entryCount).toBe(2);
    expect(handed, 'the saver was never offered the archive').toHaveLength(1);
    expect(handed[0].suggestedName).toMatch(/^journey-export-\d{4}-\d{2}-\d{2}\.zip$/);
  });
});

describe('a save the file system accepted', () => {
  it('records the export', async () => {
    const storage = await journalWith();
    const { files } = saverThat(true);

    await exportEverything({ storage, files, ...ARCHIVE_INPUTS });

    const after = await storage.getSettings();
    expect(after.lastExportAt, 'a successful export was not recorded').toBeTruthy();
    expect(Number.isNaN(Date.parse(after.lastExportAt!))).toBe(false);
  });

  it('advances an older export date', async () => {
    const storage = await journalWith({ lastExportAt: '2026-01-01T00:00:00.000Z' });
    const { files } = saverThat(true);

    await exportEverything({ storage, files, ...ARCHIVE_INPUTS });

    const after = await storage.getSettings();
    expect(Date.parse(after.lastExportAt!)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'));
  });

  it('clears a dismissal, so the reminder starts again from this export', async () => {
    const storage = await journalWith({ reminderDismissedAt: '2026-02-01T00:00:00.000Z' });
    const { files } = saverThat(true);

    await exportEverything({ storage, files, ...ARCHIVE_INPUTS });

    expect((await storage.getSettings()).reminderDismissedAt).toBeUndefined();
  });

  it('keeps the reminder interval the reader chose', async () => {
    const storage = await journalWith({ backupReminderDays: 7 });
    const { files } = saverThat(true);

    await exportEverything({ storage, files, ...ARCHIVE_INPUTS });

    expect(
      (await storage.getSettings()).backupReminderDays,
      'the export overwrote the chosen interval',
    ).toBe(7);
  });

  it('reports a separately failed reminder update without denying the completed file', async () => {
    const underlying = await journalWith();
    const storage = new Proxy(underlying, {
      get(target, prop, receiver) {
        if (prop === 'updateSettings') return async () => { throw new Error('disk full'); };
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as StorageProvider;
    const { files, handed } = saverThat(true);

    const outcome = await exportEverything({ storage, files, ...ARCHIVE_INPUTS });

    expect(outcome.save).toEqual({ status: 'saved' });
    expect(outcome.reminderRecorded).toBe(false);
    expect(handed).toHaveLength(1);
    expect((await underlying.getSettings()).lastExportAt).toBeUndefined();
  });
});

describe('a complete backup requires every component', () => {
  it('does not offer a file or update metadata when entries cannot be read', async () => {
    const underlying = await journalWith({ lastExportAt: '2026-01-01T00:00:00.000Z' });
    const storage = new Proxy(underlying, {
      get(target, prop, receiver) {
        if (prop === 'listEntriesChronological') return async () => { throw new Error('read failed'); };
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as StorageProvider;
    const { files, handed } = saverThat(true);

    await expect(exportEverything({ storage, files, ...ARCHIVE_INPUTS })).rejects.toThrow(/read failed/i);
    expect(handed).toHaveLength(0);
    expect((await underlying.getSettings()).lastExportAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('does not silently substitute an empty draft collection when drafts cannot be read', async () => {
    const underlying = await journalWith();
    const storage = new Proxy(underlying, {
      get(target, prop, receiver) {
        if (prop === 'listDrafts') return async () => { throw new Error('draft read failed'); };
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as StorageProvider;
    const { files, handed } = saverThat(true);

    await expect(exportEverything({ storage, files, ...ARCHIVE_INPUTS })).rejects.toThrow(/draft read failed/i);
    expect(handed).toHaveLength(0);
    expect((await underlying.getSettings()).lastExportAt).toBeUndefined();
  });

  it('does not offer a partial file or update metadata when archive construction fails', async () => {
    const underlying = await journalWith();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const storage = new Proxy(underlying, {
      get(target, prop, receiver) {
        if (prop === 'listEntriesChronological') {
          return async () => [entry({ id: 'bad', _unmigrated: cycle })];
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as StorageProvider;
    const { files, handed } = saverThat(true);

    await expect(exportEverything({ storage, files, ...ARCHIVE_INPUTS })).rejects.toThrow();
    expect(handed).toHaveLength(0);
    expect((await underlying.getSettings()).lastExportAt).toBeUndefined();
  });

  it.each<SaveResult>([
    { status: 'initiated-unverified' },
    { status: 'failed', reason: 'io' },
  ])('does not reset the reminder for $status delivery', async (result) => {
    const storage = await journalWith({ reminderDismissedAt: '2026-01-01T00:00:00.000Z' });
    const files: FileSaver = { save: async () => result };

    const outcome = await exportEverything({ storage, files, ...ARCHIVE_INPUTS });

    expect(outcome.save).toEqual(result);
    expect(await storage.getSettings()).toEqual({
      reminderDismissedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('a partial export is still not a backup', () => {
  it('records nothing even when the save succeeded', async () => {
    // The pre-existing rule, held alongside the new one: both conditions have
    // to be true before this app will say a journal has been exported.
    const storage = await journalWith();
    const { files } = saverThat(true);

    await exportEverything({ storage, files, ...ARCHIVE_INPUTS, filter: { kinds: ['sermon'] } });

    expect((await storage.getSettings()).lastExportAt).toBeUndefined();
  });
});
