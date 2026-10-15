/**
 * A photograph that came back while the journal was locked.
 *
 * THE PROBLEM THIS SOLVES
 *
 * On Android, opening the camera or the photo picker backgrounds the app. With
 * App Lock on and its timeout at "Immediately" — the default when somebody
 * first switches App Lock on — the journal locks the moment that happens. The
 * gate does not hide the journal, it unmounts it, which is what makes the lock
 * worth anything. But the scan session lived entirely inside that subtree, so
 * returning from the camera destroyed the photograph the person had just taken
 * and sent them back to an empty editor.
 *
 * WHAT IS NOT THE FIX
 *
 * Staying unlocked while the camera is open. Nobody may exempt the camera, the
 * picker, Vision, ML Kit or this feature from the lock timeout: a person who
 * set "Immediately" asked for the journal to be unreadable the moment the app
 * leaves the screen, and a scan in progress does not change what they asked
 * for. App Lock remains authoritative here and everywhere.
 *
 * WHAT THIS IS
 *
 * One photograph, held outside the React tree so the gate can take the tree
 * down without taking the page with it. It survives the lock; it does not
 * survive the process, and nothing here is written to disk.
 *
 * WHAT IT DELIBERATELY DOES NOT HOLD
 *
 * No recognised text. Recognition does not run while the app is locked, and a
 * result that was already in flight when the lock engaged is dropped rather
 * than kept — on resume the page is read again. So there is never a
 * transcription of somebody's notes sitting behind the lock screen, which is
 * the entire reason this record is the photograph and not the session.
 *
 * It holds no journal content either: no notes, no reflection, no prayer, no
 * title, nothing about who is using the app. Just which page, where it came
 * from, and which editor asked for it.
 */

import type { ScannedPage } from '../platform/ports';

/** Which door the page came through. Both are treated identically. */
export type ScanSource = 'camera' | 'picker';

/**
 * Which editor started the scan.
 *
 * `route` is the address bar, because that is the thing that actually survives
 * a lock: the gate unmounts the router, the hash stays where it was, and the
 * router reads it again when the app comes back. The two ids are what make
 * "the same screen" mean "the same journal record" rather than merely "a
 * screen that looks the same".
 */
export interface ScanOwner {
  /** The saved entry being edited, when there is one. */
  entryId?: string;
  /** The draft record the editor had already written, when there is one. */
  draftId?: string;
  /** The address the editor was open at. */
  route: string;
}

export interface PendingScan {
  page: ScannedPage;
  source: ScanSource;
  owner: ScanOwner;
  /** Wall clock, for expiry only. */
  acquiredAt: number;
}

/**
 * How long an unclaimed photograph may wait.
 *
 * Long enough to type a PIN a few times, find your glasses, or answer the
 * door; short enough that a page somebody photographed and forgot about does
 * not sit in the cache for an afternoon. A forgotten scan is cleaned up on the
 * next editor mount, and the next cold start sweeps the file regardless.
 */
export const PENDING_SCAN_TTL_MS = 10 * 60 * 1000;

/**
 * Is this pending scan for this editor?
 *
 * Pure, and the most important function in the file: getting it wrong means a
 * photograph of one page landing in a different entry than the one it was
 * taken for.
 *
 * A saved entry is identified by its id and nothing else — same id, same
 * record, wherever it is open from. Two different entries never match, and an
 * entry never matches an unsaved draft.
 *
 * Unsaved writing is identified by its draft record where one exists. When the
 * scan began before anything had been autosaved there is no id to compare, and
 * the address is all there is: the same address is the same new-entry screen,
 * and the editor reopens the very draft named here, so the page lands in the
 * record it was taken for rather than one that resembles it.
 */
export function sameScanOwner(a: ScanOwner, b: ScanOwner): boolean {
  if (a.entryId !== undefined || b.entryId !== undefined) return a.entryId === b.entryId;
  // Both are unsaved. A named draft must be the same named draft; an editor
  // that has not written one yet matches only by address.
  if (a.draftId !== undefined && b.draftId !== undefined) return a.draftId === b.draftId;
  return a.route === b.route;
}

/** Has this page waited longer than anybody is coming back for it? */
export function pendingScanIsFresh(pending: PendingScan, now: number): boolean {
  const waited = now - pending.acquiredAt;
  // A clock that went backwards (a timezone change, an NTP correction) must
  // not read as "fresh forever" or as instantly stale.
  return waited >= 0 && waited < PENDING_SCAN_TTL_MS;
}

/*
 * The registry itself.
 *
 * One page, module scope, never serialised. At most one pending acquisition
 * exists at a time: a second scan replaces the first, and the first page's file
 * is handed back so the caller can delete it. There is deliberately no queue —
 * two photographs waiting to be claimed is how one ends up in the wrong entry.
 */
let pending: PendingScan | null = null;

/**
 * Hold a page. Returns whatever it displaced, so the caller can delete it.
 *
 * The caller deletes rather than this module, because deleting is a platform
 * capability and this file is deliberately free of one — it can be read, and
 * reasoned about, without knowing what a scanner is.
 */
export function rememberPendingScan(record: PendingScan): PendingScan | null {
  const displaced = pending;
  pending = record;
  return displaced === record ? null : displaced;
}

/** The page waiting for this editor, if it is this editor's and still fresh. */
export function resumablePendingScan(owner: ScanOwner, now: number): PendingScan | null {
  if (!pending) return null;
  if (!pendingScanIsFresh(pending, now)) return null;
  return sameScanOwner(pending.owner, owner) ? pending : null;
}

/** The page nobody came back for, if it has waited too long. */
export function expiredPendingScan(now: number): PendingScan | null {
  if (!pending) return null;
  return pendingScanIsFresh(pending, now) ? null : pending;
}

/** Let go of whatever is held, and say what it was so its file can be deleted. */
export function forgetPendingScan(): PendingScan | null {
  const held = pending;
  pending = null;
  return held;
}

/** Whatever is held, without claiming it. For tests and for cleanup decisions. */
export function peekPendingScan(): PendingScan | null {
  return pending;
}
