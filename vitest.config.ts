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
  plugins: [react(), dataProfile()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
});
