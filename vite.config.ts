import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Plain ESM plugin, shared with the CI bundle verifier.
import dataProfile from './scripts/vite-plugin-data-profile.mjs';
import buildId from './scripts/vite-plugin-build-id.mjs';
import guardPublicDir from './scripts/vite-plugin-guard-public.mjs';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so assets need that
  // prefix. Set BASE_PATH in CI; local dev and file:// builds stay at '/'.
  base: process.env.BASE_PATH ?? '/',
  // buildId is last: it digests the finished output directory, so every other
  // plugin's contribution has to be on disk before it runs.
  plugins: [guardPublicDir(), react(), tailwindcss(), dataProfile(), buildId()],
  // The version comes from package.json and nowhere else. Writing it in a
  // second place is how a version string starts lying.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    /**
     * Debug-only tooling, off unless asked for. A literal `false` here
     * lets the bundler drop the guarded code entirely, so a release
     * build does not carry a one-tap delete anywhere near a journal.
     */
    __DEBUG_TOOLS__: JSON.stringify(process.env.DEBUG_TOOLS === '1'),
  },
  build: {
    // One book of scripture per chunk, so a chapter read never pulls the Bible.
    chunkSizeWarningLimit: 700,
    // A source map can contain the original module in full, so a tree-shaken
    // import would still be published intact. Never emit them for a build
    // that may be deployed publicly.
    sourcemap: (process.env.DATA_PROFILE ?? 'full') === 'full',
  },
});
