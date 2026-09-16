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
 * NETWORK: pdfjs will, left alone, fetch standard font files and CMaps from a
 * URL when a document asks for them. That would be a document deciding to make
 * a network request, which this app does not do at all — so the flags below
 * switch every one of those paths off. Nothing is fetched; a document that
 * needs a CMap yields worse text instead, which is the right trade.
 */

import { ImportError, MAX_PDF_PAGES, MAX_TEXT_CHARS } from './limits';

export interface PdfPage {
  /** 1-based. */
  page: number;
  text: string;
}

export interface PdfExtraction {
  pages: PdfPage[];
  /** Pages that yielded nothing readable. */
  emptyPages: number;
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

export async function parsePdf(data: Uint8Array): Promise<PdfExtraction> {
  let getDocument: (typeof import('pdfjs-dist'))['getDocument'];
  try {
    const pdfjs = await import('pdfjs-dist');
    getDocument = pdfjs.getDocument;

    // pdfjs refuses to start without a worker, and left to itself it resolves
    // one from a CDN or a guessed path — a network request made on behalf of a
    // document, which this app does not do.
    //
    // `?url` hands Vite the worker as a build input, so it is emitted beside
    // the rest of the bundle and served from this origin like any other asset.
    // Nothing is fetched from anywhere else, and the import gate that forbids
    // network egress stays true.
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
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
  } catch {
    await loadingTask.destroy().catch(() => undefined);
    throw new ImportError('That PDF could not be opened. It may be damaged or password-protected.');
  }

  const total = document.numPages;
  const limit = Math.min(total, MAX_PDF_PAGES);
  const pages: PdfPage[] = [];
  let characters = 0;
  let emptyPages = 0;

  try {
    for (let number = 1; number <= limit; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = itemsToText(content.items as TextItem[]);
      page.cleanup();

      if (!text) emptyPages += 1;
      else {
        characters += text.length;
        pages.push({ page: number, text });
      }
      if (characters > MAX_TEXT_CHARS) {
        throw new ImportError('That PDF contains more text than can be imported at once.');
      }
    }
  } finally {
    // Destroying the loading task tears down the document and its worker.
    await loadingTask.destroy().catch(() => undefined);
  }

  return { pages, emptyPages, truncated: total > limit };
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
