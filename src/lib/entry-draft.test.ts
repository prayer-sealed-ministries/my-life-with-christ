import { describe, expect, it } from 'vitest';
import type { EntryDraft } from '../types';
import { draftNeedsPromotion, formsEqualForRecovery, hasRecoverableDraftChanges, promotedDraftMetadata } from './entry-draft';

const draft = (): EntryDraft => ({
  id: 'fictional-helper', createdAt: '2026-10-11T12:00:00.000Z', updatedAt: '2026-10-11T12:00:00.000Z',
  form: {
    kind: 'sermon', date: '2026-10-11', title: '', notes: 'Fictional writing', reflection: '', prayer: '',
    place: '', speaker: '', sermonSeries: '', tagsText: '', links: [], anchors: [],
    forDescendants: false, scriptureRefs: [], sourceMaterial: null,
  },
});

describe('inert draft preservation helpers', () => {
  it('does not turn ordinary or directly representable link data into revision history', () => {
    const original = draft();
    expect(draftNeedsPromotion(original)).toBe(false);
    Object.assign(original.form, { links: [{ url: 'https://example.invalid', label: '', capturedTitle: '', future: 'data' }] });
    expect(draftNeedsPromotion(original)).toBe(false);
    expect(promotedDraftMetadata(undefined, original)).toBeUndefined();
  });

  it('preserves dropped-link extensions and empty opaque-only forms', () => {
    const original = draft();
    Object.assign(original.form, { notes: '', links: [{ url: '', label: '', capturedTitle: '', future: 'data' }] });
    expect(hasRecoverableDraftChanges(original.form, null, original)).toBe(true);
    expect(promotedDraftMetadata(undefined, original)?.journeyPromotedDraft).toEqual(original);
  });

  it('compares opaque nested data without changing known-only source equivalences', () => {
    const first = draft().form;
    const source = { format: 'txt' as const, filename: 'fictional.txt', importedAt: '2026-10-11', body: 'Fictional', parserVersion: 1 };
    first.sourceMaterial = source;
    const second = { ...first, sourceMaterial: { ...source, scripture: [] } };
    expect(formsEqualForRecovery(first, second)).toBe(true);
    Object.assign(second.sourceMaterial, { future: ['verbatim', 'data'] });
    expect(formsEqualForRecovery(first, second)).toBe(false);
  });

  it('keeps occupied keys and literal special properties inert', () => {
    const original = draft();
    original._unmigrated = JSON.parse('{"__proto__":{"fictional":true}}') as Record<string, unknown>;
    const existing = JSON.parse('{"journeyPromotedDraft":"foreign", "journeyPromotedDraft:1":false,"__proto__":{"older":true}}') as Record<string, unknown>;
    const preserved = promotedDraftMetadata(existing, original)!;
    expect(preserved['journeyPromotedDraft:2']).toEqual(original);
    expect(Object.getPrototypeOf(preserved)).toBe(Object.prototype);
    expect(Object.hasOwn(preserved, '__proto__')).toBe(true);
    expect(preserved.__proto__).toEqual({ older: true });
    expect(existing).not.toHaveProperty('journeyPromotedDraft:2');
  });

  it('suppresses exact duplicate data independently of object key order', () => {
    const original = draft();
    original._unmigrated = { future: 'fictional' };
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    expect(promotedDraftMetadata({ journeyPromotedDraft: reordered }, original)).toEqual({ journeyPromotedDraft: reordered });
  });
});
