import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Plain ESM plugin, shared with the CI bundle verifier.
import dataProfile, { resolveProfile } from './scripts/vite-plugin-data-profile.mjs';
import buildId from './scripts/vite-plugin-build-id.mjs';
import guardPublicDir from './scripts/vite-plugin-guard-public.mjs';
import offline from './scripts/vite-plugin-offline.mjs';
import pkg from './package.json' with { type: 'json' };

/**
 * Which profile this build is, decided once.
 *
 * `resolveProfile` is the only thing in the repository that knows what an unset
 * DATA_PROFILE means, and the plugin is handed the answer rather than reading
 * the environment a second time. Two readers with two defaults is exactly the
 * bug this replaces: the plugin resolved unset to `public` and announced
 * `DATA_PROFILE=public`, while the sourcemap decision below resolved unset to
 * `full` — the retired licensed-compilation profile that `resolveProfile`
 * refuses outright — and so emitted 112 source maps into a build that called
 * itself public. An invalid profile now throws here, before anything is built.
 */
const DATA_PROFILE = resolveProfile();

export default defineConfig({
  // GitHub Pages serves a project site from /<repo>/, so assets need that
  // prefix. Set BASE_PATH in CI; local dev and file:// builds stay at '/'.
  base: process.env.BASE_PATH ?? '/',
  // buildId is last: it digests the finished output directory, so every other
  // plugin's contribution has to be on disk before it runs.
  plugins: [
    guardPublicDir(),
    react(),
    tailwindcss(),
    dataProfile({ profile: DATA_PROFILE }),
    offline(),
    buildId(),
  ],
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
    // import would still be published intact — and so would debug tooling the
    // `__DEBUG_TOOLS__` define above was meant to drop. Every profile this
    // repository can build is publishable, so no profile emits them, and
    // `verify:bundle` fails any publishable artefact that carries one.
    //
    // There is deliberately no opt-in. An emitted map would only produce an
    // artefact the gate rejects, and the dev server has maps already.
    sourcemap: false,
  },
});
