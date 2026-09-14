import { describe, expect, it } from 'vitest';

import sections from '../../src/data/sections.json';
import outlines from '../../src/data/outlines.json';
import versification from '../../src/data/kjv/versification.json';
import intros from '../../src/data/intros.json';
import { cleanHeading, parseUsfmSections } from '../lib/parse-usfm-sections.mjs';
import { divisionProbes, proseProbes } from '../lib/probes.mjs';
import topicsFile from '../../src/data/topics.json';
import { examinedAtLeast } from '../../src/testing/floor.ts';

const counts = versification;

describe('the sections layer was actually built', () => {
  it('covers all 66 books with a large number of sections', () => {
    expect(sections).toHaveLength(66);
    const total = sections.reduce((n, b) => n + b.entries.length, 0);
    examinedAtLeast(total, 2500, 'BSB sections');
  });

  it('gives every section a title, an id and a real span', () => {
    let checked = 0;
    const problems = [];

    for (const book of sections) {
      const chapters = counts[book.id];
      for (const entry of book.entries) {
        checked += 1;
        if (!entry.title) problems.push(`${entry.id} has no title`);
        if (!entry.id) problems.push(`${entry.ref} has no id`);
        if (entry.chapterStart < 1 || entry.chapterStart > chapters.length) {
          problems.push(`${entry.id}: chapter ${entry.chapterStart} outside ${book.name}`);
        }
        if (entry.verseStart > chapters[entry.chapterStart - 1]) {
          problems.push(`${entry.id}: verse ${entry.verseStart} outside chapter`);
        }
        if (entry.verseEnd > chapters[entry.chapterEnd - 1]) {
          problems.push(`${entry.id}: verse ${entry.verseEnd} outside chapter`);
        }
      }
    }

    examinedAtLeast(checked, 2500, 'sections checked');
    expect(problems.slice(0, 10).join('\n')).toBe('');
  });

  it('has unique ids', () => {
    const ids = sections.flatMap((b) => b.entries.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The property that makes this scheme worth switching to.
  it('partitions the whole canon with no gap and no overlap', () => {
    let totalVerses = 0;
    const problems = [];

    for (const book of sections) {
      const chapters = counts[book.id];
      const offsets = [0];
      for (const c of chapters) offsets.push(offsets[offsets.length - 1] + c);
      totalVerses += offsets[offsets.length - 1];

      const spans = book.entries
        .map((e) => [offsets[e.chapterStart - 1] + e.verseStart, offsets[e.chapterEnd - 1] + e.verseEnd])
        .sort((a, b) => a[0] - b[0]);

      if (spans.length === 0) problems.push(`${book.name}: no sections`);
      else if (spans[0][0] !== 1) problems.push(`${book.name}: does not start at verse 1`);

      for (let i = 1; i < spans.length; i += 1) {
        if (spans[i][0] > spans[i - 1][1] + 1) problems.push(`${book.name}: gap before ordinal ${spans[i][0]}`);
        if (spans[i][0] <= spans[i - 1][1]) problems.push(`${book.name}: overlap at ordinal ${spans[i][0]}`);
      }
      const last = spans[spans.length - 1];
      if (last && last[1] !== offsets[offsets.length - 1]) problems.push(`${book.name}: does not reach the end`);
    }

    expect(totalVerses).toBe(31_102);
    expect(problems.slice(0, 10).join('\n')).toBe('');
  });
});

describe('USFM heading parsing', () => {
  it('strips footnotes, cross-references and character markup', () => {
    expect(cleanHeading('The Genealogy of Jesus')).toBe('The Genealogy of Jesus');
    expect(cleanHeading('A Title\\f + \\fr 1:1 \\ft a note\\f*')).toBe('A Title');
    expect(cleanHeading('See \\ref Luke 3:23|LUK 3:23\\ref* here')).toBe('See Luke 3:23 here');
  });

  it('closes a section at the verse before the next heading', () => {
    const usfm = ['\\c 1', '\\s1 First', '\\v 1 a', '\\v 2 b', '\\s1 Second', '\\v 3 c'].join('\n');
    const { sections: parsed } = parseUsfmSections(usfm, 'jude', [25]);
    expect(parsed).toEqual([
      { book: 'jude', title: 'First', chapterStart: 1, verseStart: 1, chapterEnd: 1, verseEnd: 2 },
      { book: 'jude', title: 'Second', chapterStart: 1, verseStart: 3, chapterEnd: 1, verseEnd: 25 },
    ]);
  });

  it('closes a section at the end of the previous chapter when the next opens one', () => {
    const usfm = ['\\c 1', '\\s1 First', '\\v 1 a', '\\c 2', '\\s1 Second', '\\v 1 b'].join('\n');
    const { sections: parsed } = parseUsfmSections(usfm, 'jonah', [17, 10]);
    expect(parsed[0]).toMatchObject({ chapterStart: 1, verseStart: 1, chapterEnd: 1, verseEnd: 17 });
    expect(parsed[1]).toMatchObject({ chapterStart: 2, verseStart: 1, chapterEnd: 2, verseEnd: 10 });
  });

  it('excludes \\s2 subsections and counts them', () => {
    const usfm = ['\\c 1', '\\s1 Main', '\\v 1 a', '\\s2 Sub', '\\v 2 b'].join('\n');
    const { sections: parsed, subsectionCount } = parseUsfmSections(usfm, 'jude', [25]);
    expect(parsed).toHaveLength(1);
    expect(subsectionCount).toBe(1);
  });
});

describe('book introductions', () => {
  const written = Object.entries(intros).filter(([key]) => !key.startsWith('_'));

  it('has a first pass to judge', () => {
    examinedAtLeast(written.length, 5, 'drafted introductions');
  });

  it('names a real book and says something substantial', () => {
    for (const [bookId, text] of written) {
      expect(counts[bookId], `${bookId} is not a book id`).toBeDefined();
      expect(text.split(/\s+/).length, bookId).toBeGreaterThan(80);
      expect(text.split('\n\n').length, `${bookId} should be more than one paragraph`).toBeGreaterThan(1);
    }
  });

  // The constraint that matters: these must not be the purchased prose.
  it('shares no sentence with a purchased introduction', () => {
    const purchased = new Set();
    for (const book of outlines) {
      for (const sentence of (book.intro ?? '').split(/(?<=[.!?])\s+/)) {
        const trimmed = sentence.trim();
        if (trimmed.length >= 24) purchased.add(trimmed);
      }
    }
    examinedAtLeast(purchased.size, 100, 'purchased intro sentences to compare against');

    const collisions = [];
    for (const [bookId, text] of written) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        const trimmed = sentence.trim();
        if (trimmed.length >= 24 && purchased.has(trimmed)) collisions.push(`${bookId}: ${trimmed}`);
      }
    }
    expect(collisions.join('\n')).toBe('');
  });
});

describe('the gate treats owned content correctly', () => {
  const { topics } = topicsFile;

  it('probes every purchased division when nothing owned is published', () => {
    const all = divisionProbes(outlines, topics, []);
    examinedAtLeast(all.size, 800, 'division probes with no owned scheme');
  });

  it('probes fewer when the BSB sections legitimately ship', () => {
    const all = divisionProbes(outlines, topics, []);
    const unique = divisionProbes(outlines, topics, sections);
    expect(unique.size).toBeLessThan(all.size);
    examinedAtLeast(unique.size, 300, 'purchased-only division probes');
  });

  it('never excludes a division the BSB does not independently make', () => {
    const unique = divisionProbes(outlines, topics, sections);
    const bsb = new Set();
    for (const b of sections) {
      for (const e of b.entries) {
        bsb.add(`${e.book}:${e.chapterStart}:${e.verseStart}:${e.chapterEnd}:${e.verseEnd}`);
      }
    }
    for (const entry of unique.values()) {
      const key = `${entry.book}:${entry.chapterStart}:${entry.verseStart}:${entry.chapterEnd}:${entry.verseEnd}`;
      expect(bsb.has(key), `${entry.id} should have been excluded`).toBe(false);
    }
  });

  it('excludes a purchased title only when the BSB carries it too', () => {
    const all = proseProbes(outlines, []);
    const trimmed = proseProbes(outlines, sections);
    expect(trimmed.size).toBeLessThan(all.size);

    const bsbTitles = sections.flatMap((b) => b.entries.map((e) => e.title));
    for (const probe of trimmed.keys()) {
      expect(
        bsbTitles.some((title) => title.includes(probe)),
        `"${probe}" is in the BSB and should have been excluded`,
      ).toBe(false);
    }
  });
});
