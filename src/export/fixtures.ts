/**
 * Realistic journal fixtures for the export and import tests.
 *
 * Deliberately awkward: a title that is mostly punctuation, an entry with empty
 * optional fields, a dead link, an unresolvable anchor, unicode, and a cross-
 * chapter passage. The export has to survive a real journal, not a tidy one.
 */

import type { Entry } from '../types';

export const SERMON: Entry = {
  id: 'entry-beatitudes',
  kind: 'sermon',
  title: 'The Beatitudes',
  date: '2026-03-15',
  place: 'First Baptist, Tallahassee, FL',
  speaker: 'Pastor James Whitfield',
  sermonSeries: 'Sermon on the Mount',
  anchors: [
    {
      kind: 'scripture',
      book: 'matthew',
      chapterStart: 5,
      verseStart: 1,
      chapterEnd: 5,
      verseEnd: 12,
      outlineEntryId: 'matthew-5-1-12',
    },
    { kind: 'topic', topicId: 'humility' },
  ],
  scriptureRefs: ['Matthew 5:1-12', 'Psalm 37:11'],
  notes: 'He opened by saying the Beatitudes are not entry requirements — they are a\ndescription of what the kingdom does to a person.\n\n- Poor in spirit is not poverty; it is knowing you have nothing to bargain with.\n- "Blessed" is nearer to *congratulations* than to *lucky*.',
  reflection: 'I have been trying to earn something that was already given. The line about\nhaving nothing to bargain with undid me a little.',
  prayer: 'Lord, let me stop negotiating.',
  links: [
    {
      url: 'https://www.youtube.com/watch?v=example',
      label: 'Full service video',
      capturedTitle: 'First Baptist Tallahassee — Sunday Service, March 15 2026',
      capturedAt: '2026-03-15T18:04:00.000Z',
    },
  ],
  tags: ['beatitudes', 'kingdom', 'grace'],
  forDescendants: true,
  visibility: 'private',
  createdAt: '2026-03-15T17:55:00.000Z',
  updatedAt: '2026-03-16T09:12:00.000Z',
};

/** An uncovered passage, anchored with no outline id at all. */
export const READING: Entry = {
  id: 'entry-genesis-35',
  kind: 'reading',
  title: 'Back porch, Genesis 35',
  date: '2026-04-02',
  place: 'back porch',
  anchors: [
    { kind: 'scripture', book: 'genesis', chapterStart: 35, verseStart: 1, chapterEnd: 35, verseEnd: 15 },
  ],
  scriptureRefs: [],
  notes: 'Jacob goes back to Bethel and buries the foreign gods under the oak.',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-04-02T12:00:00.000Z',
  updatedAt: '2026-04-02T12:00:00.000Z',
};

/** Hostile shape: punctuation title, empty everything, cross-chapter anchor. */
export const AWKWARD: Entry = {
  id: 'entry-awkward',
  kind: 'prayer',
  title: '??? — !!!',
  date: '2026-01-01',
  anchors: [
    { kind: 'scripture', book: 'acts', chapterStart: 6, verseStart: 8, chapterEnd: 7, verseEnd: 7 },
    { kind: 'book', book: 'acts' },
  ],
  scriptureRefs: [],
  notes: '',
  reflection: 'Quiet year. “Nothing to report” — and yet.',
  links: [{ url: 'https://dead.example/sermon-404' }],
  tags: ['quiet'],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

/** Two entries that collide on filename: same date, kind and title. */
export const COLLIDER_A: Entry = {
  ...READING,
  id: 'entry-collide-a',
  title: 'Morning',
  date: '2026-05-05',
  createdAt: '2026-05-05T07:00:00.000Z',
  updatedAt: '2026-05-05T07:00:00.000Z',
};

export const COLLIDER_B: Entry = {
  ...READING,
  id: 'entry-collide-b',
  title: 'Morning',
  date: '2026-05-05',
  createdAt: '2026-05-05T08:00:00.000Z',
  updatedAt: '2026-05-05T08:00:00.000Z',
};

export const ALL_ENTRIES: Entry[] = [AWKWARD, SERMON, READING, COLLIDER_A, COLLIDER_B];
