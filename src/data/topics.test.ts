import { describe, expect, it } from 'vitest';

import topicsFile from './topics.json';
import versification from './kjv/versification.json';
import outlines from './outlines.json';
import { resolveTopicEntries } from '../lib/passages';
import type { OutlineBook, Topic } from '../types';

const topics = topicsFile.topics as Topic[];
const counts = versification as Record<string, number[]>;
const books = outlines as unknown as OutlineBook[];

/** The 40 topics the brief asked for, in the order it listed them. */
const EXPECTED = [
  'marriage', 'divorce', 'money', 'debt', 'generosity', 'anxiety', 'fear',
  'depression', 'grief', 'death', 'parenting', 'children', 'singleness',
  'friendship', 'forgiveness', 'anger', 'pride', 'humility', 'work', 'calling',
  'rest', 'addiction', 'temptation', 'doubt', 'faith', 'prayer', 'fasting',
  'evangelism', 'church', 'leadership', 'justice', 'poverty', 'healing',
  'suffering', 'persecution', 'end-times', 'salvation', 'grace', 'obedience',
  'thankfulness',
];

describe('topics.json', () => {
  it('has every topic the brief asked for, and no others', () => {
    expect(topics.map((topic) => topic.id)).toEqual(EXPECTED);
  });

  it('gives every topic a name and a description', () => {
    for (const topic of topics) {
      expect(topic.name.length, topic.id).toBeGreaterThan(0);
      expect(topic.description.length, topic.id).toBeGreaterThan(20);
    }
  });

  it('gives every topic several references', () => {
    for (const topic of topics) {
      expect(topic.refs.length, topic.id).toBeGreaterThanOrEqual(5);
    }
  });

  // The refs are the product. A bad verse number here is a dead end for the
  // reader, so every single one is checked against the real KJV versification.
  it('references only verses that exist in the KJV', () => {
    const problems: string[] = [];

    for (const topic of topics) {
      for (const ref of topic.refs) {
        const chapters = counts[ref.book];
        const where = `${topic.id}: ${ref.book} ${ref.chapterStart}:${ref.verseStart}-${ref.chapterEnd}:${ref.verseEnd}`;

        if (!chapters) {
          problems.push(`${where} — unknown book id`);
          continue;
        }
        if (ref.chapterStart < 1 || ref.chapterStart > chapters.length) {
          problems.push(`${where} — chapter ${ref.chapterStart} outside ${ref.book}`);
          continue;
        }
        if (ref.chapterEnd < ref.chapterStart || ref.chapterEnd > chapters.length) {
          problems.push(`${where} — chapter ${ref.chapterEnd} outside ${ref.book}`);
          continue;
        }
        if (ref.verseStart < 1 || ref.verseStart > chapters[ref.chapterStart - 1]) {
          problems.push(`${where} — verse ${ref.verseStart} outside chapter ${ref.chapterStart}`);
        }
        if (ref.verseEnd < 1 || ref.verseEnd > chapters[ref.chapterEnd - 1]) {
          problems.push(`${where} — verse ${ref.verseEnd} outside chapter ${ref.chapterEnd}`);
        }
        if (ref.chapterStart === ref.chapterEnd && ref.verseEnd < ref.verseStart) {
          problems.push(`${where} — verses descend`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it('does not repeat a reference within one topic', () => {
    for (const topic of topics) {
      const keys = topic.refs.map(
        (ref) => `${ref.book}:${ref.chapterStart}:${ref.verseStart}:${ref.chapterEnd}:${ref.verseEnd}`,
      );
      expect(new Set(keys).size, topic.id).toBe(keys.length);
    }
  });
});

describe('topics stand alone', () => {
  // The whole point of the inversion: a topic must be browsable with no
  // outline data loaded at all.
  it('needs no outline data to be usable', () => {
    for (const topic of topics) {
      for (const ref of topic.refs) {
        expect(ref).not.toHaveProperty('outlineEntryId');
        expect(counts[ref.book], `${topic.id} -> ${ref.book}`).toBeDefined();
      }
    }
  });

  it('resolves to outline entries when outlines ARE loaded', () => {
    const byId = new Map(books.map((book) => [book.id, book]));
    const empty: string[] = [];

    for (const topic of topics) {
      if (resolveTopicEntries(topic, byId, counts).length === 0) empty.push(topic.id);
    }

    expect(empty).toEqual([]);
  });

  it('resolves to nothing, without throwing, when outlines are absent', () => {
    for (const topic of topics) {
      expect(resolveTopicEntries(topic, new Map(), counts)).toEqual([]);
    }
  });
});
