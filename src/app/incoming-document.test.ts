/**
 * The one slot, and the policy written on it.
 *
 * Take-once is what makes a redelivered Android intent harmless, and refusing a
 * second share is what stops a preview somebody is reading being swapped for a
 * different document under the same heading.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasIncomingDocument,
  offerIncomingDocument,
  onIncomingDocument,
  releaseIncomingDocument,
  resetIncomingDocuments,
  reviewingIncomingDocument,
  takeIncomingDocument,
} from './incoming-document';
import type { IncomingDocument } from '../import/incoming';

const doc = (name: string): IncomingDocument => ({
  name,
  mimeType: 'text/plain',
  bytes: new TextEncoder().encode(`contents of ${name}`),
});

afterEach(() => resetIncomingDocuments());

describe('one document at a time', () => {
  it('accepts a document and holds it until something takes it', () => {
    expect(hasIncomingDocument()).toBe(false);
    expect(offerIncomingDocument(doc('a.txt'))).toEqual({ accepted: true });
    expect(hasIncomingDocument()).toBe(true);

    const taken = takeIncomingDocument();
    expect(taken?.name).toBe('a.txt');
    expect(hasIncomingDocument()).toBe(false);
  });

  it('hands it over exactly once', () => {
    // The whole answer to Android redelivering an intent: the second read finds
    // an empty slot rather than a second copy of the same handout.
    offerIncomingDocument(doc('a.txt'));
    expect(takeIncomingDocument()?.name).toBe('a.txt');
    expect(takeIncomingDocument()).toBeNull();
    expect(takeIncomingDocument()).toBeNull();
  });

  it('refuses a second share while one is waiting', () => {
    offerIncomingDocument(doc('first.txt'));
    const second = offerIncomingDocument(doc('second.txt'));

    expect(second.accepted).toBe(false);
    expect(second.reason).toMatch(/already reviewing/i);
    // And the first is untouched — nothing was swapped underneath anyone.
    expect(takeIncomingDocument()?.name).toBe('first.txt');
  });

  it('refuses a second share while the first is on screen', () => {
    offerIncomingDocument(doc('first.txt'));
    takeIncomingDocument();
    expect(reviewingIncomingDocument()).toBe(true);

    const second = offerIncomingDocument(doc('second.txt'));
    expect(second.accepted).toBe(false);
    expect(hasIncomingDocument()).toBe(false);
  });

  it('accepts the next one once the review is over', () => {
    offerIncomingDocument(doc('first.txt'));
    takeIncomingDocument();
    releaseIncomingDocument();

    expect(reviewingIncomingDocument()).toBe(false);
    expect(offerIncomingDocument(doc('second.txt'))).toEqual({ accepted: true });
    expect(takeIncomingDocument()?.name).toBe('second.txt');
  });
});

describe('telling the app something arrived', () => {
  it('announces an arrival and a release', () => {
    const heard = vi.fn();
    onIncomingDocument(heard);

    offerIncomingDocument(doc('a.txt'));
    expect(heard).toHaveBeenCalledTimes(1);

    takeIncomingDocument();
    releaseIncomingDocument();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('stops announcing once unsubscribed', () => {
    const heard = vi.fn();
    const off = onIncomingDocument(heard);
    off();
    offerIncomingDocument(doc('a.txt'));
    expect(heard).not.toHaveBeenCalled();
  });

  it('does not announce a refusal — nothing changed', () => {
    offerIncomingDocument(doc('first.txt'));
    const heard = vi.fn();
    onIncomingDocument(heard);
    offerIncomingDocument(doc('second.txt'));
    expect(heard).not.toHaveBeenCalled();
  });
});
