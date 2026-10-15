/**
 * Reading a PDF that is part typed and part photocopied.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE
 *
 * If a page already carries selectable text, use that text. Recognition is
 * lossy and guesses; the embedded text is what the person who made the handout
 * actually wrote. A document whose page 2 was photocopied into the middle of a
 * typed outline must not lose pages 1 and 3 to a guess at page 2.
 *
 * So the decision is per page, never per document:
 *
 *   page 1  typed       -> exact text, recogniser never called
 *   page 2  photocopied -> rendered and recognised on this device
 *   page 3  typed       -> exact text, recogniser never called
 *
 * and the result is those three in that order.
 *
 * WHY THIS MODULE KNOWS NOTHING ABOUT pdf.js
 *
 * It takes a `PdfPageSource` — count, text of a page, picture of a page — and
 * returns what to show a person. That makes every case here drivable in a
 * test: a page that recognises as nothing, a recogniser that resolves out of
 * order, a document over the page ceiling. The pdf.js-backed source is one
 * implementation, and lives beside the parser it belongs to.
 *
 * WHAT IT REFUSES TO DO
 *
 * It never silently drops a page. A page that could not be read is reported as
 * a page that could not be read, by number, and the caller must say what to do
 * about it. Quietly returning the pages that worked would be data loss wearing
 * the clothes of success.
 */

/** A page rendered to an image the recogniser can read. */
export interface PreparedImage {
  /** Encoded image bytes, base64. PNG or JPEG. */
  base64: string;
  width: number;
  height: number;
}

/** Where pages come from. One implementation is pdf.js; tests bring their own. */
export interface PdfPageSource {
  /** How many pages the document has. */
  count: number;
  /** The selectable text of a page, or '' when it carries none. */
  textOf(page: number): Promise<string>;
  /**
   * The page as an image, or null when it cannot be rendered.
   *
   * Only ever called for a page with no selectable text, and only while the
   * budget allows. A source may refuse by returning null — a page too large to
   * render safely is a page we decline to render, not a reason to allocate.
   */
  renderOf(page: number): Promise<PreparedImage | null>;
}

/** Recognise a rendered page. Returns the text, or null when it read nothing. */
export type RecognisePage = (image: PreparedImage, page: number) => Promise<string | null>;

export interface PdfScanLimits {
  /**
   * How many pages may be rendered and recognised.
   *
   * Separate from the text-extraction page ceiling on purpose: reading text
   * from five hundred pages is cheap, and rendering five hundred pages to
   * images and recognising each one is not. A church handout is a few pages;
   * a five-hundred-page scanned book is not something this is for.
   */
  maxOcrPages: number;
}

/** What a page turned out to be. */
export type PdfPageKind = 'text' | 'recognised' | 'unreadable' | 'skipped';

export interface ReadPage {
  page: number;
  kind: PdfPageKind;
  /** Empty for anything but `text` and `recognised`. */
  text: string;
}

export interface PdfReading {
  pages: ReadPage[];
  /** Pages whose own text was used. The recogniser was never called for these. */
  textPages: number[];
  /** Pages that were rendered and recognised. */
  recognisedPages: number[];
  /**
   * Pages that were recognised and still yielded nothing readable.
   *
   * Reported rather than dropped. The caller has to tell the person, by
   * number, and get an answer before anything is written.
   */
  unreadablePages: number[];
  /**
   * Pages past the recognition ceiling, which were never attempted.
   *
   * Distinct from unreadable: nobody tried. Keeping them apart matters because
   * the honest sentence is different — one is "this could not be read", the
   * other is "there are more scanned pages here than can be read at once".
   */
  skippedPages: number[];
}

/**
 * Does this page's own text count as the page?
 *
 * Deliberately generous. A legitimate page may hold nothing but
 * "Discussion Questions" or "John 3:16", and demanding a paragraph would send
 * a perfectly readable page to the recogniser to be guessed at instead.
 *
 * The threshold is therefore about distinguishing text from the handful of
 * stray characters a scanner's own software leaves behind — a page number, a
 * date stamp — not about judging whether a page has enough on it to be worth
 * reading. Anything with real words on it is text.
 */
export function pageHasOwnText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  // A scanner's text layer is typically a page number or a stamp: digits,
  // punctuation and a stray letter. Two runs of letters means words.
  const words = trimmed.match(/[\p{L}]{2,}/gu) ?? [];
  return words.length >= 2;
}

/**
 * Read every page, using its own text where there is any.
 *
 * Sequential on purpose. Rendering a page to an image and recognising it is
 * the expensive part, and doing several at once multiplies the peak memory by
 * exactly the number in flight for no benefit a person would notice on a
 * handout. One page is rendered, recognised, and released before the next.
 */
export async function readPdfPages(
  source: PdfPageSource,
  recognise: RecognisePage | null,
  limits: PdfScanLimits,
): Promise<PdfReading> {
  const pages: ReadPage[] = [];
  const textPages: number[] = [];
  const recognisedPages: number[] = [];
  const unreadablePages: number[] = [];
  const skippedPages: number[] = [];

  /*
    How many pages have been ATTEMPTED, not how many succeeded.

    The ceiling bounds work, and work is spent by trying. Counting successes
    would let a document of unreadable pages render every one of them, which
    is the exhaustion the ceiling exists to prevent reached by failing instead
    of by succeeding.
  */
  let attempted = 0;

  for (let page = 1; page <= source.count; page += 1) {
    const own = await source.textOf(page);

    if (pageHasOwnText(own)) {
      // The recogniser is not called. This is the assertion the mixed-document
      // test makes, and it is the whole point of the feature.
      pages.push({ page, kind: 'text', text: own.trim() });
      textPages.push(page);
      continue;
    }

    if (!recognise) {
      pages.push({ page, kind: 'unreadable', text: '' });
      unreadablePages.push(page);
      continue;
    }

    if (attempted >= limits.maxOcrPages) {
      // Nobody tried, and saying so is different from saying it failed.
      pages.push({ page, kind: 'skipped', text: '' });
      skippedPages.push(page);
      continue;
    }

    attempted += 1;
    const image = await source.renderOf(page);
    if (!image) {
      pages.push({ page, kind: 'unreadable', text: '' });
      unreadablePages.push(page);
      continue;
    }

    const read = await recognise(image, page);
    if (read === null || read.trim().length === 0) {
      pages.push({ page, kind: 'unreadable', text: '' });
      unreadablePages.push(page);
      continue;
    }

    pages.push({ page, kind: 'recognised', text: read.trim() });
    recognisedPages.push(page);
  }

  return { pages, textPages, recognisedPages, unreadablePages, skippedPages };
}

/**
 * The pages, as one body, in the order they appear in the document.
 *
 * Page order is the document's order and nothing else decides it — not when a
 * recognition finished, not how long a page took. Pages that could not be read
 * contribute nothing to the text and are reported separately, so the body is
 * never quietly short of a page nobody mentioned.
 */
export function readingToText(reading: PdfReading): string {
  return reading.pages
    .filter((page) => page.text.length > 0)
    .map((page) => page.text)
    .join('\n\n');
}
