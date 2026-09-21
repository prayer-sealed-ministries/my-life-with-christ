/**
 * The one document the operating system has handed over and nobody has dealt
 * with yet.
 *
 * A one-slot registry, on the same reasoning as `src/app/overlay.ts`: the
 * platform binding runs outside the render tree, the editor lives inside it,
 * and threading a ref between them through context would be more machinery
 * than one module-level variable with a clear owner. The composition root wires
 * the two; neither end imports the other.
 *
 * Not React state, and not the route. A `content://` URI must never become a
 * route — an incoming document is bytes, and bytes have no business in an
 * address bar. The route says only "open a new sermon with the import panel";
 * what to import is here.
 *
 * THE POLICY, which §7 of the lane brief asked to be chosen and written down:
 *
 *   One slot. A document is offered, taken once, and reviewed. While one is
 *   waiting or on screen, a second share is REFUSED with a message rather than
 *   queued or silently swapped.
 *
 * Refused rather than queued because a queue is an inbox, and an inbox needs a
 * list, an order, a way to see it and a way to empty it — none of which anyone
 * asked for. Refused rather than swapped because swapping would replace a
 * preview a person is reading with a different document under the same
 * heading, which is the one outcome that could end with the wrong handout
 * attached to the right sermon.
 */

import type { IncomingDocument } from '../import/incoming';

/** Handed over, not yet picked up by a view. */
let pending: IncomingDocument | null = null;

/** Taken, and currently on screen in the import panel. */
let reviewing = false;

let listeners: Array<() => void> = [];

function announce(): void {
  for (const listener of [...listeners]) listener();
}

export interface OfferResult {
  accepted: boolean;
  /** Present when refused: what to tell the person, in their words. */
  reason?: string;
}

/**
 * Offer a document that has just arrived.
 *
 * Refusing is a normal outcome, not an error: the person is already looking at
 * one, and being told so is better than having it taken away.
 */
export function offerIncomingDocument(document: IncomingDocument): OfferResult {
  if (pending || reviewing) {
    return {
      accepted: false,
      reason:
        'You are already reviewing a document. Finish or cancel that one, then share this again.',
    };
  }
  pending = document;
  announce();
  return { accepted: true };
}

/** Is something waiting to be reviewed? */
export function hasIncomingDocument(): boolean {
  return pending !== null;
}

/**
 * Take it, once.
 *
 * Take-once is what makes a redelivered intent harmless: Android may hand the
 * same share over again across a lifecycle transition, and the second read
 * finds an empty slot rather than a second copy of the same handout.
 */
export function takeIncomingDocument(): IncomingDocument | null {
  const document = pending;
  pending = null;
  if (document) reviewing = true;
  return document;
}

/**
 * The review finished — applied, cancelled, or the view went away.
 *
 * Frees the slot. Nothing about the journal depends on this; it only decides
 * whether the next share is accepted or told to wait.
 */
export function releaseIncomingDocument(): void {
  reviewing = false;
  announce();
}

/** True while a taken document is on screen. */
export function reviewingIncomingDocument(): boolean {
  return reviewing;
}

/** Called when a document arrives or a review ends. Returns an unsubscribe. */
export function onIncomingDocument(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((each) => each !== listener);
  };
}

/** Tests only: put the registry back to how a fresh process finds it. */
export function resetIncomingDocuments(): void {
  pending = null;
  reviewing = false;
  listeners = [];
}
