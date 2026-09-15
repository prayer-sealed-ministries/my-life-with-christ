import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Attribution must actually be rendered, not merely available.
 *
 * `attribution.test.ts` verified the module's behaviour and passed while
 * nothing on earth called it — the module shipped to production entirely
 * unwired, and the live site carried no BSB credit. A unit test proves a
 * function works; it says nothing about whether anything uses it.
 *
 * So this asserts the wiring: some view imports it, and the export README
 * includes it.
 */

const tracked = execSync('git ls-files --cached --others --exclude-standard src', { encoding: 'utf8' })
  .split('\n')
  .map((line) => line.trim())
  .filter((path) => /\.(ts|tsx)$/.test(path) && !path.includes('.test.'));

const importers = tracked.filter((path) => {
  if (path.endsWith('lib/attribution.ts')) return false;
  return /from '.*lib\/attribution'/.test(readFileSync(path, 'utf8'));
});

describe('attribution is wired in, not just written', () => {
  it('scanned real source files', () => {
    // Without this the check passes by looking at nothing.
    expect(tracked.length).toBeGreaterThan(20);
  });

  it('is imported by something that is not itself', () => {
    expect(importers, 'nothing imports lib/attribution — it would ship unused').not.toEqual([]);
  });

  it('reaches a rendered view', () => {
    const rendersIt = tracked.filter(
      (path) => /\.tsx$/.test(path) && /Attribution/.test(readFileSync(path, 'utf8')) && !path.endsWith('components/Attribution.tsx'),
    );
    expect(rendersIt, 'no view renders <Attribution />').not.toEqual([]);
  });

  it('reaches the export archive', () => {
    const readme = readFileSync('src/export/readme.ts', 'utf8');
    expect(readme).toMatch(/attributionText/);
  });
});
