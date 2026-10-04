/**
 * The native edition's platform implementations.
 *
 * The sibling of `web.ts`, and the only place in the application allowed to
 * assume a native shell for these capabilities. Neither file knows the other
 * exists; the provider picks one at startup and every view below is unchanged.
 *
 * The rule these obey: **native adapters move bytes.** They do not know what an
 * archive is, they do not validate one, and they never write the journal. The
 * canonical archive is built and parsed in shared TypeScript so there is one
 * implementation of the format across every edition — a Swift or Kotlin
 * archive writer would be a second answer to a question that must only have one.
 */

import { nativeAppLock, webAppLock } from './app-lock';
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
import { JourneyDocuments, fromBase64, toBase64 } from './native-documents';
import { nativePlatform } from './runtime';

/**
 * Save by handing the bytes to the OS document interface.
 *
 * On iOS this is `UIDocumentPickerViewController` in export mode; on Android it
 * is `ACTION_CREATE_DOCUMENT` through the Storage Access Framework. Both end
 * with the file wherever the person chose to put it — on the device, in iCloud
 * Drive, on Google Drive, on a USB stick — which is the entire point. The app
 * does not learn the destination, and does not need to.
 *
 * Backing out of the dialog resolves normally. Nothing has been written and
 * nothing has failed; a person who changes their mind has not hit an error.
 */
export const nativeFileSaver: FileSaver = {
  async save(file: OutgoingFile): Promise<SaveResult> {
    // The plugin's answer is the whole point of this call. Swift resolves
    // `saved: true` only from `didPickDocumentsAt` in export mode, and Java
    // only on RESULT_OK; both say `saved: false` when the person backs out.
    // Discarding that — which this adapter used to do — turns a cancellation
    // into a recorded backup.
    const result = await JourneyDocuments.saveDocument({
      name: file.suggestedName,
      mimeType: file.mimeType,
      base64: toBase64(file.bytes),
    });
    // `result?.` and `=== true`, both deliberate: only an explicit yes counts.
    // A plugin that returns nothing, or something unexpected, must not be able
    // to claim a backup by omission.
    return { saved: result?.saved === true };
  },
};

/**
 * Choose a file through the OS document picker.
 *
 * `UIDocumentPickerViewController` on iOS, `ACTION_OPEN_DOCUMENT` on Android.
 * Returns `null` on cancellation, exactly as the web picker does, because the
 * importer above this line must not be able to tell the difference.
 *
 * The content URI never crosses this boundary. The native side reads the bytes
 * and hands back a name — so no view parses a platform URI, and the shared
 * importer never learns that Android content providers exist.
 */
export const nativeFilePicker: FilePicker = {
  // The operating system's document UI is the interface; a view that also drew
  // an `<input type="file">` would be offering a second, worse one that saves
  // into the sandbox.
  presentsOwnUI: true,

  async pick(options: PickOptions = {}): Promise<PickedFile | null> {
    const result = await JourneyDocuments.pickDocument({
      mimeTypes: options.accept?.length ? options.accept : undefined,
    });

    if (result.cancelled || !result.base64) return null;
    return { name: result.name ?? 'archive.zip', bytes: fromBase64(result.base64) };
  },
};

/**
 * Printing, not yet implemented natively.
 *
 * Deliberately a no-op rather than a lie: `window.print()` inside a webview
 * produces nothing on either platform, and a button that silently does nothing
 * is worse than one that is honestly absent. Native printing needs the platform
 * print service driven from the same shared book HTML, which is its own piece
 * of work — see the ADR. Until then the book is still obtainable, because it is
 * inside every archive the reader exports.
 */
export const nativePrinter: Printer = {
  // Said out loud so a view can offer something true instead of a dead button.
  canPrint: false,

  print(): void {
    // Intentionally nothing. See above.
  },
};

/**
 * Warn about unsaved work, within the app only.
 *
 * There is no native equivalent of `beforeunload`, and pretending otherwise
 * would be the dangerous kind of wrong: iOS may terminate a backgrounded app
 * without running any of our code, and Phase 1 measured that `pagehide` and
 * `beforeunload` never fire at all on either platform. So this guards in-app
 * navigation and promises nothing about process death — which is safe, because
 * an acknowledged save has already committed to SQLite before this could matter.
 */
export const nativeUnsavedWorkGuard: UnsavedWorkGuard = {
  protect(): () => void {
    return () => {};
  },
};

/**
 * Sharing through the operating system's own chooser.
 *
 * The bytes go over as base64 and the native side writes them into this app's
 * cache before handing the OS a grant for that one file. Nothing above this
 * line knows where it went, and the application never learns what the person
 * chose — which is the point: a share is between them and whoever they sent it
 * to.
 */
export const nativeSharer: Sharer = {
  canShare: true,

  async share(request: ShareRequest): Promise<{ shared: boolean }> {
    const result = await JourneyDocuments.shareDocument({
      title: request.title,
      text: request.text,
      name: request.file?.filename,
      mimeType: request.file?.mimeType,
      base64: request.file ? toBase64(request.file.bytes) : undefined,
    });
    return { shared: result.shared === true };
  },
};

/**
 * App Lock exists on Android and nowhere else yet.
 *
 * `AppLockPlugin` is Java: a Keystore-backed HMAC verifier, an attempt penalty
 * and device-credential recovery, none of which has an iOS counterpart written.
 * Handing iOS `nativeAppLock` would not give it a lock — it would give it a
 * bridge call to a plugin that is not there, and `supported: true` is what
 * Settings reads to decide whether to offer the section at all. An iPhone would
 * show a PIN control that can set nothing and verify nothing.
 *
 * `webAppLock` is the honest answer on a platform without the native side, and
 * it is the same answer for the same reason: it reports `supported: false`, so
 * the section is hidden rather than broken, and `getState` resolves disabled so
 * the gate opens instead of hanging on a rejected bridge call.
 *
 * This is a gap to be closed by an iOS security lane, not papered over here. A
 * verifier in ordinary storage guarding a journal in ordinary storage would be
 * a gesture rather than a protection, which is precisely what `app-lock.ts`
 * says about the web.
 *
 * Platform identity is read here rather than anywhere above, which is what
 * `src/platform/` is for: the capability genuinely differs, and the views stay
 * unaware.
 */
const appLockForPlatform = () => (nativePlatform() === 'android' ? nativeAppLock : webAppLock);

/** The native platform, assembled. */
export const nativePlatformAdapters: Platform = {
  files: nativeFileSaver,
  picker: nativeFilePicker,
  printer: nativePrinter,
  unsavedWork: nativeUnsavedWorkGuard,
  sharer: nativeSharer,
  appLock: appLockForPlatform(),
};
