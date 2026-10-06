/**
 * The only thing that matters here is what this does NOT match.
 *
 * A cleanup that deletes one real entry has done more damage than every
 * leftover fixture it was written to remove, so the corpus below deliberately
 * includes titles that sit close to the markers without being them.
 */

import { describe, expect, it } from 'vitest';

import { examinedAtLeast } from '../testing/floor';
import type { Entry, EntryDraft } from '../types';
import { countOf, findSynthetic, isSyntheticTitle } from './synthetic';

const entry = (id: string, title: string): Entry => ({
  id,
  kind: 'sermon',
  title,
  date: '2026-03-01',
  anchors: [],
  scriptureRefs: [],
  notes: '',
  reflection: '',
  prayer: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
});

const draft = (id: string, title: string): EntryDraft =>
  ({ id, form: { title }, updatedAt: '2026-03-01T10:00:00.000Z' }) as unknown as EntryDraft;

describe('recognising throwaway acceptance content', () => {
  it('matches the two markers, wherever they sit in the title', () => {
    expect(isSyntheticTitle('ZZSHARE-TITLE')).toBe(true);
    expect(isSyntheticTitle('zzios-sermon')).toBe(true);
    expect(isSyntheticTitle('a note about ZZSHARE-TITLE')).toBe(true);
  });

  it('leaves real writing alone', () => {
    const real = [
      'Abiding in Christ',
      'Sunday sermon',
      'Share this with Mum',
      'Sharing what I learned',
      'zz top',
      'ios sermon notes',
      'Zzshare',          // wrong case — the markers are exact
      'ZZSHAR',           // one letter short
      'zzios sermon',     // the hyphen is part of the marker
      '',
    ];
    examinedAtLeast(real.length, 8, 'near-miss titles');
    for (const title of real) {
      expect(isSyntheticTitle(title), `"${title}" must not be treated as synthetic`).toBe(false);
    }
  });

  it('picks out exactly the synthetic entries and drafts from a mixed journal', () => {
    const entries = [
      entry('keep-1', 'Abiding in Christ'),
      entry('zap-1', 'ZZSHARE-TITLE'),
      entry('keep-2', 'Sharing the good news'),
      entry('zap-2', 'zzios-sermon'),
    ];
    const drafts = [draft('d-keep', 'Thoughts on Sunday'), draft('d-zap', 'ZZSHARE-TITLE')];

    const finds = findSynthetic(entries, drafts);

    expect(finds.entries.map((item) => item.id)).toEqual(['zap-1', 'zap-2']);
    expect(finds.drafts.map((item) => item.id)).toEqual(['d-zap']);
    expect(countOf(finds)).toBe(3);
  });

  it('finds nothing in a journal that has none', () => {
    const finds = findSynthetic([entry('keep', 'Abiding in Christ')], [draft('d', 'Sunday')]);
    expect(countOf(finds)).toBe(0);
  });
});
