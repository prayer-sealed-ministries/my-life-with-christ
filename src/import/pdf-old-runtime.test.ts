/**
 * PDF import on a web view older than the engine expects.
 *
 * pdfjs 6 calls `Promise.try`, which arrived in Chrome 128. The Android System
 * WebView on a device nobody has updated is older — the emulator this was
 * found on reports Chrome 124 — and there the modern build threw inside a
 * promise it never surfaces. The import did not fail and did not error: it sat
 * on a loading spinner for ever, which is the worst shape a bug can take,
 * because it is the one that looks like patience.
 *
 * The fix is the build pdfjs ships for this. These hold both halves: that the
 * app loads that build, and that the build really does bring the method with
 * it rather than assuming the runtime has one.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TEXT_PDF_NOTES, latin1 } from './sermon-notes-fixtures';

type PromiseWithTry = typeof Promise & { try?: unknown };

const original = (Promise as PromiseWithTry).try;
const source = () => readFileSync(resolve(process.cwd(), 'src/import/pdf.ts'), 'utf8');

afterEach(() => {
  if (original === undefined) delete (Promise as PromiseWithTry).try;
  else (Promise as PromiseWithTry).try = original;
  vi.resetModules();
});

describe('a runtime without Promise.try', () => {
  it('still reads a text PDF, because the engine brings its own', async () => {
    // Taken away BEFORE the engine is loaded, which is the order a real old
    // device sees: the chunk arrives, its polyfills run, and only then is a
    // document parsed. Removing it afterwards would test nothing that happens
    // in life — the module is already initialised by then.
    delete (Promise as PromiseWithTry).try;
    expect((Promise as PromiseWithTry).try).toBeUndefined();

    vi.resetModules();
    const { parsePdf } = await import('./pdf');
    const extraction = await parsePdf(latin1(TEXT_PDF_NOTES));

    expect(extraction.pages.map((page) => page.text).join(' ')).toMatch(/treasure/i);
    // And the engine installed it, rather than the app patching around it.
    expect(typeof (Promise as PromiseWithTry).try).toBe('function');
  }, 30_000);
});

describe('the app and the tests use the same engine', () => {
  it('loads the legacy build, main thread and worker alike', () => {
    /*
     * The divergence this closes: vitest aliased `pdfjs-dist` to the legacy
     * build so the suite would run under Node, while the app shipped the
     * modern one. The tests were exercising a different engine from the
     * product, which is exactly how a runtime gap reached an emulator instead
     * of CI.
     */
    expect(source()).toMatch(/import\('pdfjs-dist\/legacy\/build\/pdf\.mjs'\)/);
    expect(source()).toMatch(/pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs\?url/);
  });

  it('carries no hand-rolled patch of its own', () => {
    /*
     * One was written first, and it is worth remembering why it was wrong.
     * Patching the main thread left the WORKER — its own global scope, out of
     * reach — still broken. Declining the worker to avoid that broke it
     * differently: in a browser pdfjs REQUIRES one and refuses with
     * `No "GlobalWorkerOptions.workerSrc" specified`. Three failures, one
     * cause, and a build that already solved it.
     */
    expect(source()).not.toMatch(/ensurePromiseTry|Promise\.try\s*=/);
  });

  it('ships an engine that defines Promise.try itself', () => {
    // Both bundles, because the worker is a separate global scope and is where
    // the parsing actually happens in a browser.
    for (const bundle of ['pdf.mjs', 'pdf.worker.mjs']) {
      const text = readFileSync(
        resolve(process.cwd(), `node_modules/pdfjs-dist/legacy/build/${bundle}`),
        'utf8',
      );
      expect(text, `${bundle} no longer polyfills Promise.try`).toContain(
        'core-js/modules/es.promise.try.js',
      );
    }
  });
});
