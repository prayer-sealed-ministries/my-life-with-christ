import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Plain ESM plugin, shared with the CI bundle verifier.
import dataProfile from './scripts/vite-plugin-data-profile.mjs';

export default defineConfig({
  plugins: [react(), tailwindcss(), dataProfile()],
  build: {
    // One book of scripture per chunk, so a chapter read never pulls the Bible.
    chunkSizeWarningLimit: 700,
  },
});
