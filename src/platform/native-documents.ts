/**
 * The native document bridge: four verbs, and deliberately no more.
 *
 * WHY THIS IS IN-REPOSITORY RATHER THAN A DEPENDENCY
 *
 * The product needs exactly these things from the operating system:
 *
 *   saveDocument       — hand the user bytes and let THEM choose where it goes
 *   pickDocument       — let the user choose a file and give us its bytes
 *   takeSharedDocument — collect a document another app sent here
 *   shareDocument      — offer one page of the journal to the share sheet
 *
 * Nothing maintained provides both with the semantics that matter here.
 * `@capacitor/filesystem` writes inside the app sandbox, which is not
 * ownership. `@capacitor/share` offers a share sheet — the right gesture on
 * iOS, but on Android it is "send a copy to an app", not "create a document in
 * a place you chose". `@capawesome/capacitor-file-picker` picks well and does
 * not save at all. The missing piece on Android is
 * `ACTION_CREATE_DOCUMENT` — the Storage Access Framework — and no plugin
 * exposes it.
 *
 * So this is a small bridge over the platforms' own document APIs, kept to the
 * two verbs the product actually uses. It is not a general filesystem utility
 * and must not become one: every method added here is a new way for the
 * application to reach past the user's control of their own files.
 *
 * WHAT IT DOES NOT KNOW
 *
 * Nothing about archives. It moves bytes and a filename. The canonical archive
 * — its manifest, checksums, schema, CSV, Markdown, the book — is built and
 * parsed entirely in shared TypeScript, so there is exactly one implementation
 * of what an archive *is*, and no Swift or Kotlin has an opinion about it.
 */

import { registerPlugin } from '@capacitor/core';

/**
 * The bridge, as the native side implements it.
 *
 * Bytes cross as base64 because a Capacitor bridge marshals JSON; that is the
 * cost of the boundary and the reason the conversion helpers below exist in one
 * place rather than at each call site.
 */
export interface JourneyDocumentsPlugin {
  /**
   * Present the OS "save a document" interface.
   *
   * Resolves `{ saved: false }` when the person backs out, which is an ordinary
   * outcome and never an error.
   */
  saveDocument(options: {
    name: string;
    mimeType: string;
    base64: string;
  }): Promise<{ saved: boolean }>;

  /**
   * Present the OS "open a document" interface.
   *
   * Resolves `{ cancelled: true }` when dismissed. A cancelled pick must leave
   * the journal exactly as it was.
   */
  pickDocument(options: {
    mimeTypes?: string[];
    maxBytes?: number;
  }): Promise<{ cancelled: boolean; name?: string; base64?: string }>;

  /**
   * Collect a document the operating system shared with this app, if any.
   *
   * TAKE-ONCE. The native side clears what it hands over, so asking twice
   * across a lifecycle transition returns `{ present: false }` rather than a
   * second copy of the same handout. Android redelivers intents more readily
   * than one would like, and this is where that is made harmless.
   *
   * The content URI never crosses: it is read natively while the grant is
   * still valid, and what arrives here is a name, a media type and bytes.
   * Nothing in the shared importer should have to know that Android content
   * providers exist, or that a URI can expire.
   */
  takeSharedDocument(): Promise<{
    present: boolean;
    name?: string;
    mimeType?: string;
    base64?: string;
    /** Set when something arrived that could not be read or was too large. */
    error?: string;
  }>;

  /**
   * Offer one document to the system share sheet.
   *
   * The counterpart of `takeSharedDocument`: that one receives what another
   * app sent here, this one sends one page of the journal out. Resolves
   * `{ shared: false }` when the chooser is dismissed, which is an ordinary
   * outcome and never an error.
   *
   * The file is written into this app's own cache and offered through a
   * FileProvider grant that lasts as long as the chooser — never a path, never
   * world-readable, and never anywhere another app can browse. What the person
   * then does with it is between them and whoever they sent it to; nothing
   * comes back.
   */
  shareDocument(options: {
    title: string;
    text?: string;
    name?: string;
    mimeType?: string;
    base64?: string;
  }): Promise<{ shared: boolean }>;
}

export const JourneyDocuments = registerPlugin<JourneyDocumentsPlugin>('JourneyDocuments');

/**
 * Bytes to base64, in chunks.
 *
 * `String.fromCharCode(...bytes)` on a whole archive throws — a multi-megabyte
 * spread overflows the argument limit — and the failure would land on the one
 * person with a long journal, which is precisely the person whose export must
 * not fail.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Base64 back to bytes. */
export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
