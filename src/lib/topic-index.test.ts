import { describe, expect, it } from 'vitest';

import { booksWithTopics, topicLinkCount, topicsForBook, topicsForChapter, topicsForSpan } from './topic-index';
import topicsFile from '../data/topics.json';
import versification from '../data/kjv/versification.json';
import { examinedAtLeast } from '../testing/floor';
import type { Topic } from '../types';

const topics = topicsFile.topics as Topic[];
const counts = versification as Record<string, number[]>;

describe('the reverse index was actually built', () => {
  // Every test below is "the right topics came back". All of them pass on an
  // empty index, which is exactly the shape of failure this project already
  // shipped once.
  it('indexes every topic reference', () => {
    const expected = topics.reduce((sum, topic) => sum + topic.refs.length, 0);
    examinedAtLeast(topicLinkCount(), expected, 'indexed topic references');
    expect(topicLinkCount()).toBe(expected);
  });

  it('touches a large part of the canon', () => {
    examinedAtLeast(booksWithTopics().length, 40, 'books touched by some topic');
  });
});

describe('topicsForChapter', () => {
  it('surfaces the topics a reader of Matthew 6 would want', () => {
    // The case from the brief: money, anxiety and prayer were invisible from
    // the text, even though the topics pointed straight at this chapter.
    const names = topicsForChapter('matthew', 6).map((touch) => touch.topic.name);

    examinedAtLeast(names.length, 3, 'topics on Matthew 6');
    expect(names).toContain('Money');
    expect(names).toContain('Anxiety');
    expect(names).toContain('Prayer');
  });

  it('returns the passage each topic actually cites, not the whole chapter', () => {
    const anxiety = topicsForChapter('matthew', 6).find((touch) => touch.topic.id === 'anxiety');
    expect(anxiety?.ref).toMatchObject({ book: 'matthew', chapterStart: 6, verseStart: 25, verseEnd: 34 });
  });

  it('returns nothing for a chapter no topic cites, without throwing', () => {
    expect(topicsForChapter('genesis', 35)).toEqual([]);
  });

  it('returns nothing for a chapter that does not exist', () => {
    expect(topicsForChapter('jude', 9)).toEqual([]);
    expect(topicsForChapter('nonesuch', 1)).toEqual([]);
  });

  it('orders by how much of the passage the topic claims', () => {
    const touches = topicsForChapter('matthew', 6);
    // Prayer covers 6:5-15, eleven verses; Forgiveness covers 6:14-15, two.
    const prayerAt = touches.findIndex((t) => t.topic.id === 'prayer');
    const forgivenessAt = touches.findIndex((t) => t.topic.id === 'forgiveness');
    expect(prayerAt).toBeGreaterThanOrEqual(0);
    expect(prayerAt).toBeLessThan(forgivenessAt);
  });
});

describe('topicsForSpan', () => {
  it('matches a verse range that overlaps a topic passage', () => {
    expect(topicsForSpan('matthew', 6, 25, 6, 34).map((t) => t.topic.id)).toContain('anxiety');
  });

  it('does not match a range that merely abuts one', () => {
    // Anxiety is 6:25-34; 6:19-24 is Money's, and must not pick up Anxiety.
    expect(topicsForSpan('matthew', 6, 19, 6, 24).map((t) => t.topic.id)).not.toContain('anxiety');
  });

  it('lists a topic once even when it cites the same chapter twice', () => {
    const ids = topicsForChapter('matthew', 6).map((t) => t.topic.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('topicsForBook', () => {
  it('counts how many of a topic’s passages land in this book', () => {
    const found = topicsForBook('matthew');
    examinedAtLeast(found.length, 10, 'topics touching Matthew');

    for (const row of found) {
      expect(row.passages, `${row.topic.id} has a zero count`).toBeGreaterThan(0);
      expect(row.firstRef.book).toBe('matthew');
    }
  });

  it('orders by how much of the book each topic touches', () => {
    const found = topicsForBook('matthew').map((row) => row.passages);
    expect(found).toEqual([...found].sort((a, b) => b - a));
  });

  it('returns nothing for a book no topic touches, without throwing', () => {
    expect(topicsForBook('nonesuch')).toEqual([]);
  });
});

describe('the index needs no outline data', () => {
  // The whole point: under refs-only this IS the discovery layer. Nothing here
  // imports the outlines, and these assertions hold regardless of profile.
  it('is built only from topics.json and versification', () => {
    for (const book of booksWithTopics()) {
      expect(counts[book], `${book} is not a real book`).toBeDefined();
    }
  });

  it('every indexed reference resolves inside its book', () => {
    let checked = 0;
    for (const topic of topics) {
      for (const ref of topic.refs) {
        checked += 1;
        const found = topicsForSpan(ref.book, ref.chapterStart, ref.verseStart, ref.chapterEnd, ref.verseEnd);
        expect(
          found.map((t) => t.topic.id),
          `${topic.id} cannot find its own ref ${ref.book} ${ref.chapterStart}:${ref.verseStart}`,
        ).toContain(topic.id);
      }
    }
    examinedAtLeast(checked, 200, 'topic references round-tripped through the index');
  });
});
