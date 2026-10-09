/**
 * The adapters must carry the answer, not just the bytes.
 *
 * `download.ts` decides what a save result means; these prove the result gets
 * that far. The defect this exists for lived exactly here: the native adapter
 * awaited `saveDocument` and returned `void`, so a plugin that had carefully
 * distinguished "the file was written" from "the person backed out" was
 * answering into a vacuum.
 *
 * A test of `exportEverything` alone would not have caught it. That function
 * was always correct about the result it was handed; nobody handed it one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportEverything } from '../export/download';
import { DexieStorageProvider } from '../storage/db';
import type { DataProfile, OutlineBook, Topic } from '../types';

const saveDocument = vi.fn();
const pickDocument = vi.fn();

// Stubbed at the plugin boundary rather than at the adapter, so what is under
// test is the adapter's own handling of what a real plugin returns. The rest of
// the module is kept: `toBase64` lives here too and is the real encoder the
// adapter uses — replacing it would test a different function.
vi.mock('./native-documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./native-documents')>()),
  JourneyDocuments: {
    saveDocument: (...args: unknown[]) => saveDocument(...args),
    pickDocument: (...args: unknown[]) => pickDocument(...args),
  },
}));

const file = {
  suggestedName: 'journey-export-2026-09-18.zip',
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'application/zip',
};

const archiveInputs: { outlineBooks: OutlineBook[]; topics: Topic[]; profile: DataProfile } = {
  outlineBooks: [],
  topics: [],
  profile: 'refs-only',
};

let database = 0;

beforeEach(() => {
  saveDocument.mockReset();
  pickDocument.mockReset();
});

describe('the native saver reports what the operating system did', () => {
  it('passes a real save through', async () => {
    saveDocument.mockResolvedValue({ saved: true });
    const { nativeFileSaver } = await import('./native');

    await expect(nativeFileSaver.save(file)).resolves.toEqual({ status: 'saved' });
  });

  it('passes a cancellation through instead of swallowing it', async () => {
    // Swift resolves this from `documentPickerWasCancelled`, Java from a
    // result code that is not RESULT_OK. Discarding it is the whole bug.
    saveDocument.mockResolvedValue({ saved: false });
    const { nativeFileSaver } = await import('./native');

    await expect(nativeFileSaver.save(file)).resolves.toEqual({ status: 'cancelled' });
  });

  it('treats a plugin that says nothing useful as not saved', async () => {
    // An older or broken plugin build must not be able to claim a backup by
    // omission. Absent evidence is not evidence of a save.
    for (const answer of [{}, { saved: undefined }, { saved: 'yes' }, null]) {
      saveDocument.mockResolvedValue(answer);
      const { nativeFileSaver } = await import('./native');
      await expect(
        nativeFileSaver.save(file),
        `${JSON.stringify(answer)} was treated as a successful save`,
      ).resolves.toEqual({ status: 'failed', reason: 'unknown' });
    }
  });

  it('still hands the plugin the file it was given', async () => {
    saveDocument.mockResolvedValue({ saved: true });
    const { nativeFileSaver } = await import('./native');

    await nativeFileSaver.save(file);

    expect(saveDocument).toHaveBeenCalledTimes(1);
    const [options] = saveDocument.mock.calls[0] as [{ name: string; mimeType: string; base64: string }];
    expect(options.name).toBe(file.suggestedName);
    expect(options.mimeType).toBe('application/zip');
    expect(options.base64, 'the archive bytes were not handed over').toBeTruthy();
  });

  it('carries a native close failure through to backup metadata without false success', async () => {
    const previousExport = '2026-01-01T00:00:00.000Z';
    const previousDismissal = '2026-02-01T00:00:00.000Z';
    const storage = new DexieStorageProvider(`native-close-failure-${(database += 1)}`);
    await storage.updateSettings({
      lastExportAt: previousExport,
      reminderDismissedAt: previousDismissal,
      backupReminderDays: 7,
    });
    // Android rejects the bridge call when opening, writing, flushing or
    // closing the provider stream fails. The adapter must carry that answer
    // all the way to exportEverything rather than turning it into a backup.
    saveDocument.mockRejectedValue(new Error('The archive could not be saved.'));
    const { nativeFileSaver } = await import('./native');

    const outcome = await exportEverything({
      storage,
      files: nativeFileSaver,
      ...archiveInputs,
    });

    expect(outcome.save).toEqual({ status: 'failed', reason: 'io' });
    expect(await storage.getSettings()).toEqual({
      lastExportAt: previousExport,
      reminderDismissedAt: previousDismissal,
      backupReminderDays: 7,
    });
  });
});

describe('the native picker distinguishes cancellation from failure', () => {
  it('reports an explicit operating-system cancellation', async () => {
    pickDocument.mockResolvedValue({ cancelled: true });
    const { nativeFilePicker } = await import('./native');

    await expect(nativeFilePicker.pick()).resolves.toEqual({ status: 'cancelled' });
  });

  it('reports read, bridge, and permission errors as distinct failures', async () => {
    const { nativeFilePicker } = await import('./native');
    pickDocument.mockRejectedValueOnce(new Error('provider read failed'));
    await expect(nativeFilePicker.pick()).resolves.toEqual({ status: 'failed', reason: 'io' });

    pickDocument.mockRejectedValueOnce(new Error('native bridge unavailable'));
    await expect(nativeFilePicker.pick()).resolves.toEqual({ status: 'failed', reason: 'unavailable' });

    pickDocument.mockRejectedValueOnce(new Error('permission denied'));
    await expect(nativeFilePicker.pick()).resolves.toEqual({ status: 'failed', reason: 'permission' });

    pickDocument.mockResolvedValueOnce({ cancelled: false });
    await expect(nativeFilePicker.pick()).resolves.toEqual({ status: 'failed', reason: 'io' });
  });

  it('reports the native pre-allocation size limit separately', async () => {
    pickDocument.mockRejectedValue(new Error('File is larger than the supported 256 MiB limit'));
    const { nativeFilePicker } = await import('./native');

    await expect(nativeFilePicker.pick()).resolves.toEqual({
      status: 'failed',
      reason: 'too-large',
    });
  });

  it('returns the selected bytes and forwards the caller limit', async () => {
    pickDocument.mockResolvedValue({ cancelled: false, name: 'journal.zip', base64: 'AQID' });
    const { nativeFilePicker } = await import('./native');

    await expect(nativeFilePicker.pick({ maxBytes: 1234 })).resolves.toEqual({
      status: 'picked',
      file: { name: 'journal.zip', bytes: new Uint8Array([1, 2, 3]) },
    });
    expect(pickDocument).toHaveBeenCalledWith({ mimeTypes: undefined, maxBytes: 1234 });
  });
});

describe('the web saver still downloads', () => {
  it('clicks a download link and reports the download as started', async () => {
    const click = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
    const createObjectURL = vi.fn(() => 'blob:journey');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));

    const { webFileSaver } = await import('./web');
    const result = await webFileSaver.save(file);

    expect(click, 'the download was never triggered').toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    // `saved: true` on the web means the download STARTED. A browser gives no
    // completion or cancellation signal for an anchor download, and this is
    // the honest limit rather than a pretence: native, which does know, tells
    // the truth, and the web says what it can actually observe.
    expect(result).toEqual({ status: 'initiated-unverified' });

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports a verified File System Access write only after close completes', async () => {
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: vi.fn(async () => ({ createWritable: async () => ({ write, close }) })),
    });
    const { webFileSaver } = await import('./web');

    await expect(webFileSaver.save(file)).resolves.toEqual({ status: 'saved' });
    expect(write).toHaveBeenCalledWith(file.bytes);
    expect(close).toHaveBeenCalledTimes(1);
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it('reports dismissal of the verified browser picker as cancellation', async () => {
    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: vi.fn(async () => { throw abort; }),
    });
    const { webFileSaver } = await import('./web');

    await expect(webFileSaver.save(file)).resolves.toEqual({ status: 'cancelled' });
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  it('reports a browser write failure without claiming a saved backup', async () => {
    const abort = vi.fn(async () => {});
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: vi.fn(async () => ({
        createWritable: async () => ({
          write: async () => { throw new Error('disk full'); },
          close: async () => {},
          abort,
        }),
      })),
    });
    const { webFileSaver } = await import('./web');

    await expect(webFileSaver.save(file)).resolves.toEqual({ status: 'failed', reason: 'io' });
    expect(abort).toHaveBeenCalledTimes(1);
    delete (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});

describe('the web picker distinguishes dismissal from read failure', () => {
  it('reports the picker cancel event as cancellation', async () => {
    const { webFilePicker } = await import('./web');
    const result = webFilePicker.pick();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    input.dispatchEvent(new Event('cancel'));

    await expect(result).resolves.toEqual({ status: 'cancelled' });
  });

  it('rejects an oversized file before arrayBuffer is called', async () => {
    const { webFilePicker } = await import('./web');
    const file = new File(['12345'], 'too-large.zip');
    const read = vi.spyOn(file, 'arrayBuffer');
    const result = webFilePicker.pick({ maxBytes: 4 });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));

    await expect(result).resolves.toEqual({ status: 'failed', reason: 'too-large' });
    expect(read).not.toHaveBeenCalled();
  });

  it('reports a file read error as failure rather than cancellation', async () => {
    const { webFilePicker } = await import('./web');
    const file = new File(['content'], 'unreadable.zip');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('read failed'));
    const result = webFilePicker.pick();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));

    await expect(result).resolves.toEqual({ status: 'failed', reason: 'io' });
  });
});
