/**
 * The budget is spent before the memory is.
 *
 * A PDF page declares its own size, so the page decides how much memory
 * rendering it would cost. That makes the ceiling a security control rather
 * than a performance setting: a page claiming to be enormous is not a slow
 * render, it is an out-of-memory crash with an attacker-supplied document
 * behind it. Everything here checks the declared size BEFORE a canvas exists.
 *
 * Every page here is fictional.
 */
import { describe, expect, it, vi } from 'vitest';

import { MAX_PDF_PAGE_PIXELS } from './limits';
import {
  RENDER_SCALE,
  renderPdfPage,
  scaleWithinBudget,
  type CanvasFactory,
  type RenderablePage,
} from './pdf-render';

/** A page of a given size in PDF points, as pdf.js describes one. */
const page = (pointsWide: number, pointsTall: number): RenderablePage => ({
  getViewport: ({ scale }) => ({ width: pointsWide * scale, height: pointsTall * scale }),
  render: () => ({ promise: Promise.resolve() }),
});

/** A4 in points, which is what a church handout actually is. */
const A4 = () => page(595, 842);

function canvases(options: { fail?: boolean } = {}) {
  const created: Array<{ width: number; height: number }> = [];
  let released = 0;
  const factory: CanvasFactory = {
    create(width, height) {
      created.push({ width, height });
      if (options.fail) return null;
      return {
        context: { fictional: true },
        surface: { fictional: 'canvas' },
        toBase64: () => 'FICTIONAL-RENDERED-BYTES',
        release: () => {
          released += 1;
        },
      };
    },
  };
  return { factory, created, released: () => released };
}

describe('what a page may be rendered at', () => {
  it('renders an ordinary page at the working resolution', () => {
    const fitted = scaleWithinBudget(A4(), MAX_PDF_PAGE_PIXELS);
    expect(fitted).not.toBeNull();
    expect(fitted!.scale).toBeCloseTo(RENDER_SCALE, 5);
    // About 200 dpi against the PDF's 72-point unit.
    expect(fitted!.width).toBe(Math.floor(595 * RENDER_SCALE));
  });

  it('scales an unusually large page down rather than refusing it', () => {
    // A page somebody really did make enormous. It is still a page they want
    // read, so it is rendered smaller rather than declined.
    const fitted = scaleWithinBudget(page(5000, 7000), MAX_PDF_PAGE_PIXELS);
    expect(fitted).not.toBeNull();
    expect(fitted!.width * fitted!.height).toBeLessThanOrEqual(MAX_PDF_PAGE_PIXELS);
    expect(fitted!.scale).toBeLessThan(RENDER_SCALE);
  });

  it('refuses when there is no budget left', () => {
    expect(scaleWithinBudget(A4(), 0)).toBeNull();
    expect(scaleWithinBudget(A4(), -1)).toBeNull();
  });

  it('refuses a page whose declared size is not a number', () => {
    const nonsense: RenderablePage = {
      getViewport: () => ({ width: Number.NaN, height: 100 }),
      render: () => ({ promise: Promise.resolve() }),
    };
    expect(scaleWithinBudget(nonsense, MAX_PDF_PAGE_PIXELS)).toBeNull();
  });

  it('refuses a page too small to be a page', () => {
    expect(scaleWithinBudget(page(1, 1), MAX_PDF_PAGE_PIXELS)).toBeNull();
  });
});

describe('rendering spends the budget it was given', () => {
  it('renders a page and charges it to the document budget', async () => {
    const { factory, created, released } = canvases();
    const budget = { remaining: MAX_PDF_PAGE_PIXELS * 4 };

    const image = await renderPdfPage(A4(), budget, factory);

    expect(image).not.toBeNull();
    expect(image!.base64).toBe('FICTIONAL-RENDERED-BYTES');
    expect(created).toHaveLength(1);
    expect(budget.remaining).toBe(MAX_PDF_PAGE_PIXELS * 4 - image!.width * image!.height);
    // The backing store is dropped now, not whenever the collector gets to it.
    expect(released()).toBe(1);
  });

  it('declines once the document has spent its pixels', async () => {
    const { factory, created } = canvases();
    const budget = { remaining: 0 };

    expect(await renderPdfPage(A4(), budget, factory)).toBeNull();
    // Nothing was allocated. The refusal happened before the canvas.
    expect(created).toEqual([]);
  });

  it('declines rather than throwing when a page will not draw', async () => {
    const broken: RenderablePage = {
      getViewport: ({ scale }) => ({ width: 595 * scale, height: 842 * scale }),
      render: () => ({ promise: Promise.reject(new Error('FICTIONAL internal failure')) }),
    };
    const { factory, released } = canvases();
    const budget = { remaining: MAX_PDF_PAGE_PIXELS };

    // A page that will not draw is a page that could not be read, and the
    // library's own message never reaches anybody.
    await expect(renderPdfPage(broken, budget, factory)).resolves.toBeNull();
    expect(released()).toBe(1);
  });

  it('declines when the platform has no canvas to give', async () => {
    const { factory } = canvases({ fail: true });
    await expect(renderPdfPage(A4(), { remaining: MAX_PDF_PAGE_PIXELS }, factory)).resolves.toBeNull();
  });

  it('never allocates more than the per-page ceiling, whatever the page claims', async () => {
    const { factory, created } = canvases();
    const budget = { remaining: Number.MAX_SAFE_INTEGER };

    // Ten metres square, in points.
    await renderPdfPage(page(28_350, 28_350), budget, factory);

    expect(created).toHaveLength(1);
    expect(created[0].width * created[0].height).toBeLessThanOrEqual(MAX_PDF_PAGE_PIXELS);
  });

  it('does not reach the network to render', async () => {
    const fetchSpy = vi.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const { factory } = canvases();
      await renderPdfPage(A4(), { remaining: MAX_PDF_PAGE_PIXELS }, factory);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
