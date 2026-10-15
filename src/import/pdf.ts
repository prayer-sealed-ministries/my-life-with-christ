/**
 * PDF text extraction. Text only — no OCR in this pass.
 *
 * pdfjs-dist was already vendored here as a build-time dependency (the ingest
 * reads the purchased outline PDFs with it), so this promotes a library the
 * project already trusts rather than adding a new one. Apache-2.0.
 *
 * It is loaded through a dynamic import so it lands in its own chunk: a reader
 * who never imports a PDF never downloads a PDF engine.
 *
 * THE LEGACY BUILD, EVERYWHERE, INCLUDING THE APP
 *
 * pdfjs 6 calls `Promise.try`, which arrived in Chrome 128. The Android System
 * WebView on a device nobody has updated is older — the emulator this was
 * found on reports Chrome 124 — and the modern build throws there inside a
 * promise it never surfaces, so a PDF import did not fail: it sat on a loading
 * spinner for ever. A hang is the worst of the outcomes, because it is the one
 * that looks like patience.
 *
 * The legacy build exists for exactly this. It bundles
 * `core-js/modules/es.promise.try.js` into both the main and worker bundles,
 * so the engine brings what it needs rather than the app guessing which
 * runtime it is on.
 *
 * A hand-written `Promise.try` was tried first and is instructive about why
 * this is the right answer instead: patching the main thread left the WORKER
 * — its own global scope, out of reach — still broken, and declining the
 * worker to avoid that broke it differently, because in a browser pdfjs
 * REQUIRES one and refuses with `No "GlobalWorkerOptions.workerSrc"
 * specified`. Three failures, one cause, and a build that already solved it.
 *
 * This also removes a divergence the test host had papered over: vitest
 * aliased `pdfjs-dist` to the legacy build so the suite would run under Node,
 * while the app shipped the modern one. The tests were exercising a different
 * engine from the product. Now both use the same.
 *
 * NETWORK: pdfjs will, left alone, fetch standard font files and CMaps from a
 * URL when a document asks for them. That would be a document deciding to make
 * a network request, which this app does not do at all — so the flags below
 * switch every one of those paths off. Nothing is fetched; a document that
 * needs a CMap yields worse text instead, which is the right trade.
 */

import { ImportError, MAX_PDF_PAGES, MAX_PDF_TOTAL_PIXELS, MAX_TEXT_CHARS } from './limits';
import { renderPdfPage, type CanvasFactory, type RenderablePage } from './pdf-render';
import { pageHasOwnText, type PreparedImage } from './pdf-scan';

/** Said when a document is locked rather than broken. */
export const ENCRYPTED_PDF =
  'This PDF is password-protected and can\u2019t be imported here. Nothing was imported.';

export interface PdfPage {
  /** 1-based. */
  page: number;
  text: string;
  /**
   * Where the words came from.
   *
   * `text` is what the person who made the handout actually typed. `recognised`
   * is this device's reading of a photocopied page, which may be wrong and
   * which the review screen therefore shows differently. The distinction has
   * to survive all the way to the person: presenting a guess beside exact text
   * without saying which is which is the one thing this feature must not do.
   */
  source: 'text' | 'recognised';
}

export interface PdfExtraction {
  pages: PdfPage[];
  /** Pages that yielded nothing readable. */
  emptyPages: number;
  /**
   * WHICH pages yielded nothing readable, 1-based and in order.
   *
   * The count alone answers "is this a scan?"; the numbers answer "which of
   * these pages is a scan?", which is a different question and the one a mixed
   * document asks. A handout whose page 2 was photocopied into the middle of a
   * typed outline has embedded text on pages 1 and 3 and an image on page 2;
   * recognising the whole document would throw away two pages of exact text in
   * order to guess at them.
   */
  emptyPageNumbers: number[];
  /** Pages read by recognition rather than from their own text. */
  recognisedPageNumbers: number[];
  /**
   * Pages with no readable text, which recognition also could not read.
   *
   * Reported, never dropped. A body that is quietly short of a page is data
   * loss wearing the clothes of success.
   */
  unreadablePageNumbers: number[];
  /** Scanned pages past the recognition ceiling. Nobody tried these. */
  skippedPageNumbers: number[];
  truncated: boolean;
}

/**
 * A page's text items, reassembled into lines.
 *
 * pdfjs hands back positioned fragments, not paragraphs — a PDF has no
 * paragraphs, only ink at coordinates. Fragments are grouped by their vertical
 * position so a line reads as a line; anything beyond that (columns, reading
 * order across a complex layout) is not reliably recoverable and is not
 * invented here.
 */
interface TextItem {
  str: string;
  transform: number[];
  hasEOL?: boolean;
}

function itemsToText(items: TextItem[]): string {
  const lines: Array<{ y: number; parts: string[] }> = [];

  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = Math.round((item.transform?.[5] ?? 0) * 10) / 10;
    // Same line if the baseline is within a couple of points.
    const line = lines.find((candidate) => Math.abs(candidate.y - y) < 2.5);
    if (line) line.parts.push(item.str);
    else lines.push({ y, parts: [item.str] });
  }

  // Top of the page first: PDF y grows upward.
  lines.sort((a, b) => b.y - a.y);

  return lines
    .map((line) => line.parts.join('').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * How to read a page that carries no text of its own.
 *
 * Absent means do not try: the web edition has no on-device recogniser, and a
 * scanned page is reported as a page that could not be read rather than
 * quietly skipped.
 */
export interface PdfScanning {
  recognise(image: PreparedImage, page: number): Promise<string | null>;
  maxPages: number;
  canvases?: CanvasFactory;
}

/**
 * Render a page and read it, or say why not.
 *
 * `'over-budget'` and `null` are different answers and are kept apart all the
 * way to the person: one means there are more scanned pages here than can be
 * read at once, the other means this page was tried and could not be read.
 */
async function recognisePage(
  page: RenderablePage,
  number: number,
  scan: PdfScanning,
  budget: { remaining: number },
  overBudget: boolean,
): Promise<string | null | 'over-budget'> {
  if (overBudget) return 'over-budget';
  const image = await renderPdfPage(page, budget, scan.canvases);
  if (!image) return null;
  const text = await scan.recognise(image, number);
  return text && text.trim().length > 0 ? text.trim() : null;
}

export async function parsePdf(data: Uint8Array, scan?: PdfScanning): Promise<PdfExtraction> {
  let getDocument: (typeof import('pdfjs-dist'))['getDocument'];
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    getDocument = pdfjs.getDocument;

    // Left to itself, pdfjs resolves a worker from a CDN or a guessed path — a
    // network request made on behalf of a document, which this app does not do.
    // `?url` hands Vite the worker as a build input instead, so it is emitted
    // beside the rest of the bundle and served from this origin like any other
    // asset. Nothing is fetched from anywhere else.
    //
    // Only where a worker can actually run. A plain Node host — the test
    // runner — has no `Worker` at all, and pointing pdfjs at a worker file it
    // cannot spawn makes it WAIT rather than fall back: four tests that pass
    // on a developer's machine timed out at twenty seconds each on Linux CI,
    // which is how this was found. With no `workerSrc` set, pdfjs runs on the
    // calling thread, which is the right answer for a few-page handout.
    const canSpawnWorker = typeof Worker !== 'undefined';
    if (canSpawnWorker && !pdfjs.GlobalWorkerOptions.workerSrc) {
      const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    }
  } catch {
    throw new ImportError('PDF support could not be loaded on this device.');
  }

  // Every flag here exists to keep a document from reaching the network. None
  // is a performance setting, and none may be removed as one.
  //
  // `standardFontDataUrl`, `cMapUrl`, `iccUrl` and `wasmUrl` are deliberately
  // NOT set: with nowhere to fetch from, pdfjs degrades the glyph mapping
  // rather than issuing a request. The bytes are already in memory, so range
  // and streaming fetches have nothing to fetch either, but they are switched
  // off explicitly rather than left to that assumption.
  let loadingTask;
  try {
    loadingTask = getDocument({
      data,
      useWorkerFetch: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWasm: false,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
      // A damaged page should cost that page, not the whole document.
      stopAtErrors: false,
    });
  } catch {
    throw new ImportError('That PDF could not be opened. It may be damaged or password-protected.');
  }

  let document;
  try {
    document = await loadingTask.promise;
  } catch (cause) {
    await loadingTask.destroy().catch(() => undefined);
    /*
      A password-protected PDF is a different situation from a damaged one, and
      somebody holding a locked handout can act on being told which it is. The
      library signals it by name rather than by type, so the name is what is
      read — and nothing else from the exception reaches the person, because an
      exception can carry a path or a fragment of the document.
    */
    if (cause instanceof Error && cause.name === 'PasswordException') {
      throw new ImportError(ENCRYPTED_PDF);
    }
    throw new ImportError('That PDF could not be opened. It may be damaged or password-protected.');
  }

  const total = document.numPages;
  const limit = Math.min(total, MAX_PDF_PAGES);
  const pages: PdfPage[] = [];
  const emptyPageNumbers: number[] = [];
  const recognisedPageNumbers: number[] = [];
  const unreadablePageNumbers: number[] = [];
  const skippedPageNumbers: number[] = [];
  let characters = 0;
  /*
    How many pages have been ATTEMPTED, not how many succeeded.

    The ceiling is a resource control, and the resource is spent by trying: a
    page that is rendered and then fails to be read has already cost the canvas
    and the render. Counting successes would mean a document of five hundred
    unreadable pages rendering all five hundred of them — the exact exhaustion
    the ceiling exists to prevent, reached by failing rather than succeeding.
  */
  let attempted = 0;
  const budget = { remaining: MAX_PDF_TOTAL_PIXELS };

  try {
    for (let number = 1; number <= limit; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = itemsToText(content.items as TextItem[]);

      if (pageHasOwnText(text)) {
        /*
          The page's own words, used exactly as written.

          Recognition is never called here, and that is the point of the whole
          feature: guessing at words somebody actually typed would be a
          downgrade dressed up as an improvement.
        */
        characters += text.length;
        pages.push({ page: number, text, source: 'text' });
        page.cleanup();
      } else {
        emptyPageNumbers.push(number);
        const overBudget = scan ? attempted >= scan.maxPages : false;
        if (scan && !overBudget) attempted += 1;
        const read = scan
          ? await recognisePage(page as unknown as RenderablePage, number, scan, budget, overBudget)
          : null;
        page.cleanup();

        if (read === 'over-budget') {
          skippedPageNumbers.push(number);
        } else if (read === null) {
          unreadablePageNumbers.push(number);
        } else {
          characters += read.length;
          recognisedPageNumbers.push(number);
          pages.push({ page: number, text: read, source: 'recognised' });
        }
      }

      if (characters > MAX_TEXT_CHARS) {
        throw new ImportError('That PDF contains more text than can be imported at once.');
      }
    }
  } catch (cause) {
    /*
      Opening a document is not the only place the library throws.

      A page that is damaged deeply enough — a broken cross-reference, a
      content stream that will not decode — throws out of getPage or
      getTextContent, and before this those exceptions escaped raw. The
      malformed-document corpus found it: an UnknownErrorException reached the
      caller instead of a sentence, carrying whatever the library had put in
      its message.

      Our own refusals pass through unchanged; anything else becomes the same
      content-free sentence a damaged file always gets.
    */
    if (cause instanceof ImportError) throw cause;
    if (cause instanceof Error && cause.name === 'PasswordException') {
      throw new ImportError(ENCRYPTED_PDF);
    }
    throw new ImportError('That PDF could not be read. It appears to be damaged.');
  } finally {
    // Destroying the loading task tears down the document and its worker.
    await loadingTask.destroy().catch(() => undefined);
  }

  return {
    pages,
    emptyPages: emptyPageNumbers.length,
    emptyPageNumbers,
    recognisedPageNumbers,
    unreadablePageNumbers,
    skippedPageNumbers,
    truncated: total > limit,
  };
}

/**
 * Is there enough text here to be worth offering?
 *
 * A scanned PDF is a stack of images. pdfjs reads it perfectly well and returns
 * almost nothing, which must be reported as "this is scanned" and never as a
 * successful import of an empty note.
 */
export function hasUsableText(extraction: PdfExtraction): boolean {
  const characters = extraction.pages.reduce((sum, page) => sum + page.text.length, 0);
  const read = extraction.pages.length + extraction.emptyPages;
  if (read === 0) return false;
  // A real page of prose is thousands of characters; a page of scanning
  // artefacts is a handful. Twenty per page is generous and still unmistakable.
  return characters >= 20 * read;
}
