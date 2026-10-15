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
  /** The destination accepted the complete file, including its final close. */
  | { status: 'committed' }
  /** The person dismissed the destination chooser. */
  | { status: 'cancelled' }
  /** Delivery began, but the platform exposes no completion signal. */
  | { status: 'initiated' };

/**
 * Hand bytes to the user's file system.
 *
 * On the web this is a download. On iOS it is a write to a temporary path
 * followed by the document picker, and on Android the Storage Access Framework
 * — both of which end with the file outside our sandbox, which is the point.
 *
 * A browser anchor can only report `initiated`; it cannot observe cancellation
 * or a completed disk write. Native document APIs and the browser File System
 * Access API can report `committed`. Keeping those states distinct prevents an
 * attempted download from being recorded as a durable backup.
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
 * Returns `null` when the user cancels, which is an ordinary outcome and never
 * an error — a cancelled picker must leave the journal untouched.
 *
 * Reading happens here rather than in the caller because the two platforms
 * differ in what they hand back: a `File` on the web, a URI on native. Callers
 * receive bytes and a name, which is all any of the parsers need.
 */
export interface FilePicker {
  pick(options?: PickOptions): Promise<PickedFile | null>;

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
}

export interface PickedFile {
  /** The user-visible name. Path components are stripped before it is stored. */
  name: string;
  bytes: Uint8Array;
  /**
   * What the provider said the file is, when it said anything.
   *
   * Optional, untrusted, and frequently absent or generic — operating-system
   * file providers routinely return nothing or `application/octet-stream`.
   * Treated as one more signal that must agree when it is specific, and as no
   * evidence at all when it is not. It is never stored in the journal: it is a
   * fact about one pick, not about the material.
   */
  mimeType?: string;
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


// ---------------------------------------------------------------------------
// Scanning paper notes
// ---------------------------------------------------------------------------

/**
 * One line the recogniser read, with where it sat on the page.
 *
 * `box` is normalised 0-1 from the top-left so the two engines agree on a
 * coordinate system; Vision reports bottom-left origin and ML Kit reports
 * pixels, and both are converted at the adapter rather than leaking a platform
 * convention into the review screen.
 */
export interface RecognisedLine {
  text: string;
  box?: { x: number; y: number; width: number; height: number };
  /**
   * Only when the engine genuinely supplies it. Transient, for ordering and
   * diagnostics — never persisted into a journal, because confidence is not
   * truth and a stored number invites treating it as one.
   */
  confidence?: number;
}

/** What the device read off a page. Nothing here has touched the journal. */
export interface Recognition {
  /** Lines joined in reading order. This is what the review screen shows. */
  text: string;
  lines: RecognisedLine[];
  imageWidth: number;
  imageHeight: number;
  /** `AppleVision` or `MLKitTextRecognitionV2`, for diagnostics only. */
  engine: string;
  /** Milliseconds the recognition itself took. */
  elapsedMs: number;
}

/** A page the person captured or chose, held only long enough to review. */
export interface ScannedPage {
  /**
   * The image as a data URL, for display in the review screen.
   *
   * Deliberately not a file path: the review UI must not be able to reach into
   * the file system, and a path is also the thing most likely to end up in a
   * log. The adapter holds the temporary file and deletes it on `discard`.
   */
  preview: string;
  /** Opaque handle the adapter uses to find its own temporary copy. */
  handle: string;
  width: number;
  height: number;
  /**
   * Set when the capture looks too blurred to read. The person is always
   * allowed to proceed anyway — this warns, it does not refuse, and it never
   * comments on anybody's handwriting.
   */
  blurWarning?: boolean;
}

/** Why a scan produced nothing. Each maps to wording a person can act on. */
export type ScanFailure =
  | { reason: 'cancelled' }
  | { reason: 'no-text' }
  | { reason: 'unreadable' }
  | { reason: 'too-large' }
  | { reason: 'permission-denied' }
  | { reason: 'unsupported' }
  | { reason: 'failed' };

/**
 * Reading text off a photograph of a page, on this device.
 *
 * The whole capability is deliberately shaped so that nothing it returns has
 * been written anywhere. It acquires an image, it reads text from it, and it
 * throws its own temporary copy away when told to. Putting approved text into a
 * journal is the editor's job and happens only when a person says so.
 *
 * Recognition is local on every edition that supports it. There is no network
 * path and no cloud fallback: if the device cannot read the page, the answer is
 * that it could not read the page.
 */
/** An image this application rendered, on its way to the recogniser. */
export interface PreparedPage {
  /** Encoded image bytes, base64, with no data: prefix. */
  base64: string;
  width: number;
  height: number;
}

export interface PageScanner {
  /** False on the web, where there is no on-device recogniser to promise. */
  readonly supported: boolean;
  /** Photograph a page. Asks for camera permission only at this moment. */
  capture(): Promise<ScannedPage | ScanFailure>;
  /** Choose an existing photo through the system picker. */
  choose(): Promise<ScannedPage | ScanFailure>;
  /** Read the page. No journal data is written by this call. */
  recognise(page: ScannedPage): Promise<Recognition | ScanFailure>;
  /**
   * Read an image this app produced, rather than one the person photographed.
   *
   * The scanned-PDF path. A page rendered from a PDF has no handle and no file
   * behind it — it is bytes we made a moment ago and will drop a moment later,
   * so there is nothing to store and nothing to clean up afterwards.
   *
   * The same engine as `recognise`, deliberately: one Apple Vision
   * implementation and one ML Kit implementation exist in this product, and a
   * second for PDFs would be two things to keep honest instead of one.
   */
  recognisePrepared(image: PreparedPage): Promise<Recognition | ScanFailure>;
  /**
   * Throw away our temporary copy. Safe to call twice, and it never touches a
   * photo the person chose from their own library.
   */
  discard(page: ScannedPage): Promise<void>;
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
  sharer: Sharer;
  /**
   * Optional App Lock. `supported` is false on editions that cannot enforce
   * it, and Settings hides the section rather than offering a promise the
   * edition cannot keep.
   */
  appLock: AppLock;
  /**
   * Optional paper-note scanning. `supported` is false where there is no
   * on-device recogniser, and the editor hides Scan notes rather than offering
   * something the edition cannot do.
   */
  scanner: PageScanner;
}
