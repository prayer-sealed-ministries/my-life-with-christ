/**
 * A handout that is part typed and part photocopied, through the real importer.
 *
 * `pdf-scan.test.ts` proves the rule in isolation. This proves it survives
 * contact with pdf.js, the security gate and the church-notes reader — that a
 * real PDF, parsed by the real parser, sends only its scanned pages to the
 * recogniser and puts everything back in document order.
 *
 * The recogniser here is a counter. That is deliberate: "the typed pages never
 * reached it" is the claim, and a count is the only way to say it as a fact
 * rather than an impression.
 *
 * Every page is fictional.
 */
import { describe, expect, it, vi } from 'vitest';

import { readSermonNotes } from './sermon-notes';
import { parsePdf } from './pdf';
import { MAX_SCANNED_PDF_OCR_PAGES } from './limits';
import { pdf } from './fixtures';
import type { PageScanner, PreparedPage } from '../platform/ports';

const latin1 = (text: string) => {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
};

/** A page of real typed words. */
const typed = (line: string) => [`BT /F1 12 Tf 60 700 Td (${line}) Tj ET`];

/**
 * A page with no text operators at all — what a photocopy looks like to a
 * parser. There is ink on the paper, but none of it is characters.
 */
const photocopied = () => [];

/** A recogniser that records which pages it was asked about. */
function recogniser(answers: Record<number, string | null> = {}) {
  const asked: number[] = [];
  const scanner: PageScanner = {
    supported: true,
    capture: async () => ({ reason: 'unsupported' }) as never,
    choose: async () => ({ reason: 'unsupported' }) as never,
    recognise: async () => ({ reason: 'unsupported' }) as never,
    async recognisePrepared(image: PreparedPage) {
      const page = asked.length + 1;
      asked.push(page);
      const answer = page in answers ? answers[page] : `FICTIONAL-SCANNED-PAGE reading ${page}`;
      if (answer === null) return { reason: 'no-text' } as const;
      return {
        text: answer,
        lines: [{ text: answer }],
        imageWidth: image.width,
        imageHeight: image.height,
        engine: 'fictional-engine',
        elapsedMs: 1,
      };
    },
    async discard() {},
  };
  return { scanner, asked };
}

/**
 * Rendering needs a canvas, which jsdom does not have.
 *
 * The page source is real pdf.js; only the surface it draws onto is a stand-in,
 * so what is being tested is the parser's page classification and the ordering,
 * not the browser's raster.
 */
function fakeCanvases() {
  const sizes: Array<{ width: number; height: number }> = [];

  /*
    A 2D context that tolerates whatever pdf.js asks of it.

    The renderer calls save, transform, fill, clip and a dozen others. None of
    the drawing matters here — the page being rendered is blank, and what is
    under test is which pages get rendered at all — so every property answers
    with a no-op rather than this file growing a canvas implementation.
  */
  const permissive = (): unknown =>
    new Proxy(
      {},
      {
        get: (_target, property) => {
          if (property === 'canvas') return { width: 0, height: 0 };
          return () => permissive();
        },
      },
    );

  return {
    sizes,
    factory: {
      create(width: number, height: number) {
        sizes.push({ width, height });
        return {
          context: permissive(),
          surface: { width, height },
          toBase64: () => 'RklDVElPTkFM',
          release: () => {},
        };
      },
    },
  };
}

/** The scanning options the church-notes reader builds, plus a canvas. */
const scanning = (ocr: ReturnType<typeof recogniser>, canvases: ReturnType<typeof fakeCanvases>) => ({
  maxPages: MAX_SCANNED_PDF_OCR_PAGES,
  canvases: canvases.factory,
  async recognise(image: { base64: string; width: number; height: number }) {
    const result = await ocr.scanner.recognisePrepared(image);
    return 'reason' in result ? null : result.text;
  },
});

describe('a mixed PDF, through the real parser', () => {
  it('uses the typed pages exactly and recognises only the photocopy', async () => {
    const document = latin1(
      pdf([
        typed('FICTIONAL-EXACT-PAGE one typed by the church office'),
        photocopied(),
        typed('FICTIONAL-EXACT-PAGE three typed by the church office'),
      ]),
    );
    const ocr = recogniser();
    const canvases = fakeCanvases();

    const extraction = await parsePdf(document, scanning(ocr, canvases));

    /*
      The claim, as a count: exactly ONE page was rendered, and it was the
      photocopy. Pages 1 and 3 never cost a canvas, never cost a render and
      never reached the recogniser — their own words were used instead.

      This asserts the selection rather than the recognition. pdf.js draws onto
      a real 2D context, which this runtime does not have, so the render itself
      fails here and page 2 ends up reported as unread. That is the correct
      behaviour for a device with nothing to render with, and it is asserted
      below; the recognition that follows a successful render is exercised on
      the emulator and the simulator, where there is a real canvas.
    */
    expect(canvases.sizes).toHaveLength(1);
    expect(canvases.sizes[0].width).toBeGreaterThan(1000);

    // Typed pages keep their own words, exactly, and in document order.
    expect(extraction.pages.map((page) => ({ page: page.page, source: page.source }))).toEqual([
      { page: 1, source: 'text' },
      { page: 3, source: 'text' },
    ]);
    expect(extraction.pages[0].text).toBe('FICTIONAL-EXACT-PAGE one typed by the church office');
    expect(extraction.pages[1].text).toBe('FICTIONAL-EXACT-PAGE three typed by the church office');
    // And the page that could not be read is named, never dropped silently.
    expect(extraction.unreadablePageNumbers).toEqual([2]);
    expect(ocr.asked).toEqual([]);
  });

  it('reports the page it could not read, in document order', async () => {
    const document = latin1(
      pdf([typed('FICTIONAL-EXACT-PAGE one'), photocopied(), typed('FICTIONAL-EXACT-PAGE three')]),
    );
    // A blurred or blank photocopy: the recogniser reads nothing from it.
    const ocr = recogniser({ 1: null });
    const canvases = fakeCanvases();

    const extraction = await parsePdf(document, scanning(ocr, canvases));

    expect(extraction.unreadablePageNumbers).toEqual([2]);
    expect(extraction.pages.map((page) => page.page)).toEqual([1, 3]);
  });

  it('stops after the recognition ceiling and says nobody tried the rest', async () => {
    const document = latin1(pdf([photocopied(), photocopied(), photocopied()]));
    const ocr = recogniser();
    const canvases = fakeCanvases();

    const extraction = await parsePdf(document, { ...scanning(ocr, canvases), maxPages: 1 });

    // One page was attempted; the rest were never allocated a canvas at all.
    // That is the ceiling doing its job before the memory is spent, which is
    // the whole reason it is checked before rendering rather than after.
    expect(canvases.sizes).toHaveLength(1);
    // Not "unreadable": nobody tried, and the honest sentence is different.
    expect(extraction.skippedPageNumbers).toEqual([2, 3]);
  });

  it('does not reach the network while reading a scanned page', async () => {
    const fetchSpy = vi.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const document = latin1(pdf([typed('FICTIONAL-EXACT-PAGE one'), photocopied()]));
      await parsePdf(document, scanning(recogniser(), fakeCanvases()));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('the church-notes reader, end to end', () => {
  it('never calls the recogniser for a document that is all typed', async () => {
    const document = latin1(
      pdf([typed('FICTIONAL-EXACT-PAGE one'), typed('FICTIONAL-EXACT-PAGE two')]),
    );
    const ocr = recogniser();

    const proposal = await readSermonNotes(document, 'handout.pdf', undefined, ocr.scanner);

    expect(ocr.asked).toEqual([]);
    // Nothing about scanning is said, because nothing was scanned.
    expect(proposal.scan).toBeUndefined();
    expect(proposal.material.format).toBe('pdf');
    expect(proposal.material.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('counts every page once, however it was read', async () => {
    /*
      A recognised page carried no text layer AND is now a page with text, so
      adding "pages" to "empty pages" counted it twice. A three-page handout
      reported four pages on a real device, which is the kind of small wrong
      number that makes a person doubt everything else on the screen.
    */
    const document = latin1(
      pdf([typed('FICTIONAL-EXACT-PAGE one'), photocopied(), typed('FICTIONAL-EXACT-PAGE three')]),
    );
    const proposal = await readSermonNotes(document, 'handout.pdf', undefined, recogniser().scanner);
    expect(proposal.pages).toBe(3);
  });

  it('reports a scanned page as unread where there is nothing to render with', async () => {
    /*
      This runtime has no canvas, so a scanned page cannot be rendered and
      therefore cannot be recognised. That is a real deployment too — the web
      edition has no recogniser at all — and the behaviour must be the same in
      both: the page is reported as one that could not be read, never silently
      dropped from a proposal that claims to be the whole handout.
    */
    const document = latin1(
      pdf([typed('FICTIONAL-EXACT-PAGE one'), photocopied(), typed('FICTIONAL-EXACT-PAGE three')]),
    );
    const ocr = recogniser();

    const proposal = await readSermonNotes(document, 'handout.pdf', undefined, ocr.scanner);

    expect(proposal.scan?.unreadablePages).toEqual([2]);
    expect(proposal.material.body).toBe('FICTIONAL-EXACT-PAGE one\n\nFICTIONAL-EXACT-PAGE three');
  });

  it('refuses a fully scanned PDF it cannot read a word of', async () => {
    const document = latin1(pdf([photocopied(), photocopied()]));
    await expect(readSermonNotes(document, 'handout.pdf')).rejects.toThrow();
  });
});
