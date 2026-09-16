/**
 * The platform boundary.
 *
 * Four small capabilities, not one `PlatformService`. Each exists because a
 * specific line of product code would otherwise have to know whether it was
 * running in a browser tab, an iOS app, or an Android app — and journal
 * behaviour must not fork three ways.
 *
 * The rule these interfaces enforce is narrow and worth stating exactly:
 *
 *   Building a thing is shared. Delivering it to the operating system is not.
 *
 * So `buildArchive()` stays exactly where it is and returns the same bytes on
 * every edition; only the act of handing those bytes to a file system crosses
 * this boundary. The same split applies to printing, to choosing a file, and to
 * warning about unsaved work.
 *
 * What is deliberately NOT here: platform identity. There is no `isIOS`, no
 * `isAndroid`, no `isNative`. A view asks for a capability and receives one;
 * it never asks where it is. Adding a platform flag here would re-open exactly
 * the branching this boundary exists to prevent.
 */

/**
 * Hand bytes to the user's file system.
 *
 * On the web this is a download. On iOS it will be a write to a temporary path
 * followed by the share sheet, and on Android the Storage Access Framework —
 * both of which end with the file outside our sandbox, which is the point.
 *
 * Deliberately returns void rather than a path: the caller must not learn where
 * the file went, because on the web there is no answer and on native the answer
 * is the user's business.
 */
export interface FileSaver {
  save(file: OutgoingFile): Promise<void>;
}

export interface OutgoingFile {
  /** What to call it. The user may override this in a native save dialog. */
  suggestedName: string;
  bytes: Uint8Array;
  /** e.g. `application/zip`. Native pickers use it to filter and to label. */
  mimeType: string;
}

/**
 * Ask the user for a file and read it.
 *
 * Returns `null` when the user cancels, which is an ordinary outcome and never
 * an error — a cancelled picker must leave the journal untouched.
 *
 * Reading happens here rather than in the caller because the two platforms
 * differ in what they hand back: a `File` on the web, a URI on native. Callers
 * receive bytes and a name, which is all any of the parsers need.
 */
export interface FilePicker {
  pick(options?: PickOptions): Promise<PickedFile | null>;
}

export interface PickOptions {
  /**
   * Extensions and media types to suggest, e.g. `['.zip', '.json']`.
   * A hint to the platform's picker, never a guarantee: the importer still
   * validates whatever arrives.
   */
  accept?: string[];
}

export interface PickedFile {
  /** The user-visible name. Path components are stripped before it is stored. */
  name: string;
  bytes: Uint8Array;
}

/**
 * Print what is currently on screen.
 *
 * The printable book is generated as shared HTML; only the act of asking the
 * device to print it is platform work. On the web this is `window.print()`; on
 * native it will be the platform print service, which is a different mechanism
 * with the same meaning.
 */
export interface Printer {
  print(): void;
}

/**
 * Warn before work in progress is lost.
 *
 * This models what the PRODUCT needs, not what the browser offers, and the
 * distinction matters. `beforeunload` protects a tab from being closed. A
 * native app gets no equivalent promise: iOS may terminate a backgrounded app
 * without running anything of ours, so a native implementation of this port can
 * never be a reliable "about to die, save now" hook.
 *
 * Therefore: durable writes must NEVER depend on this firing. It exists to warn
 * a person who is still present and can still choose — nothing more. The web
 * implementation registers `beforeunload`; a native implementation will warn on
 * an in-app navigation away from unsaved work, and will do nothing at all on
 * process death, because nothing is what it can honestly promise.
 *
 * @returns a function that stops the guard.
 */
export interface UnsavedWorkGuard {
  protect(hasUnsavedWork: () => boolean): () => void;
}

/**
 * Everything the application needs from the platform it is running on.
 *
 * Assembled once at startup and passed down through context. A view takes the
 * one capability it needs; nothing takes the whole object in order to branch on
 * it, because there is nothing here to branch on.
 */
export interface Platform {
  files: FileSaver;
  picker: FilePicker;
  printer: Printer;
  unsavedWork: UnsavedWorkGuard;
}
