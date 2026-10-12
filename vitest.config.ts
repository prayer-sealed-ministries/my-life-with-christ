import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Plain ESM plugin, shared with the dev/build config and the CI bundle verifier.
import dataProfile from './scripts/vite-plugin-data-profile.mjs';

// Scripts are plain ESM and need no plugins; the app tests need React + jsdom.
// The data-profile plugin is here too, because any view that imports
// src/app/data.ts pulls `virtual:journey-data`, which only the plugin provides.
// Tests therefore run against the same generated module the app does, and
// DATA_PROFILE=refs-only exercises the refs-only profile end to end.
export default defineConfig({
  define: {
    // Tests exercise release behaviour unless a case explicitly injects a
    // debug surface. Keep this in lockstep with vite.config.ts so importing a
    // routed view can never fail before its assertions run.
    __DEBUG_TOOLS__: false,
  },
  plugins: [react(), dataProfile()],

  // Keep tests on the same compile-time branch as an ordinary release. Without
  // this, importing DataView throws before its tests can run because Vite's
  // production-only define does not exist in Vitest.
  define: {
    __DEBUG_TOOLS__: false,
  },

  resolve: {
    alias: [
      /*
       * pdfjs, in the build it tells you to use away from a browser.
       *
       * The package ships two. The app bundles the modern one. Asked for that
       * one under Node it prints "Please use the `legacy` build in Node.js
       * environments" and then does not finish: four PDF tests passed on a
       * developer's macOS Node and hung for twenty seconds each on CI's Linux
       * Node. That difference between two Node versions was the entire bug,
       * and it only showed up once the suite ran somewhere other than the
       * machine it was written on.
       *
       * So the tests take pdfjs at its word. This is a test-host alias and
       * changes nothing about what ships: the app still bundles the modern
       * build for browsers and webviews, and that shipped path is covered by
       * `tests/e2e/sermon-notes.spec.ts`, which reads a real PDF through a real
       * browser — on CI, where it passes.
       *
       * Anchored with a regex rather than written as a bare `'pdfjs-dist'`
       * string: a plain alias also rewrites
       * `pdfjs-dist/build/pdf.worker.min.mjs?url`, and then the module fails to
       * transform at all.
       */
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
    ],
  },

  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],

    // This suite has more than a hundred jsdom files, many of which open real
    // fake-IndexedDB databases. Letting Vitest match every host core can make
    // ten isolated DOMs compete at once; under a shared or busy machine even a
    // synchronous policy scan then crossed the five-second default. Two
    // workers keeps the gate bounded without serialising the whole suite.
    maxWorkers: 2,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
