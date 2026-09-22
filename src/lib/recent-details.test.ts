/**
 * What gets offered back, and what never does.
 *
 * The ordering rules matter less than the exclusions: a suggestion that came
 * from somewhere other than a saved entry would be the app guessing, and this
 * feature's whole claim is that it does not.
 */

import { describe, expect, it } from 'vitest';

import { DETAIL_FIELDS, SUGGESTION_LIMIT, hasAnyDetail, recentDetails } from './recent-details';
import type { Entry } from '../types';

/** Entries as `listEntries()` hands them over: newest event first. */
const entry = (overrides: Partial<Entry> & { id: string }): Entry => ({
  kind: 'sermon',
  title: '',
  date: '2026-03-01',
  anchors: [],
  scriptureRefs: [],
  notes: '',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  ...overrides,
});

describe('what is offered', () => {
  it('offers what was saved, for each of the three fields', () => {
    const details = recentDetails([
      entry({ id: 'a', place: 'City Gate Church', speaker: 'Pastor John', sermonSeries: 'James' }),
    ]);

    expect(details).toEqual({
      place: ['City Gate Church'],
      speaker: ['Pastor John'],
      sermonSeries: ['James'],
    });
  });

  it('offers nothing at all from an empty journal', () => {
    expect(recentDetails([])).toEqual({ place: [], speaker: [], sermonSeries: [] });
    expect(hasAnyDetail(recentDetails([]))).toBe(false);
  });

  it('ignores a field an entry left blank, and one holding only spaces', () => {
    const details = recentDetails([
      entry({ id: 'a', speaker: '   ', place: '' }),
      entry({ id: 'b', speaker: 'Pastor John' }),
    ]);
    expect(details.speaker).toEqual(['Pastor John']);
    expect(details.place).toEqual([]);
  });
});

describe('order', () => {
  it('is most recent first, in the order the journal was handed over', () => {
    const details = recentDetails([
      entry({ id: 'newest', speaker: 'Rev. Smith' }),
      entry({ id: 'middle', speaker: 'Pastor Michael' }),
      entry({ id: 'oldest', speaker: 'Pastor John' }),
    ]);

    expect(details.speaker).toEqual(['Rev. Smith', 'Pastor Michael', 'Pastor John']);
  });

  it('collapses a repeated value to its most recent use, keeping that position', () => {
    // The series example from the brief: James, James, James, Romans, James.
    const details = recentDetails([
      entry({ id: '5', sermonSeries: 'James' }),
      entry({ id: '4', sermonSeries: 'Romans' }),
      entry({ id: '3', sermonSeries: 'James' }),
      entry({ id: '2', sermonSeries: 'James' }),
      entry({ id: '1', sermonSeries: 'James' }),
    ]);

    expect(details.sermonSeries, 'five Sundays of James must not be five chips').toEqual([
      'James',
      'Romans',
    ]);
  });

  it('counts each field separately, so a gap in one does not shorten another', () => {
    const details = recentDetails([
      entry({ id: 'c', speaker: 'Rev. Smith' }),
      entry({ id: 'b', place: 'City Gate Church' }),
      entry({ id: 'a', speaker: 'Pastor John', place: 'First Baptist' }),
    ]);

    expect(details.speaker).toEqual(['Rev. Smith', 'Pastor John']);
    expect(details.place).toEqual(['City Gate Church', 'First Baptist']);
  });
});

describe('the same value written differently', () => {
  it('treats case and outer whitespace as the same value, and shows the newest spelling', () => {
    const details = recentDetails([
      entry({ id: 'newest', speaker: 'Pastor John' }),
      entry({ id: 'older', speaker: 'pastor john' }),
      entry({ id: 'oldest', speaker: '  Pastor John  ' }),
    ]);

    expect(details.speaker, 'one person, one chip, in the spelling last used').toEqual([
      'Pastor John',
    ]);
  });

  it('trims a stored value before offering it, as a save would', () => {
    expect(recentDetails([entry({ id: 'a', place: '  First Baptist Church ' })]).place).toEqual([
      'First Baptist Church',
    ]);
  });

  it('leaves genuinely different names alone', () => {
    // Timid on purpose: these may be two churches, and this cannot know.
    const details = recentDetails([
      entry({ id: 'b', place: "Saint John's" }),
      entry({ id: 'a', place: "St. John's" }),
    ]);
    expect(details.place).toEqual(["Saint John's", "St. John's"]);
  });
});

describe('how many', () => {
  it('shows only the limit, however long the history is', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      entry({ id: `e${index}`, speaker: `Speaker ${index}` }),
    );

    const details = recentDetails(many);
    expect(details.speaker).toHaveLength(SUGGESTION_LIMIT);
    expect(details.speaker[0], 'the newest is still first').toBe('Speaker 0');
  });

  it('is a small number, not a history dump', () => {
    expect(SUGGESTION_LIMIT).toBeGreaterThanOrEqual(3);
    expect(SUGGESTION_LIMIT).toBeLessThanOrEqual(5);
  });

  it('honours a caller that asks for fewer', () => {
    const details = recentDetails(
      [entry({ id: 'b', place: 'Second' }), entry({ id: 'a', place: 'First' })],
      1,
    );
    expect(details.place).toEqual(['Second']);
  });
});

describe('what it reads', () => {
  it('reads only the entry’s own fields, never provided material', () => {
    // A church handout can state a church and a speaker. Those live on
    // `sourceMaterial` as somebody else's words until the reader puts them in
    // a field themselves, and this must not promote them.
    const details = recentDetails([
      entry({
        id: 'imported',
        sourceMaterial: {
          format: 'sermon-notes-json',
          filename: 'notes.json',
          importedAt: '2026-03-01T10:00:00.000Z',
          body: 'Provided.',
          parserVersion: 1,
          church: 'Handout Church',
          speaker: 'Handout Speaker',
        },
      }),
    ]);

    expect(details, 'provided provenance is not the reader’s own choice').toEqual({
      place: [],
      speaker: [],
      sermonSeries: [],
    });
  });

  it('names the fields the entry names, so a rename cannot go unnoticed', () => {
    // A floor on the audit: these are the canonical stored names, and if one
    // of them ever moves this fails rather than silently offering nothing.
    const sample = entry({ id: 'a', place: 'p', speaker: 's', sermonSeries: 'x' });
    for (const field of DETAIL_FIELDS) {
      expect(sample, `Entry no longer carries ${field}`).toHaveProperty(field);
    }
  });
});
