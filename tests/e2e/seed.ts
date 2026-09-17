/**
 * Seeding a realistic journal into the running app.
 *
 * Entries are written straight into IndexedDB *after* the app has opened the
 * database, so Dexie owns the schema and this never has to guess at it.
 *
 * The derived index columns (`anchorKeys`, `searchText`) are computed here the
 * same way src/storage/db.ts computes them. They are duplicated rather than
 * imported because this runs inside the page, where the app's modules are not
 * reachable — so if that logic ever changes, this must follow. The anchor
 * lookup depends on the index existing, so an omission would show up as empty
 * "entries for this passage" lists rather than an error.
 */

import type { Page } from '@playwright/test';
import type { Entry, Settings } from '../../src/types';

const iso = (date: string) => `${date}T12:00:00.000Z`;

/** Fifteen entries, spread across books, topics, speakers, places and years. */
export const SEED_ENTRIES: Entry[] = [
  {
    id: 'seed-01', kind: 'sermon', title: 'The Beatitudes', date: '2024-01-07',
    place: 'First Baptist, Tallahassee, FL', speaker: 'Pastor James Whitfield',
    sermonSeries: 'Sermon on the Mount',
    anchors: [
      { kind: 'scripture', book: 'matthew', chapterStart: 5, verseStart: 1, chapterEnd: 5, verseEnd: 12, outlineEntryId: 'matthew-5-1-12' },
      { kind: 'topic', topicId: 'humility' },
    ],
    scriptureRefs: ['Matthew 5:1-12'],
    notes: 'He opened by saying the Beatitudes are not entry requirements — they are a description of what the kingdom does to a person.\n\n- Poor in spirit is not poverty; it is knowing you have nothing to bargain with.\n- "Blessed" is nearer to *congratulations* than to *lucky*.',
    reflection: 'I have been trying to earn something that was already given. The line about having nothing to bargain with undid me a little.',
    prayer: 'Lord, let me stop negotiating.',
    links: [{ url: 'https://example.org/sermon-1', label: 'Full service video', capturedTitle: 'First Baptist Tallahassee — Sunday Service', capturedAt: iso('2024-01-07') }],
    tags: ['beatitudes', 'kingdom', 'grace'], forDescendants: true, visibility: 'private',
    createdAt: iso('2024-01-07'), updatedAt: iso('2024-01-08'),
  },
  {
    id: 'seed-02', kind: 'reading', title: 'Back porch, Genesis 35', date: '2024-02-14',
    place: 'back porch',
    anchors: [{ kind: 'scripture', book: 'genesis', chapterStart: 35, verseStart: 1, chapterEnd: 35, verseEnd: 15 }],
    scriptureRefs: [],
    notes: 'Jacob goes back to Bethel and buries the foreign gods under the oak. He had been carrying them for years without noticing.',
    reflection: 'What am I still carrying that I stopped noticing?',
    links: [], tags: ['bethel'], forDescendants: false, visibility: 'private',
    createdAt: iso('2024-02-14'), updatedAt: iso('2024-02-14'),
  },
  {
    id: 'seed-03', kind: 'sermon', title: 'The Prodigal Son', date: '2024-03-10',
    place: 'Grace Chapel, Thomasville, GA', speaker: 'Rev. Dana Okonkwo',
    anchors: [
      { kind: 'scripture', book: 'luke', chapterStart: 15, verseStart: 11, chapterEnd: 15, verseEnd: 32 },
      { kind: 'topic', topicId: 'forgiveness' },
    ],
    scriptureRefs: ['Luke 15:11-32'],
    notes: 'The father runs. In that culture an old man did not run — he gathered his robes and ran anyway, to reach the son before the village did.',
    reflection: 'I have been the older brother more often than I would like to admit.',
    links: [], tags: ['parable', 'father'], forDescendants: true, visibility: 'private',
    createdAt: iso('2024-03-10'), updatedAt: iso('2024-03-10'),
  },
  {
    id: 'seed-04', kind: 'prayer', title: 'For Mum', date: '2024-04-02',
    anchors: [{ kind: 'topic', topicId: 'healing' }],
    scriptureRefs: ['Psalm 23'],
    notes: '', reflection: 'Sat with her most of the afternoon. She slept.',
    prayer: 'Be near her tonight. Let her not be afraid.',
    links: [], tags: ['family'], forDescendants: false, visibility: 'private',
    createdAt: iso('2024-04-02'), updatedAt: iso('2024-04-02'),
  },
  {
    id: 'seed-05', kind: 'sermon', title: 'Do Not Be Anxious', date: '2024-05-19',
    place: 'First Baptist, Tallahassee, FL', speaker: 'Pastor James Whitfield',
    sermonSeries: 'Sermon on the Mount',
    anchors: [
      { kind: 'scripture', book: 'matthew', chapterStart: 6, verseStart: 25, chapterEnd: 6, verseEnd: 34, outlineEntryId: 'matthew-6-25-34' },
      { kind: 'topic', topicId: 'anxiety' },
    ],
    scriptureRefs: ['Matthew 6:25-34'],
    notes: 'Consider the lilies. Not an argument against planning — an argument against dread.',
    reflection: 'Read this on a week I badly needed it.',
    links: [], tags: ['anxiety', 'trust'], forDescendants: false, visibility: 'private',
    createdAt: iso('2024-05-19'), updatedAt: iso('2024-05-19'),
  },
  {
    id: 'seed-06', kind: 'service', title: 'Easter morning', date: '2024-03-31',
    place: 'First Baptist, Tallahassee, FL', speaker: 'Pastor James Whitfield',
    anchors: [{ kind: 'scripture', book: 'john', chapterStart: 20, verseStart: 1, chapterEnd: 20, verseEnd: 18 }],
    scriptureRefs: ['John 20:1-18'],
    notes: 'Full church. The children did the reading.',
    reflection: 'Mary does not recognise him until he says her name. That detail gets me every year.',
    links: [], tags: ['easter'], forDescendants: true, visibility: 'private',
    createdAt: iso('2024-03-31'), updatedAt: iso('2024-03-31'),
  },
  {
    id: 'seed-07', kind: 'reading', title: 'Job, slowly', date: '2024-06-08',
    place: 'kitchen table',
    anchors: [
      { kind: 'scripture', book: 'job', chapterStart: 38, verseStart: 1, chapterEnd: 38, verseEnd: 41 },
      { kind: 'topic', topicId: 'suffering' },
    ],
    scriptureRefs: ['Job 38'],
    notes: 'God answers Job with questions, not answers. Where wast thou when I laid the foundations of the earth.',
    reflection: 'Somehow that is more comforting than an explanation would have been.',
    links: [], tags: ['suffering'], forDescendants: false, visibility: 'private',
    createdAt: iso('2024-06-08'), updatedAt: iso('2024-06-08'),
  },
  {
    id: 'seed-08', kind: 'letter', title: 'To Ellie, on her baptism', date: '2024-07-21',
    anchors: [{ kind: 'scripture', book: 'romans', chapterStart: 6, verseStart: 1, chapterEnd: 6, verseEnd: 11 }],
    scriptureRefs: ['Romans 6:1-11'],
    notes: '',
    reflection: 'Wrote this for her to read when she is older. She will not remember today, but I will.',
    links: [], tags: ['family', 'baptism'], forDescendants: true, visibility: 'private',
    createdAt: iso('2024-07-21'), updatedAt: iso('2024-07-21'),
  },
  {
    id: 'seed-09', kind: 'sermon', title: 'Money and the heart', date: '2024-09-15',
    place: 'Grace Chapel, Thomasville, GA', speaker: 'Rev. Dana Okonkwo',
    anchors: [
      { kind: 'scripture', book: 'matthew', chapterStart: 6, verseStart: 19, chapterEnd: 6, verseEnd: 24 },
      { kind: 'topic', topicId: 'money' },
    ],
    scriptureRefs: ['Matthew 6:19-24'],
    notes: 'Where your treasure is, there will your heart be also. She pointed out the order: the treasure leads, the heart follows.',
    reflection: 'Uncomfortable in the right way.',
    links: [{ url: 'https://example.org/dead-link', capturedTitle: 'Grace Chapel — Money and the Heart (audio)', capturedAt: iso('2024-09-15') }],
    tags: ['money'], forDescendants: false, visibility: 'private',
    createdAt: iso('2024-09-15'), updatedAt: iso('2024-09-15'),
  },
  {
    id: 'seed-10', kind: 'reflection', title: 'A quiet year', date: '2025-01-01',
    anchors: [{ kind: 'book', book: 'ecclesiastes' }],
    scriptureRefs: [], notes: '',
    reflection: 'Nothing much to report. To every thing there is a season — and some seasons are just ordinary.',
    links: [], tags: ['quiet'], forDescendants: false, visibility: 'private',
    createdAt: iso('2025-01-01'), updatedAt: iso('2025-01-01'),
  },
  {
    id: 'seed-11', kind: 'sermon', title: 'The Good Samaritan', date: '2025-02-09',
    place: 'St Andrews, Perth', speaker: 'Rev. Alasdair Bell',
    anchors: [
      { kind: 'scripture', book: 'luke', chapterStart: 10, verseStart: 30, chapterEnd: 10, verseEnd: 37 },
      { kind: 'topic', topicId: 'justice' },
    ],
    scriptureRefs: ['Luke 10:30-37'],
    notes: 'The question was "who is my neighbour" and Jesus answered a different one: who acted like one.',
    reflection: 'Stopped trying to work out who qualifies.',
    links: [], tags: ['parable', 'mercy'], forDescendants: false, visibility: 'private',
    createdAt: iso('2025-02-09'), updatedAt: iso('2025-02-09'),
  },
  {
    id: 'seed-12', kind: 'reading', title: 'Psalm 139 before bed', date: '2025-04-20',
    place: 'back porch',
    anchors: [
      { kind: 'scripture', book: 'psalms', chapterStart: 139, verseStart: 1, chapterEnd: 139, verseEnd: 24 },
      { kind: 'topic', topicId: 'children' },
    ],
    scriptureRefs: ['Psalm 139:13-16'],
    notes: 'Fearfully and wonderfully made.',
    reflection: 'Read it over Ellie while she slept.',
    links: [], tags: ['family'], forDescendants: true, visibility: 'private',
    createdAt: iso('2025-04-20'), updatedAt: iso('2025-04-20'),
  },
  {
    id: 'seed-13', kind: 'sermon', title: 'Fruit of the Spirit', date: '2025-06-15',
    place: 'First Baptist, Tallahassee, FL', speaker: 'Pastor James Whitfield',
    anchors: [{ kind: 'scripture', book: 'galatians', chapterStart: 5, verseStart: 19, chapterEnd: 5, verseEnd: 26 }],
    scriptureRefs: ['Galatians 5:22-23'],
    notes: 'Fruit, singular. Not a menu to pick from.',
    reflection: 'Patience is the one I keep failing.',
    links: [], tags: ['spirit'], forDescendants: false, visibility: 'private',
    createdAt: iso('2025-06-15'), updatedAt: iso('2025-06-15'),
  },
  {
    id: 'seed-14', kind: 'prayer', title: 'Before the move', date: '2025-08-30',
    anchors: [{ kind: 'topic', topicId: 'fear' }],
    scriptureRefs: ['Joshua 1:9'], notes: '',
    reflection: 'Packing boxes. Everything feels provisional.',
    prayer: 'Go before us. We are not brave.',
    links: [], tags: ['change'], forDescendants: false, visibility: 'private',
    createdAt: iso('2025-08-30'), updatedAt: iso('2025-08-30'),
  },
  {
    id: 'seed-15', kind: 'reading', title: 'Revelation 21, finally', date: '2026-01-11',
    place: 'kitchen table',
    anchors: [
      { kind: 'scripture', book: 'revelation', chapterStart: 21, verseStart: 1, chapterEnd: 21, verseEnd: 8 },
      { kind: 'topic', topicId: 'end-times' },
    ],
    scriptureRefs: ['Revelation 21:1-8'],
    notes: 'He shall wipe away all tears from their eyes.',
    reflection: 'Read this the week after the funeral. It is not a metaphor to me now.',
    links: [], tags: ['hope', 'grief'], forDescendants: true, visibility: 'private',
    createdAt: iso('2026-01-11'), updatedAt: iso('2026-01-11'),
  },
];

/** Mirrors anchorKeys() in src/storage/db.ts. */
function anchorKeys(entry: Entry): string[] {
  const keys = new Set<string>();
  for (const anchor of entry.anchors) {
    if (anchor.kind === 'topic') keys.add(`topic:${anchor.topicId}`);
    else if (anchor.kind === 'book') keys.add(`book:${anchor.book}`);
    else {
      keys.add(`book:${anchor.book}`);
      keys.add(`ref:${anchor.book}:${anchor.chapterStart}:${anchor.verseStart}:${anchor.chapterEnd}:${anchor.verseEnd}`);
      if (anchor.outlineEntryId) keys.add(`outline:${anchor.outlineEntryId}`);
    }
  }
  return [...keys];
}

/** Mirrors searchableText() in src/storage/db.ts. */
function searchableText(entry: Entry): string {
  return [
    entry.title, entry.notes, entry.reflection, entry.prayer ?? '', entry.speaker ?? '',
    entry.place ?? '', entry.sermonSeries ?? '', entry.tags.join(' '), entry.scriptureRefs.join(' '),
    ...entry.links.map((link) => `${link.label ?? ''} ${link.capturedTitle ?? ''}`),
  ].join('\n').toLowerCase();
}

/** Suppress the first-visit notice, so it does not cover every screenshot. */
export async function dismissWelcome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('journey:welcomed', '1');
    } catch {
      /* blocked storage is fine here */
    }
  });
}

/** Force a theme before the app boots, so no flash is captured. */
export async function forceTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('journey:theme', value);
    } catch {
      /* ignore */
    }
  }, theme);
}

/**
 * Write the seed entries into the database the app has already opened.
 *
 * Done after load, never before: letting Dexie create the schema means this
 * cannot drift from the app's own version or index definitions.
 */
export async function seedEntries(page: Page, entries: Entry[] = SEED_ENTRIES): Promise<void> {
  const rows = entries.map((entry) => ({
    ...entry,
    anchorKeys: anchorKeys(entry),
    searchText: searchableText(entry),
  }));

  await page.evaluate(async (payload) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('journey');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('entries', 'readwrite');
        const store = tx.objectStore('entries');
        for (const row of payload) store.put(row);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, rows);

  await page.reload();
  await page.waitForLoadState('networkidle');
}

/**
 * Write app settings into the database the app has already opened.
 *
 * Same rule as `seedEntries`: after load, so Dexie owns the schema. The row key
 * matches `SETTINGS_KEY` in src/storage/db.ts — it is duplicated rather than
 * imported because this runs inside the page, where the app's modules are not
 * reachable.
 *
 * This exists so a test can say "your last export was twenty days ago" without
 * waiting twenty days.
 */
export async function seedSettings(page: Page, settings: Settings): Promise<void> {
  await page.evaluate(async (payload) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('journey');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        const existing = store.get('singleton');
        existing.onsuccess = () => {
          store.put({ ...(existing.result ?? {}), key: 'singleton', ...payload });
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, settings);

  await page.reload();
  await page.waitForLoadState('networkidle');
}
