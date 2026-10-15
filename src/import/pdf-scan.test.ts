/**
 * A handout that is part typed and part photocopied.
 *
 * The claim being tested is not "scanned pages can be recognised". It is the
 * narrower and more valuable one: a page that already carries its own text is
 * used verbatim, and the recogniser is never asked about it. Guessing at words
 * somebody actually typed would be a downgrade dressed as a feature.
 *
 * Every page and every line of text here is fictional.
 */
import { describe, expect, it } from 'vitest';

import {
  pageHasOwnText,
  readPdfPages,
  readingToText,
  type PdfPageSource,
  type PreparedImage,
} from './pdf-scan';

const image = (page: number): PreparedImage => ({
  base64: `FICTIONAL-RENDER-${page}`,
  width: 1200,
  height: 1600,
});

/**
 * A document described page by page.
 *
 * `null` means the page carries no selectable text — a photocopy. The source
 * counts what was asked of it, which is how "the recogniser was never called
 * for page 1" becomes a fact rather than an impression.
 */
function source(pages: Array<string | null>, options: { renderFails?: number[] } = {}) {
  const asked = { text: [] as number[], render: [] as number[] };
  const fails = new Set(options.renderFails ?? []);
  const api: PdfPageSource = {
    count: pages.length,
    async textOf(page) {
      asked.text.push(page);
      return pages[page - 1] ?? '';
    },
    async renderOf(page) {
      asked.render.push(page);
      return fails.has(page) ? null : image(page);
    },
  };
  return { api, asked };
}

/** A recogniser that records what it was given. */
function recogniser(answers: Record<number, string | null> = {}) {
  const seen: number[] = [];
  const recognise = async (_image: PreparedImage, page: number) => {
    seen.push(page);
    return page in answers ? answers[page] : `FICTIONAL-SCANNED page ${page}`;
  };
  return { recognise, seen };
}

const LIMITS = { maxOcrPages: 20 };

describe('which pages count as already readable', () => {
  it('accepts a page with real words on it, however few', () => {
    // A legitimate page may hold nothing more than this.
    expect(pageHasOwnText('Discussion Questions')).toBe(true);
    expect(pageHasOwnText('John 3:16')).toBe(false); // one word plus a reference
    expect(pageHasOwnText('Read John 3:16')).toBe(true);
  });

  it('does not mistake a scanner’s own stamp for a page of text', () => {
    // What a scanner leaves in the text layer of an image-only page.
    expect(pageHasOwnText('')).toBe(false);
    expect(pageHasOwnText('   \n  ')).toBe(false);
    expect(pageHasOwnText('3')).toBe(false);
    expect(pageHasOwnText('- 12 -')).toBe(false);
    expect(pageHasOwnText('2026-03-14')).toBe(false);
  });
});

describe('a mixed document', () => {
  it('uses the typed pages as they are, and recognises only the photocopy', async () => {
    const document = source([
      'FICTIONAL-EXACT page one, typed by the person who made this handout.',
      null,
      'FICTIONAL-EXACT page three, also typed.',
    ]);
    const ocr = recogniser();

    const reading = await readPdfPages(document.api, ocr.recognise, LIMITS);

    // The assertion the whole feature rests on: pages 1 and 3 never reached
    // the recogniser, and page 2 is the only one that did.
    expect(ocr.seen).toEqual([2]);
    expect(document.asked.render).toEqual([2]);

    expect(reading.textPages).toEqual([1, 3]);
    expect(reading.recognisedPages).toEqual([2]);
    expect(reading.unreadablePages).toEqual([]);

    expect(readingToText(reading)).toBe(
      [
        'FICTIONAL-EXACT page one, typed by the person who made this handout.',
        'FICTIONAL-SCANNED page 2',
        'FICTIONAL-EXACT page three, also typed.',
      ].join('\n\n'),
    );
  });

  it('keeps document order whatever order recognition finishes in', async () => {
    /*
      Recognition is asynchronous, and a later page can finish first. Page
      order is the document's order and nothing else decides it — a reader
      opening the archive in 2060 should find the handout in the order it was
      printed, not in the order a phone happened to finish reading it.
    */
    const document = source([null, null, null]);
    const settle: Array<() => void> = [];
    const recognise = async (_image: PreparedImage, page: number) => {
      // Page 3 is made to resolve before pages 1 and 2 would have.
      await new Promise<void>((resolve) => {
        settle.push(resolve);
        setTimeout(resolve, page === 3 ? 0 : 1);
      });
      return `FICTIONAL-SCANNED page ${page}`;
    };

    const reading = await readPdfPages(document.api, recognise, LIMITS);
    expect(reading.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(readingToText(reading)).toBe(
      ['FICTIONAL-SCANNED page 1', 'FICTIONAL-SCANNED page 2', 'FICTIONAL-SCANNED page 3'].join('\n\n'),
    );
  });

  it('reads one page at a time rather than all at once', async () => {
    // Peak memory is one rendered page, not every page in the document.
    const document = source([null, null, null, null]);
    let inFlight = 0;
    let most = 0;
    const recognise = async (_image: PreparedImage, page: number) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return `FICTIONAL-SCANNED page ${page}`;
    };

    await readPdfPages(document.api, recognise, LIMITS);
    expect(most).toBe(1);
  });
});

describe('a page that could not be read is never quietly dropped', () => {
  it('reports a page the recogniser made nothing of', async () => {
    const document = source(['FICTIONAL-EXACT page one.', null, 'FICTIONAL-EXACT page three.']);
    const ocr = recogniser({ 2: null });

    const reading = await readPdfPages(document.api, ocr.recognise, LIMITS);

    expect(reading.unreadablePages).toEqual([2]);
    expect(reading.pages[1]).toEqual({ page: 2, kind: 'unreadable', text: '' });
    // The body is short of page 2, and the caller is told exactly that so it
    // can say so rather than present three pages' worth as complete.
    expect(readingToText(reading)).toBe(
      'FICTIONAL-EXACT page one.\n\nFICTIONAL-EXACT page three.',
    );
  });

  it('reports a page that could not even be rendered', async () => {
    const document = source([null, null], { renderFails: [1] });
    const ocr = recogniser();

    const reading = await readPdfPages(document.api, ocr.recognise, LIMITS);
    expect(reading.unreadablePages).toEqual([1]);
    expect(ocr.seen).toEqual([2]);
  });

  it('reports every scanned page when there is no recogniser at all', async () => {
    // The web edition, where there is nothing to recognise with.
    const document = source(['FICTIONAL-EXACT page one.', null]);
    const reading = await readPdfPages(document.api, null, LIMITS);

    expect(reading.recognisedPages).toEqual([]);
    expect(reading.unreadablePages).toEqual([2]);
    expect(reading.textPages).toEqual([1]);
  });
});

describe('there is a ceiling on how much may be recognised', () => {
  it('stops after the limit, and says which pages nobody tried', async () => {
    const document = source([null, null, null, null, null]);
    const ocr = recogniser();

    const reading = await readPdfPages(document.api, ocr.recognise, { maxOcrPages: 2 });

    expect(ocr.seen).toEqual([1, 2]);
    // Rendering stops too: a page past the ceiling is never allocated.
    expect(document.asked.render).toEqual([1, 2]);
    expect(reading.recognisedPages).toEqual([1, 2]);
    // Not "unreadable" — nobody tried, and the honest sentence is different.
    expect(reading.skippedPages).toEqual([3, 4, 5]);
    expect(reading.unreadablePages).toEqual([]);
  });

  it('counts pages it tried, not pages it managed to read', async () => {
    /*
      The ceiling is a resource control, and the resource is spent by trying.

      This was wrong: it counted successes, so a document whose scanned pages
      all failed to render would render every one of them — the exact
      exhaustion the ceiling exists to prevent, reached by failing instead of
      by succeeding. A real parser-level test caught it allocating three
      canvases under a limit of one.
    */
    const document = source([null, null, null, null], { renderFails: [1, 2, 3, 4] });
    const ocr = recogniser();

    const reading = await readPdfPages(document.api, ocr.recognise, { maxOcrPages: 2 });

    expect(document.asked.render).toEqual([1, 2]);
    expect(reading.unreadablePages).toEqual([1, 2]);
    expect(reading.skippedPages).toEqual([3, 4]);
  });

  it('does not count typed pages against the recognition ceiling', async () => {
    // A long handout with one photocopied page in it must still work.
    const pages: Array<string | null> = Array.from({ length: 10 }, (_, i) =>
      i === 4 ? null : `FICTIONAL-EXACT page ${i + 1} of the outline.`,
    );
    const document = source(pages);
    const ocr = recogniser();

    const reading = await readPdfPages(document.api, ocr.recognise, { maxOcrPages: 2 });
    expect(ocr.seen).toEqual([5]);
    expect(reading.skippedPages).toEqual([]);
    expect(reading.textPages).toHaveLength(9);
  });
});
