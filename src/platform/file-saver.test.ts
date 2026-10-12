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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  saveDocument.mockReset();
  pickDocument.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the native saver reports what the operating system did', () => {
  it('passes a real save through', async () => {
    saveDocument.mockResolvedValue({ saved: true });
    const { nativeFileSaver } = await import('./native');

    await expect(nativeFileSaver.save(file)).resolves.toEqual({ status: 'committed' });
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
      ).resolves.toEqual({ status: 'cancelled' });
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

    // An anchor download has no completion or cancellation signal. The tagged
    // result prevents the caller from recording it as a durable backup.
    expect(result).toEqual({ status: 'initiated' });

  });

  it('commits only after a File System Access writable closes successfully', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const recordReceiver = vi.fn();
    const showSaveFilePicker = vi.fn(function (this: Window) {
      recordReceiver(this === window);
      return Promise.resolve({
        createWritable: vi.fn().mockResolvedValue({ write, close }),
      });
    });
    vi.stubGlobal('showSaveFilePicker', showSaveFilePicker);

    const { webFileSaver } = await import('./web');
    await expect(webFileSaver.save(file)).resolves.toEqual({ status: 'committed' });
    expect(recordReceiver, 'the Web IDL method lost its Window receiver').toHaveBeenCalledWith(true);
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not claim a committed file when close fails', async () => {
    const closeFailure = new Error('destination disconnected on close');
    const abort = vi.fn(() => {
      throw new Error('cleanup also failed');
    });
    vi.stubGlobal(
      'showSaveFilePicker',
      vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({
          write: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockRejectedValue(closeFailure),
          abort,
        }),
      }),
    );

    const { webFileSaver } = await import('./web');
    await expect(webFileSaver.save(file)).rejects.toBe(closeFailure);
    expect(abort).toHaveBeenCalledWith(closeFailure);
  });

  it('reports a write-time AbortError as failure and cleans up the writable', async () => {
    const writeFailure = new Error('destination disappeared while writing');
    writeFailure.name = 'AbortError';
    const abort = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal(
      'showSaveFilePicker',
      vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({
          write: vi.fn().mockRejectedValue(writeFailure),
          close: vi.fn(),
          abort,
        }),
      }),
    );

    const { webFileSaver } = await import('./web');
    await expect(webFileSaver.save(file)).rejects.toBe(writeFailure);
    expect(abort).toHaveBeenCalledWith(writeFailure);
  });

  it('reports dismissal separately from a write failure', async () => {
    const cancelled = new Error('dismissed');
    cancelled.name = 'AbortError';
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(cancelled));

    const { webFileSaver } = await import('./web');
    await expect(webFileSaver.save(file)).resolves.toEqual({ status: 'cancelled' });
  });
});

describe('the web picker bounds memory before reading', () => {
  it('rejects an oversized File without calling arrayBuffer', async () => {
    const chosen = new File(['small placeholder'], 'oversized.zip');
    Object.defineProperty(chosen, 'size', { value: 64 * 1024 * 1024 + 1 });
    const read = vi.spyOn(chosen, 'arrayBuffer');
    const { pickedFromDomFile } = await import('./web');

    await expect(pickedFromDomFile(chosen)).rejects.toThrow(/64MB import limit/i);
    expect(read).not.toHaveBeenCalled();
  });
});
