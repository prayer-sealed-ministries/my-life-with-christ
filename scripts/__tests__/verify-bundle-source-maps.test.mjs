import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const VERIFIER = join(ROOT, 'scripts/verify-bundle.mjs');

/**
 * Source maps in a publishable artefact, proven against the real verifier.
 *
 * The defect these cover shipped: `verify-bundle.mjs` evaluated NO_SOURCE_MAPS
 * only when the profile was `refs-only`, while printing its PASS line for every
 * profile. A `public` build carrying 112 maps — one of them
 * `assets/DataView-*.js.map`, holding the destructive debug cleanup component
 * in full — was told "no .map files that could carry the original modules" and
 * "This build is publishable."
 *
 * These run the verifier as a process against a real directory, because the
 * thing under test is what the gate concludes about bytes on disk.
 */

const created = [];

afterEach(() => {
  while (created.length > 0) rmSync(created.pop(), { recursive: true, force: true });
});

/**
 * A directory the verifier accepts as a real build.
 *
 * Every other assertion in the verifier is "none of X is present", which an
 * empty directory satisfies perfectly — so the floors have to be cleared before
 * a test can say anything about source maps at all. That means index.html, a
 * JavaScript file, at least 5 files, 100kB of searchable bytes, and all three
 * known-present sentinels.
 */
function makeBuild() {
  const dist = mkdtempSync(join(tmpdir(), 'verify-bundle-'));
  created.push(dist);
  mkdirSync(join(dist, 'assets'), { recursive: true });

  writeFileSync(
    join(dist, 'index.html'),
    '<!doctype html><title>Journey</title><body><div id="root"></div></body>',
  );
  // The three sentinels the verifier requires, plus enough bytes to clear the
  // 100kB floor. Without the padding the build fails BUNDLE_WAS_READ and the
  // test would prove nothing about source maps.
  writeFileSync(
    join(dist, 'assets/index-aaaaaaaa.js'),
    [
      'export const app = "Journey";',
      'export const topic = "Thankfulness";',
      'export const verse = "Be careful for nothing";',
      `const padding = "${'x'.repeat(120_000)}";`,
      'export default padding;',
    ].join('\n'),
  );
  writeFileSync(join(dist, 'assets/index-aaaaaaaa.css'), 'body{color:#111}');
  writeFileSync(join(dist, 'manifest.webmanifest'), '{"name":"Journey"}');
  writeFileSync(join(dist, 'build-id.json'), '{"profile":"public","files":5}');

  return dist;
}

function verify(dist, profile) {
  const run = spawnSync(process.execPath, [VERIFIER, '--profile', profile, '--dist', dist], {
    encoding: 'utf8',
    // The verifier also reads DATA_PROFILE as a fallback for --profile. Clear
    // it so the suite's own profile cannot decide what this test checks.
    env: { ...process.env, DATA_PROFILE: undefined },
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe('verify-bundle and source maps', () => {
  it('passes a clean build, and says so for all five assertions', () => {
    const dist = makeBuild();

    for (const profile of ['public', 'refs-only']) {
      const { status, output } = verify(dist, profile);
      expect(status, `${profile}: ${output}`).toBe(0);
      expect(output).toContain('This build is publishable.');
      for (const assertion of [
        'BUNDLE_WAS_READ',
        'NO_SOURCE_FILES',
        'NO_SOURCE_MAPS',
        'NO_LICENSED_CONTENT',
        'NO_DEBUG_TOOLS',
      ]) {
        expect(output, `${profile} should report ${assertion}`).toContain(assertion);
      }
    }
  });

  // Requirement E, for every publishable profile. Before the fix, `public`
  // returned 0 here and printed "This build is publishable."
  it.each(['public', 'refs-only'])(
    'fails a prohibited source map under %s',
    (profile) => {
      const dist = makeBuild();
      writeFileSync(
        join(dist, 'assets/index-aaaaaaaa.js.map'),
        JSON.stringify({ version: 3, sources: ['../src/main.tsx'], sourcesContent: ['const x = 1;'] }),
      );

      const { status, output } = verify(dist, profile);
      expect(status, output).toBe(1);
      expect(output).toContain('NO_SOURCE_MAPS');
      expect(output).toContain('assets/index-aaaaaaaa.js.map');
      expect(output).toContain('Do not deploy this artefact.');
    },
  );

  // Requirement F. The claim and the check are now the same object, so a build
  // that has maps cannot be told it has none.
  it.each(['public', 'refs-only'])(
    'never prints the no-source-maps claim when maps are present under %s',
    (profile) => {
      const dist = makeBuild();
      writeFileSync(join(dist, 'assets/index-aaaaaaaa.js.map'), '{"version":3,"sources":[]}');

      const { status, output } = verify(dist, profile);
      expect(status).toBe(1);
      expect(output).not.toContain('no .map files');
      expect(output).not.toContain('This build is publishable.');
    },
  );

  /*
   * The specific evidence, reproduced.
   *
   * `npm run build` on main at e65c1b3 emitted assets/DataView-*.js.map, and
   * the verifier found "SyntheticCleanup" inside it — but only because the
   * debug-sentinel search happens to read .map files as text. The map itself
   * went unremarked.
   */
  it('fails the DataView map that carried SyntheticCleanup, on both counts', () => {
    const dist = makeBuild();
    writeFileSync(
      join(dist, 'assets/DataView-t39hN3Bk.js.map'),
      JSON.stringify({
        version: 3,
        sources: ['../../src/debug/SyntheticCleanup.tsx'],
        sourcesContent: ['export function SyntheticCleanup() { return null; }'],
      }),
    );

    const { status, output } = verify(dist, 'public');
    expect(status, output).toBe(1);
    expect(output).toContain('NO_DEBUG_TOOLS');
    expect(output).toContain('SyntheticCleanup');
    // The point of the repair: the map is refused as a map, not only because
    // of what this particular one happened to contain.
    expect(output).toContain('NO_SOURCE_MAPS');
    expect(output).toContain('DataView-t39hN3Bk.js.map');
  });

  /*
   * And the same leak with the symbol removed.
   *
   * Deleting SyntheticCleanup must not be a way to make the gate quiet. A map
   * naming no known debug string at all is still a published module.
   */
  it('fails a source map that names no debug symbol whatsoever', () => {
    const dist = makeBuild();
    writeFileSync(
      join(dist, 'assets/DataView-t39hN3Bk.js.map'),
      JSON.stringify({
        version: 3,
        sources: ['../../src/views/DataView.tsx'],
        sourcesContent: ['export function DataView() { return null; }'],
      }),
    );

    const { status, output } = verify(dist, 'public');
    expect(status, output).toBe(1);
    expect(output).toContain('NO_SOURCE_MAPS');
    expect(output).not.toContain('NO_DEBUG_TOOLS —');
  });

  it('still refuses a build it did not really read, maps or no maps', () => {
    // The floor that caught an empty dist/ passing all four assertions. Kept
    // under test here because the summary is now generated, and a generated
    // summary over zero assertions would be an empty, cheerful report.
    const dist = mkdtempSync(join(tmpdir(), 'verify-bundle-empty-'));
    created.push(dist);

    const { status, output } = verify(dist, 'public');
    expect(status).toBe(1);
    expect(output).toContain('BUNDLE_WAS_READ');
    expect(output).not.toContain('This build is publishable.');
  });
});
