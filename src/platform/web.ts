/**
 * The web edition's platform implementations.
 *
 * Each one is the code that already existed, moved behind a port and otherwise
 * unchanged. Nothing here is new behaviour: a download is still an anchor and an
 * object URL, printing is still `window.print()`, the guard is still
 * `beforeunload`, and choosing a file is still an `<input type="file">`.
 *
 * This file is the ONLY place in the application that is allowed to assume a
 * browser for these four capabilities. Phase 1 adds a sibling for the native
 * shells; neither will know the other exists.
 */

import type {
  FilePicker,
  FileSaver,
  OutgoingFile,
  PickOptions,
  PickedFile,
  Platform,
  Printer,
  SaveResult,
  ShareRequest,
  Sharer,
  UnsavedWorkGuard,
} from './ports';

/**
 * Save by download: a blob, an object URL, and a click on a link nobody sees.
 *
 * Lifted verbatim from `export/download.ts`, including the ten-second delay
 * before revoking the URL — Safari in particular will cancel a download whose
 * blob is released too early, and that was learned the hard way rather than
 * guessed.
 */
export const webFileSaver: FileSaver = {
  async save(file: OutgoingFile): Promise<SaveResult> {
    const blob = new Blob([file.bytes as BlobPart], { type: file.mimeType });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = file.suggestedName;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();

    // Give the download a moment to start before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);

    // `saved: true` here means the download was STARTED, not that a file now
    // exists on disk. A browser gives no completion signal and no cancellation
    // signal for an anchor download — if the person dismisses the save panel,
    // nothing tells this page. That limit is real and is not worked around:
    // inventing a completion API would be a worse lie than the one this whole
    // change exists to remove. Native, which does know, reports the truth.
    return { saved: true };
  },
};

/**
 * Choose a file with a detached `<input type="file">`.
 *
 * Detached rather than rendered, because the element is a mechanism and not
 * part of the page: a view that wants a file should say so, not lay one out.
 * The views keep their own visible inputs for now — this exists so that the
 * import flow has a platform-shaped way to ask, and so Phase 3 can answer with
 * a document picker without a view changing.
 *
 * Cancellation is the hard part and the reason this is not three lines. A file
 * dialog that is dismissed fires no `change` event at all in older browsers,
 * so a naive promise never settles and the caller hangs forever holding a
 * spinner. `cancel` handles modern browsers; the focus fallback handles the
 * rest.
 */
export const webFilePicker: FilePicker = {
  // The page renders the control here; see `presentsOwnUI` on the port.
  presentsOwnUI: false,

  pick(options: PickOptions = {}): Promise<PickedFile | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (options.accept?.length) input.accept = options.accept.join(',');
      input.style.display = 'none';
      document.body.append(input);

      let settled = false;
      const finish = (result: PickedFile | null) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('focus', onFocus);
        input.remove();
        resolve(result);
      };

      // Returning to the window with nothing chosen means it was dismissed.
      // Deferred a beat: `focus` arrives before `change` when a file WAS picked.
      const onFocus = () => {
        setTimeout(() => {
          if (!input.files || input.files.length === 0) finish(null);
        }, 300);
      };

      input.addEventListener('cancel', () => finish(null));
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) {
          finish(null);
          return;
        }
        void file
          .arrayBuffer()
          .then((buffer) => finish({ name: file.name, bytes: new Uint8Array(buffer) }))
          .catch(() => finish(null));
      });

      window.addEventListener('focus', onFocus);
      input.click();
    });
  },
};

/** The browser's own print dialog. */
export const webPrinter: Printer = {
  canPrint: true,

  print(): void {
    window.print();
  },
};

/**
 * `beforeunload`, which protects a tab and nothing else.
 *
 * Modern browsers show their own wording and ignore ours; the handler only has
 * to exist and cancel. Note what this does NOT do: it makes no attempt to save
 * anything, because there is no reliable time in which to do so. That
 * limitation is the honest one, and it is why the port is named for warning
 * rather than for saving.
 */
export const webUnsavedWorkGuard: UnsavedWorkGuard = {
  protect(hasUnsavedWork: () => boolean): () => void {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWork()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  },
};

/**
 * Sharing on the web, where the answer depends on the browser.
 *
 * `navigator.share` exists on mobile Safari and Chrome and hands the same
 * system sheet a native app gets. On a desktop browser it is usually absent,
 * and there is no honest substitute for a share sheet — so the capability
 * reports false and the view offers a download and a copy instead of
 * pretending.
 *
 * `canShare({ files })` is asked separately: a browser may share text and
 * refuse files, and offering a PDF it will reject produces a failure the
 * reader cannot act on.
 *
 * An `AbortError` means the person dismissed the sheet. That is a choice, not
 * a fault, and it comes back as `shared: false`.
 */
export const webSharer: Sharer = {
  get canShare(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  },

  async share(request: ShareRequest): Promise<{ shared: boolean }> {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
      throw new Error('This browser cannot open a share sheet');
    }

    const payload: ShareData = { title: request.title };
    if (request.text) payload.text = request.text;

    if (request.file) {
      const file = new File([request.file.bytes as BlobPart], request.file.filename, {
        type: request.file.mimeType,
      });
      // Only when the browser says it will take it.
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        payload.files = [file];
      } else if (!request.text) {
        throw new Error('This browser cannot share a file');
      }
    }

    try {
      await navigator.share(payload);
      return { shared: true };
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return { shared: false };
      throw cause;
    }
  },
};

/** The web platform, assembled. */
export const webPlatform: Platform = {
  files: webFileSaver,
  picker: webFilePicker,
  printer: webPrinter,
  unsavedWork: webUnsavedWorkGuard,
  sharer: webSharer,
};

/**
 * A DOM `File` as the platform's shape.
 *
 * The visible `<input type="file">` in the import views is good web UX — it is
 * keyboard reachable, screen-reader labelled, and covered by the accessibility
 * suite — so it stays. What changes is what happens next: the view converts the
 * browser's `File` into a `PickedFile` here and hands that on, so everything
 * downstream deals in a name and bytes. A native picker produces the same shape
 * without an `<input>` existing at all.
 */
export async function pickedFromDomFile(file: File): Promise<PickedFile> {
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}
