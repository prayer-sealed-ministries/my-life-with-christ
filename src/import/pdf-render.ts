/**
 * Turning a PDF page into a picture, within bounds decided before anything is
 * allocated.
 *
 * Only ever reached for a page that carries no selectable text, and only after
 * the document has passed every check in `document-type.ts` — the type
 * verdict, the structural policy, the active-content scan. Rendering is
 * parsing attacker-controlled structure, so it happens last and only to
 * documents already judged safe to open. "We are only rendering it" is not a
 * reason to skip a gate.
 *
 * THE ALLOCATION IS THE ATTACK
 *
 * A page declares its own size. An RGBA bitmap costs width x height x 4 bytes
 * in the canvas, again when it is encoded, and again crossing the bridge to
 * the recogniser — so a page claiming to be ten metres square is not a
 * rendering problem, it is an out-of-memory crash with a document behind it.
 * Every ceiling here is therefore checked against the page's declared size
 * BEFORE a canvas exists, and a page that cannot be brought under them is
 * declined rather than attempted.
 */

import { MAX_PDF_PAGE_PIXELS, MAX_PDF_TOTAL_PIXELS } from './limits';
import type { PreparedImage } from './pdf-scan';

/**
 * What to render at, when the page's own size allows it.
 *
 * Chosen by measurement rather than by tradition. Scanners default to 300 dpi
 * because that is what fax and print standardised on, not because recognition
 * needs it: the benchmark found small print read identically at 200 and at
 * 300, while the 300 dpi bitmap cost more than twice the memory. 200 dpi — a
 * scale of about 2.78 against the PDF's 72-point unit — is the lowest setting
 * at which the smallest type in the fixtures stayed exact.
 */
export const RENDER_SCALE = 2.78;

/** Just enough of a pdf.js page for this file, so nothing imports the library. */
export interface RenderablePage {
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: { canvasContext: unknown; canvas: unknown; viewport: unknown }): {
    promise: Promise<void>;
  };
}

/** How a canvas is obtained. Replaced in tests, where there is no DOM. */
export interface CanvasFactory {
  create(width: number, height: number): {
    context: unknown;
    /** The element itself; the renderer wants both it and its context. */
    surface: unknown;
    /** Encoded bytes for the recogniser, base64, without the data: prefix. */
    toBase64(): string;
    /** Release whatever the platform is holding. */
    release(): void;
  } | null;
}

/**
 * The browser's canvas, which inside the app is the WebView's.
 *
 * JPEG rather than PNG: a rendered page of text compresses to a fraction of
 * the size, the recognisers read it identically, and the bytes cross the
 * bridge once. Quality is high enough that small type keeps its edges —
 * recognition is sensitive to exactly that, and this is not a photograph
 * anybody will look at twice.
 */
export const domCanvasFactory: CanvasFactory = {
  create(width, height) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    return {
      context,
      surface: canvas,
      toBase64: () => canvas.toDataURL('image/jpeg', 0.92).replace(/^data:[^,]+,/, ''),
      release: () => {
        // Zero the dimensions so the backing store is dropped now rather than
        // whenever the collector gets to it. A page at a time is the budget.
        canvas.width = 0;
        canvas.height = 0;
      },
    };
  },
};

/** Decides, before allocating, what scale a page may actually be rendered at. */
export function scaleWithinBudget(
  page: RenderablePage,
  remainingPixels: number,
): { scale: number; width: number; height: number } | null {
  const natural = page.getViewport({ scale: RENDER_SCALE });
  const ceiling = Math.min(MAX_PDF_PAGE_PIXELS, remainingPixels);
  if (ceiling <= 0) return null;

  const wanted = natural.width * natural.height;
  if (!Number.isFinite(wanted) || wanted <= 0) return null;

  // Scale down to fit rather than refuse: an unusually large page is still a
  // page somebody wants read, and a smaller render of it is a real answer.
  const factor = wanted > ceiling ? Math.sqrt(ceiling / wanted) : 1;
  const scale = RENDER_SCALE * factor;
  const viewport = page.getViewport({ scale });
  const width = Math.floor(viewport.width);
  const height = Math.floor(viewport.height);

  // Anything this small is not a page; refusing beats handing the recogniser
  // a few pixels and reporting that it could not read them.
  if (width < 16 || height < 16) return null;
  if (width * height > ceiling) return null;
  return { scale, width, height };
}

export interface RenderBudget {
  /** Pixels still available across the whole document. */
  remaining: number;
}

/**
 * Render one page, or decline.
 *
 * Declining is a normal outcome and is reported as a page that could not be
 * read, which the person is told about by number. It is never a silent skip.
 */
export async function renderPdfPage(
  page: RenderablePage,
  budget: RenderBudget,
  canvases: CanvasFactory = domCanvasFactory,
): Promise<PreparedImage | null> {
  const fitted = scaleWithinBudget(page, Math.min(budget.remaining, MAX_PDF_TOTAL_PIXELS));
  if (!fitted) return null;

  const canvas = canvases.create(fitted.width, fitted.height);
  if (!canvas) return null;

  try {
    const viewport = page.getViewport({ scale: fitted.scale });
    await page.render({ canvasContext: canvas.context, canvas: canvas.surface, viewport }).promise;
    const base64 = canvas.toBase64();
    if (!base64) return null;
    budget.remaining -= fitted.width * fitted.height;
    return { base64, width: fitted.width, height: fitted.height };
  } catch {
    // A page that will not draw is a page that could not be read. The
    // library's own message never reaches anybody.
    return null;
  } finally {
    canvas.release();
  }
}
