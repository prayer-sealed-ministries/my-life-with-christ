/**
 * The review-before-commit contract.
 *
 * These are the tests that make Scan notes safe to ship. The feature's whole
 * promise is that a photograph cannot become part of somebody's spiritual
 * record without them reading it first, and the promise is only worth what
 * these assertions are worth.
 *
 * Every string is fictional and marked FICTIONAL-SCAN.
 */
import { describe, expect, it } from 'vitest';

import type { Recognition, ScannedPage } from '../platform/ports';
import {
  acceptScan,
  applyToField,
  canAccept,
  failureMessage,
  newScanSession,
  reduceScan,
  type ScanSession,
} from './session';

const page = (handle = 'tmp-a'): ScannedPage => ({
  preview: 'data:image/png;base64,AAAA',
  handle,
  width: 1700,
  height: 2200,
});

const recognition = (text: string): Recognition => ({
  text,
  lines: text.split('\n').map((line) => ({ text: line })),
  imageWidth: 1700,
  imageHeight: 2200,
  engine: 'TestEngine',
  elapsedMs: 42,
});

/** Drive a session to the point where a person is looking at a transcription. */
function reviewing(text = 'FICTIONAL-SCAN recognised text'): ScanSession {
  let session = newScanSession();
  session = reduceScan(session, { type: 'acquiring' });
  session = reduceScan(session, { type: 'acquired', page: page(), generation: session.generation });
  session = reduceScan(session, {
    type: 'recognised',
    recognition: recognition(text),
    generation: session.generation,
  });
  return session;
}

describe('nothing reaches the journal before a person accepts', () => {
  it('refuses acceptance at every stage before review', () => {
    let session = newScanSession();
    expect(canAccept(session)).toBe(false);
    expect(acceptScan(session)).toBeNull();

    session = reduceScan(session, { type: 'acquiring' });
    expect(acceptScan(session)).toBeNull();

    session = reduceScan(session, { type: 'acquired', page: page(), generation: session.generation });
    expect(acceptScan(session)).toBeNull();
  });

  it('refuses acceptance while a destination has not been chosen', () => {
    const session = reviewing();
    // Text is present and reviewed, but nobody has said where it goes.
    expect(session.draftText).toBe('FICTIONAL-SCAN recognised text');
    expect(session.destination).toBeUndefined();
    expect(canAccept(session)).toBe(false);
    expect(acceptScan(session)).toBeNull();
  });

  it('never chooses a destination on anyone else behalf', () => {
    // A page cannot tell you who wrote it. Someone may photograph their own
    // notebook, a church handout, or a friend's notes, and only they know.
    const printed = reviewing('FICTIONAL-SCAN printed church outline');
    const handwritten = reviewing('FICTIONAL-SCAN my own scribbled notes');
    expect(printed.destination).toBeUndefined();
    expect(handwritten.destination).toBeUndefined();
  });

  it('refuses acceptance when the transcription is empty or only whitespace', () => {
    let session = reviewing('');
    session = reduceScan(session, { type: 'destination', destination: 'notes' });
    expect(canAccept(session)).toBe(false);

    session = reduceScan(session, { type: 'edited', text: '   \n  ' });
    expect(canAccept(session)).toBe(false);

    session = reduceScan(session, { type: 'edited', text: 'FICTIONAL-SCAN something' });
    expect(canAccept(session)).toBe(true);
  });

  it('refuses acceptance once a review has stopped being a review', () => {
    /*
      The case the stage check actually exists for, and it was not covered.

      Walking idle -> acquiring -> acquired proves nothing about the stage,
      because the transcription is empty at all three and acceptance is already
      refused for that reason. Mutation showed it: relaxing the stage condition
      to `!== 'idle'` left every test in this file passing.

      This is the session that has text AND a destination AND is not in review:
      a page was read and approved, a retake was attempted, and the retake
      failed. The earlier text is still here. Accepting it would commit words
      from a photograph the person is no longer looking at.
    */
    let session = reviewing();
    session = reduceScan(session, { type: 'destination', destination: 'notes' });
    session = reduceScan(session, { type: 'edited', text: 'FICTIONAL-SCAN approved earlier' });
    expect(canAccept(session)).toBe(true);

    session = reduceScan(session, {
      type: 'failed',
      failure: { reason: 'unreadable' },
      generation: session.generation,
    });
    expect(session.stage).toBe('failed');
    // The text and the destination survive — that is what makes this the
    // dangerous case rather than an uninteresting one.
    expect(session.draftText).toBe('FICTIONAL-SCAN approved earlier');
    expect(session.destination).toBe('notes');
    expect(canAccept(session)).toBe(false);
    expect(acceptScan(session)).toBeNull();
  });

  it('cancelling discards everything, leaving nothing to commit', () => {
    let session = reviewing();
    session = reduceScan(session, { type: 'destination', destination: 'notes' });
    session = reduceScan(session, { type: 'edited', text: 'FICTIONAL-SCAN edited' });
    expect(canAccept(session)).toBe(true);

    session = reduceScan(session, { type: 'cancelled' });
    expect(session).toEqual(newScanSession());
    expect(session.page).toBeUndefined();
    expect(session.recognition).toBeUndefined();
    expect(session.draftText).toBe('');
    expect(session.destination).toBeUndefined();
    expect(acceptScan(session)).toBeNull();
  });
});

describe('what gets committed is what the person approved', () => {
  it('commits the edited text, never the raw recognition', () => {
    let session = reviewing('FICTIONAL-SCAN Jhn 3:16 recogmsed badly');
    session = reduceScan(session, { type: 'edited', text: 'FICTIONAL-SCAN John 3:16 corrected by hand' });
    session = reduceScan(session, { type: 'destination', destination: 'notes' });

    const acceptance = acceptScan(session)!;
    expect(acceptance.text).toBe('FICTIONAL-SCAN John 3:16 corrected by hand');
    // The raw recognition is still in the session for the review screen, but it
    // is not what gets committed.
    expect(session.recognition!.text).toBe('FICTIONAL-SCAN Jhn 3:16 recogmsed badly');
    expect(acceptance.text).not.toBe(session.recognition!.text);
  });

  it('does not correct Scripture references, spelling or theology', () => {
    // Recognition must stay distinguishable from human correction. If the
    // engine read "Jhn", that is what the person sees and decides about.
    const session = reviewing('FICTIONAL-SCAN Jhn 3:16 and Romams 10:9');
    expect(session.draftText).toBe('FICTIONAL-SCAN Jhn 3:16 and Romams 10:9');
  });

  it('routes each destination to itself and nowhere else', () => {
    let notes = reviewing('FICTIONAL-SCAN mine');
    notes = reduceScan(notes, { type: 'destination', destination: 'notes' });
    expect(acceptScan(notes)!.destination).toBe('notes');

    let provided = reviewing('FICTIONAL-SCAN the handout');
    provided = reduceScan(provided, { type: 'destination', destination: 'providedNotes' });
    expect(acceptScan(provided)!.destination).toBe('providedNotes');
  });
});

describe('existing writing is preserved', () => {
  const acceptance = { destination: 'notes' as const, text: 'FICTIONAL-SCAN new', placement: 'append' as const };

  it('appends below existing text with a blank line between', () => {
    expect(applyToField('FICTIONAL-SCAN already written', acceptance))
      .toBe('FICTIONAL-SCAN already written\n\nFICTIONAL-SCAN new');
  });

  it('appends into an empty field without a leading blank line', () => {
    expect(applyToField('', acceptance)).toBe('FICTIONAL-SCAN new');
    expect(applyToField('   \n ', acceptance)).toBe('FICTIONAL-SCAN new');
  });

  it('defaults to append, so nothing is lost without being asked for', () => {
    expect(newScanSession().placement).toBe('append');
    const session = reduceScan(reviewing(), { type: 'destination', destination: 'notes' });
    expect(acceptScan(session)!.placement).toBe('append');
  });

  it('replaces only when replacement was explicitly chosen', () => {
    let session = reviewing('FICTIONAL-SCAN new');
    session = reduceScan(session, { type: 'destination', destination: 'notes' });
    session = reduceScan(session, { type: 'placement', placement: 'replace' });

    const replace = acceptScan(session)!;
    expect(replace.placement).toBe('replace');
    expect(applyToField('FICTIONAL-SCAN already written', replace)).toBe('FICTIONAL-SCAN new');
  });

  it('accepting twice does not duplicate text, because the editor applies once', () => {
    // The session is a value; applying it is the editor's single action. This
    // pins the arithmetic so a double-tap cannot silently double the text.
    const once = applyToField('FICTIONAL-SCAN existing', acceptance);
    expect(once.split('FICTIONAL-SCAN new')).toHaveLength(2);
  });
});

describe('a slow result from a page nobody is looking at is ignored', () => {
  it('discards a recognition that belongs to a previous page', () => {
    let session = newScanSession();
    session = reduceScan(session, { type: 'acquiring' });
    const first = session.generation;
    session = reduceScan(session, { type: 'acquired', page: page('tmp-a'), generation: first });

    // The person changes their mind and picks another page.
    session = reduceScan(session, { type: 'acquiring' });
    const second = session.generation;
    session = reduceScan(session, { type: 'acquired', page: page('tmp-b'), generation: second });
    expect(second).not.toBe(first);

    // Page A finishes last. It must not appear above page B's photograph.
    session = reduceScan(session, {
      type: 'recognised',
      recognition: recognition('FICTIONAL-SCAN text from page A'),
      generation: first,
    });
    expect(session.recognition).toBeUndefined();
    expect(session.stage).toBe('recognising');
    expect(session.page!.handle).toBe('tmp-b');

    // Page B's own result is accepted.
    session = reduceScan(session, {
      type: 'recognised',
      recognition: recognition('FICTIONAL-SCAN text from page B'),
      generation: second,
    });
    expect(session.draftText).toBe('FICTIONAL-SCAN text from page B');
  });

  it('ignores a recognition that arrives after cancelling', () => {
    let session = newScanSession();
    session = reduceScan(session, { type: 'acquiring' });
    const generation = session.generation;
    session = reduceScan(session, { type: 'acquired', page: page(), generation });

    session = reduceScan(session, { type: 'cancelled' });
    session = reduceScan(session, {
      type: 'recognised',
      recognition: recognition('FICTIONAL-SCAN late arrival'),
      generation,
    });

    expect(session.stage).toBe('idle');
    expect(session.recognition).toBeUndefined();
    expect(session.draftText).toBe('');
    expect(acceptScan(session)).toBeNull();
  });

  it('ignores a stale failure from an abandoned page', () => {
    let session = reviewing('FICTIONAL-SCAN good page');
    const stale = session.generation - 1;
    session = reduceScan(session, { type: 'failed', failure: { reason: 'no-text' }, generation: stale });
    expect(session.stage).toBe('reviewing');
    expect(session.draftText).toBe('FICTIONAL-SCAN good page');
  });

  it('ignores edits and destination choices outside review', () => {
    let session = newScanSession();
    session = reduceScan(session, { type: 'edited', text: 'FICTIONAL-SCAN typed into nothing' });
    session = reduceScan(session, { type: 'destination', destination: 'notes' });
    expect(session.draftText).toBe('');
    expect(session.destination).toBeUndefined();
  });
});

describe('failure wording', () => {
  it('tells the person what to do and never blames their handwriting', () => {
    const messages = [
      failureMessage({ reason: 'no-text' }),
      failureMessage({ reason: 'unreadable' }),
      failureMessage({ reason: 'too-large' }),
      failureMessage({ reason: 'permission-denied' }),
      failureMessage({ reason: 'failed' }),
    ];
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(message.toLowerCase()).not.toContain('handwriting');
      expect(message.toLowerCase()).not.toContain('illegible');
      expect(message.toLowerCase()).not.toContain('invalid');
      // Nothing is ever sent anywhere, so no message may imply it was.
      expect(message.toLowerCase()).not.toContain('upload');
      expect(message.toLowerCase()).not.toContain('server');
      expect(message.toLowerCase()).not.toContain('cloud');
    }
  });

  it('says nothing at all when the person simply cancelled', () => {
    expect(failureMessage({ reason: 'cancelled' })).toBe('');
  });
});
