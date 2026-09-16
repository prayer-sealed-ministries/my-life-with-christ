/**
 * Detection is the half of import that can be confidently wrong, so it is
 * tested for what it REFUSES as hard as for what it finds. A missed reference
 * costs the user one field during review; an invented one files a false fact
 * into a journal meant to outlive them.
 */

import { describe, expect, it } from 'vitest';

import { examinedAtLeast } from '../testing/floor';
import { detectDate, detectKind, detectReferences, labelRef } from './detect';

const refs = (text: string) => detectReferences(text).map((hit) => hit.label);

describe('detectReferences — the forms people actually write', () => {
  // Every example named in the feature brief, plus the shapes around them.
  const CASES: Array<[string, string]> = [
    ['He preached John 3:16 on Sunday.', 'John 3:16'],
    ['Read John 3:16-18 aloud.', 'John 3:16-18'],
    ['The whole of John 3 really.', 'John 3'],
    ['Romans 8:28 came up again.', 'Romans 8:28'],
    ['We are in Romans 8 this month.', 'Romans 8'],
    ['1 Corinthians 13 at the wedding.', '1 Corinthians 13'],
    ['1 Corinthians 10:31 is the point.', '1 Corinthians 10:31'],
    ['Quoted 1 Cor 10:31 twice.', '1 Corinthians 10:31'],
    ['Psalm 23 at the graveside.', 'Psalms 23'],
    ['Psalms 23:1-6 in full.', 'Psalms 23'],
    ['Gen. 1:1 to begin.', 'Genesis 1:1'],
  ];

  for (const [text, expected] of CASES) {
    it(`finds ${JSON.stringify(expected)} in ${JSON.stringify(text)}`, () => {
      expect(refs(text)).toContain(expected);
    });
  }

  it('reads a cross-chapter range', () => {
    expect(refs('Matthew 5:1-7:29 is the sermon.')).toContain('Matthew 5:1-7:29');
  });

  it('collapses two spellings of one passage into one hit', () => {
    const found = detectReferences('Jn 3:16 — see also John 3:16.');
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe('John 3:16');
  });

  it('keeps the text exactly as it was written', () => {
    expect(detectReferences('Quoted 1 Cor 10:31.')[0].text).toBe('1 Cor 10:31');
  });
});

describe('detectReferences — what it refuses', () => {
  const REFUSED: Array<[string, string]> = [
    ['a word that is not a book', 'Meeting in Room 3:16 tonight.'],
    ['a chapter past the end of the book', 'Look up Jude 12 later.'],
    ['a verse past the end of the chapter', 'Psalm 23:99 is not a verse.'],
    ['a bare book name with no numbers', 'I was reading Mark on the train.'],
    ['a person who shares a name with a book', 'Mark and John came for dinner.'],
    ['a plain time of day', 'The service starts at 10:30 sharp.'],
    ['a bare year', 'Back in 1995 we sang it differently.'],
    ['a descending verse range', 'See John 3:18-16 there.'],
  ];

  for (const [what, text] of REFUSED) {
    it(`does not match ${what}`, () => {
      expect(detectReferences(text), `matched in: ${text}`).toEqual([]);
    });
  }

  /** Floor: a detector that matches nothing at all would pass every test above. */
  it('is actually capable of matching something', () => {
    examinedAtLeast(detectReferences('John 3:16').length, 1, 'references found in a known-good string');
  });
});

describe('detectDate', () => {
  it('reads the four common shapes', () => {
    expect(detectDate('September 14, 2024')?.date).toBe('2024-09-14');
    expect(detectDate('Sep 14 2024')?.date).toBe('2024-09-14');
    expect(detectDate('2024-09-14')?.date).toBe('2024-09-14');
    expect(detectDate('9/14/2024')?.date).toBe('2024-09-14');
  });

  it('reads a day-first slash date when the order cannot be anything else', () => {
    // 14 cannot be a month, so this is unambiguous however it was typed.
    expect(detectDate('14/9/2024')?.date).toBe('2024-09-14');
  });

  it('admits that an ambiguous slash date was a guess', () => {
    // 9/1/2024 is September 1st or 9th January depending on who typed it, and
    // the document does not say. Read, but never presented as certain.
    const found = detectDate('9/1/2024');
    expect(found?.date).toBe('2024-09-01');
    expect(found?.confident).toBe(false);
  });

  it('admits that a month with no day was a guess', () => {
    const found = detectDate('September 2024');
    expect(found?.date).toBe('2024-09-01');
    expect(found?.confident).toBe(false);
  });

  const NOT_DATES = [
    ['a chapter and verse', 'Psalm 119:105'],
    ['a bare number', 'Point 3 of 5'],
    ['a page footer', '12'],
    ['an impossible day', 'February 31, 2024'],
    ['an impossible month', '13/13/2024'],
    ['a year on its own', 'Summer 1995 was hot'],
  ];
  for (const [what, text] of NOT_DATES) {
    it(`does not read ${what} as a date`, () => {
      expect(detectDate(text), `read a date in: ${text}`).toBeNull();
    });
  }
});

describe('detectKind', () => {
  it('maps hints onto the kinds the app already has', () => {
    expect(detectKind('Sunday sermon', 'Pastor preached on grace.').kind).toBe('sermon');
    expect(detectKind('Prayer list', 'Praying for the Millers.').kind).toBe('prayer');
    expect(detectKind('Bible study', 'Study notes on Romans.').kind).toBe('reading');
    expect(detectKind('Morning service', 'Worship and communion.').kind).toBe('service');
  });

  it('falls back to reflection, and says it is not sure', () => {
    const found = detectKind('Thursday', 'Some thoughts I had.');
    expect(found.kind).toBe('reflection');
    expect(found.confident).toBe(false);
  });

  it('does not let a word deep in the body decide the type', () => {
    // "prayer" here is the subject of a long note, not its type.
    const body = `${'The pastor spoke about grace at length. '.repeat(40)}Then we closed in prayer.`;
    expect(detectKind('Notes', body).kind).not.toBe('prayer');
  });
});

describe('labelRef', () => {
  it('writes a whole chapter without verse numbers', () => {
    expect(labelRef({ book: 'romans', chapterStart: 8, verseStart: 1, chapterEnd: 8, verseEnd: 39 })).toBe(
      'Romans 8',
    );
  });
  it('writes a single verse', () => {
    expect(labelRef({ book: 'john', chapterStart: 3, verseStart: 16, chapterEnd: 3, verseEnd: 16 })).toBe(
      'John 3:16',
    );
  });
});
