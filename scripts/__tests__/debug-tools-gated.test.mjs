import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The debug cleanup tool must not reach a release build.
 *
 * `src/debug/SyntheticCleanup.tsx` deletes entries and drafts by title match.
 * That is fine as a development aid on a test device and completely
 * unacceptable in a shipped app, where it would sit one tap away from a
 * lifetime of writing.
 *
 * The guard that matters is WHERE the import is, not where the render is. The
 * first attempt here rendered the component behind `__DEBUG_TOOLS__` but
 * imported it statically — and the string "Debug: remove test content" was
 * duly found in a release `dist/`, because a statically imported module
 * survives tree-shaking. Only moving the `import()` itself behind the constant
 * dropped it from the graph (verified by building both ways: 0 files in a
 * release build, 2 with DEBUG_TOOLS=1).
 *
 * So this asserts the shape that was actually proven to work, which is the
 * thing a future edit is most likely to undo.
 */

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

describe('the debug cleanup tool is gated out of release builds', () => {
  const dataView = read('src/views/DataView.tsx');
  const viteConfig = read('vite.config.ts');

  it('read the files it claims to check', () => {
    // A check that examined nothing passes.
    expect(dataView.length).toBeGreaterThan(1000);
    expect(viteConfig.length).toBeGreaterThan(200);
    expect(dataView).toContain('DataView');
  });

  it('never imports the debug tooling statically', () => {
    const staticImports = dataView
      .split('\n')
      .filter((line) => /^\s*import\s[^(]*from\s+'[^']*\/debug\//.test(line));
    expect(staticImports, 'a static import ships the module even when never rendered').toEqual([]);
  });

  it('puts the dynamic import behind the build-time constant', () => {
    expect(dataView).toMatch(/__DEBUG_TOOLS__[\s\S]{0,200}import\('\.\.\/debug\/SyntheticCleanup'\)/);
  });

  it('defines the constant from the environment, defaulting to off', () => {
    expect(viteConfig).toMatch(/__DEBUG_TOOLS__:\s*JSON\.stringify\(process\.env\.DEBUG_TOOLS === '1'\)/);
  });
});
