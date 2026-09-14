import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Scripts are plain ESM and need no plugins; the app tests need React + jsdom.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
  },
});
