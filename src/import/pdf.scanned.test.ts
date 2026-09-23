/**
 * What a scanned page looks like to the parser.
 *
 * This is the detection half of the sermon-notes importer, and it is what
 * decides whether a reader is told "here are your church's notes" or "this is
 * a photocopy". It is worth characterising on its own, because the decision is
 * made on a threshold and a threshold is the kind of thing that drifts.
 *
 * WHY `emptyPageNumbers` EXISTS WITH NOTHING READING IT YET
 *
 * The extractor used to count pages that yielded nothing; it now records WHICH
 * ones. The count answers "is this a scan?". The numbers answer "which of
 * these pages is a scan?" — a different question, and the one a mixed document
 * asks: a typed outline with a photocopy stapled into the middle has exact
 * text on pages 1 and 3 and an image on page 2.
 *
 * Nothing acts on that yet. Text recognition was investigated in this lane and
 * deferred on package size — the bundled engine added ~11MB of native code per
 * ABI — so there is deliberately no recognition path in this build. What is
 * kept is the four lines that make the extractor's answer truthful rather than
 * lossy, and these tests, which say what a mixed document IS so that a future
 * lane does not have to rediscover it.
 */

import { describe, expect, it } from 'vitest';

import { pdf } from './fixtures';
import { latin1 } from './sermon-notes-fixtures';
import { hasUsableText, parsePdf } from './pdf';

/** `pdf()` takes PDF content-stream operators, not sentences. */
const line = (y: number, text: string) => `BT /F1 12 Tf 60 ${y} Td (${text}) Tj ET`;

const TYPED = pdf([
  [line(740, 'Setting Godly Priorities'), line(720, 'Matthew 6:19-34')],
  [line(740, 'Two: no one can serve two masters.')],
]);

/** A page with no text operators at all — what a scan looks like to a parser. */
const SCANNED = pdf([[]]);

/** Typed, photocopy, typed. */
const MIXED = pdf([[line(740, 'Page one was typed.')], [], [line(740, 'Page three was typed.')]]);

describe('telling a typed handout from a photocopy', () => {
  it('reads a typed PDF and reports no empty pages', async () => {
    const extraction = await parsePdf(latin1(TYPED));

    expect(hasUsableText(extraction)).toBe(true);
    expect(extraction.emptyPageNumbers).toEqual([]);
    expect(extraction.pages.map((page) => page.page)).toEqual([1, 2]);
  }, 20_000);

  it('reads a scan as a page that yielded nothing', async () => {
    const extraction = await parsePdf(latin1(SCANNED));

    // The page was read. There was simply nothing on it to read — which is a
    // different fact from a damaged file, and is reported differently.
    expect(hasUsableText(extraction)).toBe(false);
    expect(extraction.emptyPageNumbers).toEqual([1]);
    expect(extraction.pages).toEqual([]);
  }, 20_000);

  it('names the scanned page of a mixed document, not just how many', async () => {
    const extraction = await parsePdf(latin1(MIXED));

    // The whole point of the numbers: page 2 specifically, and the exact text
    // of 1 and 3 still in hand.
    expect(extraction.emptyPageNumbers).toEqual([2]);
    expect(extraction.pages.map((page) => page.page)).toEqual([1, 3]);
    expect(extraction.pages[0].text).toContain('Page one was typed.');
    expect(extraction.pages[1].text).toContain('Page three was typed.');
  }, 20_000);

  it('still counts what it names', async () => {
    // `emptyPages` is what existing callers read. It must agree with the list,
    // or two parts of the same answer would disagree.
    const extraction = await parsePdf(latin1(MIXED));
    expect(extraction.emptyPages).toBe(extraction.emptyPageNumbers.length);
  }, 20_000);
});
