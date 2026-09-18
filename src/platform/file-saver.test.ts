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

describe('the native saver reports what the operating system did', () => {
  it('passes a real save through', async () => {
    saveDocument.mockResolvedValue({ saved: true });
    const { nativeFileSaver } = await import('./native');

    await expect(nativeFileSaver.save(file)).resolves.toEqual({ saved: true });
  });

  it('passes a cancellation through instead of swallowing it', async () => {
    // Swift resolves this from `documentPickerWasCancelled`, Java from a
    // result code that is not RESULT_OK. Discarding it is the whole bug.
    saveDocument.mockResolvedValue({ saved: false });
    const { nativeFileSaver } = await import('./native');

    await expect(nativeFileSaver.save(file)).resolves.toEqual({ saved: false });
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
      ).resolves.toEqual({ saved: false });
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

    // `saved: true` on the web means the download STARTED. A browser gives no
    // completion or cancellation signal for an anchor download, and this is
    // the honest limit rather than a pretence: native, which does know, tells
    // the truth, and the web says what it can actually observe.
    expect(result).toEqual({ saved: true });

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
