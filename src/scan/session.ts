/**
 * A scanning session: everything that happens between picking up a page and a
 * person saying "use this text".
 *
 * This module is the safety feature. The product rule it enforces is absolute:
 *
 *   NOTHING a scan produces reaches the journal until a person has read it and
 *   said yes.
 *
 * Capturing, choosing, recognising, editing the transcription, switching
 * destination, retaking — every one of those is a change to this session and to
 * nothing else. The session has no access to storage and no way to write an
 * entry; it returns a value that the editor may apply. That is not a convention
 * to be remembered, it is the shape of the code: there is no storage import
 * here to misuse.
 *
 * Two further rules worth stating because they are easy to get wrong:
 *
 *   The destination is never inferred. A photograph cannot tell you who wrote
 *   the page. Someone can photograph their own notebook, a church handout, a
 *   friend's notes, or a printed study guide, and the only reliable way to know
 *   which is to ask.
 *
 *   The text committed is the text the person approved — not the raw
 *   recognition, not a re-run, not a tidied version. Their edits are the point.
 */

import type { Recognition, ScanFailure, ScannedPage } from '../platform/ports';

/** Where approved text may go. Chosen by a person, never guessed. */
export type ScanDestination = 'notes' | 'providedNotes';

/**
 * How approved text meets writing that is already there.
 *
 * `append` is the default everywhere, deliberately. Replacing is possible but
 * must be asked for: losing something a person already wrote is far worse than
 * making them delete a duplicate paragraph.
 */
export type ScanPlacement = 'append' | 'replace';

export type ScanStage =
  | 'idle'
  | 'acquiring'
  | 'recognising'
  | 'reviewing'
  | 'failed';

export interface ScanSession {
  stage: ScanStage;
  /** Increments whenever a new page is acquired. Stale results are discarded. */
  generation: number;
  page?: ScannedPage;
  recognition?: Recognition;
  /** What the person has edited it to. Starts as the recognised text. */
  draftText: string;
  /** Undefined until chosen. The UI must not proceed without a choice. */
  destination?: ScanDestination;
  placement: ScanPlacement;
  failure?: ScanFailure;
}

export const newScanSession = (): ScanSession => ({
  stage: 'idle',
  generation: 0,
  draftText: '',
  placement: 'append',
});

export type ScanEvent =
  | { type: 'acquiring' }
  | { type: 'acquired'; page: ScannedPage; generation: number }
  | { type: 'recognising'; generation: number }
  | { type: 'recognised'; recognition: Recognition; generation: number }
  | { type: 'edited'; text: string }
  | { type: 'destination'; destination: ScanDestination }
  | { type: 'placement'; placement: ScanPlacement }
  | { type: 'failed'; failure: ScanFailure; generation: number }
  | { type: 'cancelled' };

/**
 * Advance the session.
 *
 * Pure, and pure on purpose: every transition here is one a test can drive
 * directly, including the ones that only happen when two things race.
 */
export function reduceScan(session: ScanSession, event: ScanEvent): ScanSession {
  switch (event.type) {
    case 'acquiring':
      // A new acquisition invalidates whatever was in flight. The generation
      // bump is what makes a slow result from the previous page harmless.
      return {
        ...session,
        stage: 'acquiring',
        generation: session.generation + 1,
        page: undefined,
        recognition: undefined,
        draftText: '',
        failure: undefined,
      };

    case 'acquired':
      if (event.generation !== session.generation) return session;
      return { ...session, stage: 'recognising', page: event.page, failure: undefined };

    case 'recognising':
      if (event.generation !== session.generation) return session;
      return { ...session, stage: 'recognising' };

    case 'recognised': {
      /*
       * The guard that matters most here. Choose page A, change your mind,
       * choose page B; A finishes last. Without this check the review screen
       * would show B's photograph above A's text, and a person correcting what
       * they saw would approve the wrong page's words.
       */
      if (event.generation !== session.generation) return session;
      if (session.stage !== 'recognising') return session;
      return {
        ...session,
        stage: 'reviewing',
        recognition: event.recognition,
        draftText: event.recognition.text,
      };
    }

    case 'edited':
      // Editing is only meaningful once there is something to edit.
      if (session.stage !== 'reviewing') return session;
      return { ...session, draftText: event.text };

    case 'destination':
      if (session.stage !== 'reviewing') return session;
      return { ...session, destination: event.destination };

    case 'placement':
      if (session.stage !== 'reviewing') return session;
      return { ...session, placement: event.placement };

    case 'failed':
      if (event.generation !== session.generation) return session;
      return { ...session, stage: 'failed', failure: event.failure, recognition: undefined };

    case 'cancelled':
      // Back to nothing. No page, no recognition, no text, no destination.
      return newScanSession();

    default:
      return session;
  }
}

/**
 * May this session be accepted?
 *
 * Three conditions, each of which is a way the feature could otherwise do
 * something nobody asked for: there must be a review in progress, there must be
 * text, and a person must have chosen where it goes.
 */
export function canAccept(session: ScanSession): boolean {
  return (
    session.stage === 'reviewing' &&
    session.draftText.trim().length > 0 &&
    session.destination !== undefined
  );
}

/** What the editor should do, once a person has said yes. */
export interface ScanAcceptance {
  destination: ScanDestination;
  /** Exactly the approved text. Never the raw recognition. */
  text: string;
  placement: ScanPlacement;
}

/**
 * Turn an approved session into an instruction for the editor.
 *
 * Returns `null` rather than guessing when the session is not ready. A caller
 * that ignores the null and writes anyway is a bug a test will catch; a
 * function that invented a destination would be a bug nobody would see.
 */
export function acceptScan(session: ScanSession): ScanAcceptance | null {
  if (!canAccept(session)) return null;
  return {
    destination: session.destination!,
    text: session.draftText,
    placement: session.placement,
  };
}

/**
 * Apply approved text to a field's existing contents.
 *
 * Append puts a blank line between old and new so two separate sittings do not
 * run together into one paragraph. Replace is exactly what it says, and is only
 * reachable when a person asked for it.
 */
export function applyToField(existing: string, acceptance: ScanAcceptance): string {
  const incoming = acceptance.text.trim();
  if (acceptance.placement === 'replace') return incoming;
  const current = existing.trimEnd();
  if (current.length === 0) return incoming;
  return `${current}\n\n${incoming}`;
}

/**
 * Wording for a scan that produced nothing usable.
 *
 * Kept here, next to the failure type, so a new failure cannot be added without
 * someone deciding what a person should be told. Nothing in this list blames
 * the person or their handwriting.
 */
export function failureMessage(failure: ScanFailure): string {
  switch (failure.reason) {
    case 'no-text':
      return "We couldn't find readable text on this page.";
    case 'unreadable':
      return "This page couldn't be read clearly. Try brighter, even lighting, or take the photo again.";
    case 'too-large':
      return 'That image is too large to read. Try taking a photo of the page instead.';
    case 'permission-denied':
      return 'Scan notes needs camera access to take a photo. You can still choose a photo instead.';
    case 'unsupported':
      return 'Scanning notes is not available on this device.';
    case 'cancelled':
      return '';
    case 'failed':
    default:
      return "We couldn't read this page. Please try again.";
  }
}

/** True when the value is a failure rather than a result. */
export function isScanFailure(value: unknown): value is ScanFailure {
  return typeof value === 'object' && value !== null && 'reason' in value;
}
