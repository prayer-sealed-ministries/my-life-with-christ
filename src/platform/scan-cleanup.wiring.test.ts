/**
 * The stale-scan sweep is reached at startup.
 *
 * `cleanupStaleScans` is correct and well-behaved, and that is not the
 * question. This repository has already shipped a module that was written,
 * exported, unit-tested, passing — and called by nothing. The sweep is the
 * only thing that deletes a photograph left behind when the process was killed
 * mid-scan, so if nothing calls it, a page of somebody's notebook stays in the
 * cache and every test still passes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const entry = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');

describe('temporary scans are swept at startup', () => {
  it('is imported and called by the application entry point', () => {
    expect(entry).toMatch(/import \{ cleanupStaleScans \} from '\.\/platform\/native-scan'/);
    // Called, not merely imported. An unused import is what a linter catches;
    // an imported-and-never-invoked cleanup is what shipped last time.
    expect(entry).toMatch(/cleanupStaleScans\(\)/);
  });

  it('cannot stop the application starting', () => {
    // A tidy-up that threw on launch would be a worse bug than the litter it
    // removes, so the call is fire-and-forget with its own catch.
    const call = entry.slice(entry.indexOf('cleanupStaleScans()'));
    expect(call.slice(0, 60)).toMatch(/cleanupStaleScans\(\)\.catch\(/);
    expect(entry).toMatch(/void cleanupStaleScans\(\)/);
  });
});
