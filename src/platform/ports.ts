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
 * What is deliberately NOT here: platform identity. This file offers nothing to
 * branch on. A view asks for a capability and receives one; it never asks where
 * it is. Adding a platform flag here would re-open exactly the branching this
 * boundary exists to prevent.
 *
 * Platform identity does exist, confined to `src/platform/` — storage selection
 * must know whether to require Dexie or SQLite, and the Android back binding
 * must know it is on Android. It is kept out of reach of everything else, and
 * no generic `isNative()` is exported for convenience.
 */

/**
 * What became of a save.
 *
 * Deliberately not a path. The caller must not learn WHERE the file went — on
 * the web there is no answer and on native it is the user's business — but it
 * absolutely must learn WHETHER it went, because "you have a backup" is a claim
 * this product is not allowed to make loosely.
 */
export type SaveResult =
  /** The platform confirmed the write completed. */
  | { status: 'saved' }
  /** A legacy browser download began, but the browser cannot confirm a file exists. */
  | { status: 'initiated-unverified' }
  /** The person dismissed the save UI. */
  | { status: 'cancelled' }
  /** The platform could not complete the operation. Content-free by design. */
  | { status: 'failed'; reason: 'unavailable' | 'permission' | 'io' | 'unknown' };

/**
 * Hand bytes to the user's file system.
 *
 * On the web this is a download. On iOS it is a write to a temporary path
 * followed by the document picker, and on Android the Storage Access Framework
 * — both of which end with the file outside our sandbox, which is the point.
 *
 * This used to return `void`, and that was a real defect rather than a
 * simplification. Both native plugins already reported `{ saved: true/false }`
 * and the adapter discarded it, so backing out of the export dialog was
 * recorded as a successful export: the reminder reset and the journal page said
 * "Last exported today" when nothing had left the device. For a product whose
 * whole promise is that the export is the thing you own, that is the one
 * direction an error must never point.
 */
export interface FileSaver {
  save(file: OutgoingFile): Promise<SaveResult>;
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
 * Returns a distinct cancelled outcome when the user dismisses the picker, and
 * a content-free failure reason for operational errors. Either outcome must
 * leave the journal untouched.
 *
 * Reading happens here rather than in the caller because the two platforms
 * differ in what they hand back: a `File` on the web, a URI on native. Callers
 * receive bytes and a name, which is all any of the parsers need.
 */
export interface FilePicker {
  pick(options?: PickOptions): Promise<PickResult>;

  /**
   * Does this picker present its own interface?
   *
   * The one thing a view legitimately needs to know, and it is a property of
   * the CAPABILITY rather than of the platform. The web picker has no interface
   * of its own: the page must render an `<input type="file">`, which is
   * keyboard reachable, label-associated and covered by the accessibility
   * suite, and it stays. A native picker IS an interface — the operating
   * system's document UI — so the page offers a button and gets out of the way.
   *
   * A view reads this to choose which control to render. It still cannot learn
   * which platform it is on, and it must not try: `false` means "you render the
   * control", not "you are in a browser".
   */
  readonly presentsOwnUI?: boolean;
}

export interface PickOptions {
  /**
   * Extensions and media types to suggest, e.g. `['.zip', '.json']`.
   * A hint to the platform's picker, never a guarantee: the importer still
   * validates whatever arrives.
   */
  accept?: string[];
  /** Refuse before crossing the native bridge or allocating a browser buffer. */
  maxBytes?: number;
}

export interface PickedFile {
  /** The user-visible name. Path components are stripped before it is stored. */
  name: string;
  bytes: Uint8Array;
}

export type PickFailureReason = 'permission' | 'io' | 'too-large' | 'unavailable' | 'unknown';

export type PickResult =
  | { status: 'picked'; file: PickedFile }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: PickFailureReason };

/** Content-free wording for an operational picker failure. */
export function pickFailureMessage(reason: PickFailureReason, subject = 'file'): string {
  switch (reason) {
    case 'permission':
      return `Permission to read that ${subject} was denied.`;
    case 'too-large':
      return `That ${subject} is larger than this import supports.`;
    case 'unavailable':
      return 'The device file picker is unavailable.';
    case 'io':
      return `That ${subject} could not be read.`;
    default:
      return `That ${subject} could not be opened.`;
  }
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

  /**
   * Can this platform actually print?
   *
   * A capability, not a platform question. `window.print()` inside a native
   * webview produces nothing at all, and a button that silently does nothing is
   * worse than one that is honestly absent — the reader taps it, waits, and
   * concludes the app is broken. A view reads this to decide whether to offer
   * printing, and says something useful when it cannot.
   */
  readonly canPrint?: boolean;
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

/** Best-effort early notice to flush writing before the runtime is suspended. */
export interface AppLifecycle {
  onBackground(callback: () => void): () => void;
}

/**
 * A file handed to the operating system's share sheet.
 *
 * Bytes, a name and a media type — never a path. The platform layer decides
 * where a file has to sit for the OS to offer it; nothing above this line
 * learns that a filesystem exists.
 */
export interface ShareableFile {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

/** What a share carries. Text, a file, or both — the OS decides what it can use. */
export interface ShareRequest {
  /** Shown as the subject or the message body, depending on where it goes. */
  title: string;
  text?: string;
  file?: ShareableFile;
}

/**
 * Offer one thing to the operating system's share sheet.
 *
 * NOT a network operation and never a publish. This hands bytes to the share
 * UI the person already knows, and the person chooses what happens next —
 * a message, a mail, a file, a printer. Nothing is uploaded, nothing is
 * recorded, and the application never learns where it went.
 *
 * `shared: false` is an ordinary outcome, not an error: somebody who opens the
 * share sheet and changes their mind has done nothing wrong and must see no
 * apology for it.
 */
export interface Sharer {
  /**
   * Can this platform offer a share sheet?
   *
   * A capability, like `Printer.canPrint`, and read for the same reason: a
   * button that silently does nothing teaches a reader the app is broken.
   */
  readonly canShare?: boolean;
  share(request: ShareRequest): Promise<{ shared: boolean }>;
}

import type { AppLock } from './app-lock';

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
  lifecycle: AppLifecycle;
  sharer: Sharer;
  /**
   * Optional App Lock. `supported` is false on editions that cannot enforce
   * it, and Settings hides the section rather than offering a promise the
   * edition cannot keep.
   */
  appLock: AppLock;
}
