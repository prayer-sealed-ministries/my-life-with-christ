import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The brand, held in place by something other than memory.
 *
 * The application is **My Life With Christ**; the journal it produces is **My
 * Journey With Christ**, written to `book/my-journey-with-christ.html`. Those
 * names replaced an earlier pair, and the earlier pair was spread across the
 * export generator, the archive's own README, the index links, the printable
 * view and a dozen assertions.
 *
 * A rename like that is easy to do once and easy to undo by accident — a
 * reverted file, a copied block, a merge that resolves the wrong way. This scans
 * the committed source so the old wording cannot come back quietly.
 *
 * The check runs over the working tree, not over HEAD: the point is to catch it
 * before it is committed rather than to notice afterwards.
 */

/** The old wording, in every casing and slug form it appeared in. */
const RETIRED = [
  { pattern: /My Journey with God/i, what: 'the old book title' },
  { pattern: /MY JOURNEY WITH GOD/, what: 'the old book title, in the archive README banner' },
  { pattern: /my-journey-with-god\.html/i, what: 'the old book filename' },
];

/**
 * Where the old wording may still legitimately appear.
 *
 * Two files, both of which name the old strings in order to forbid them:
 * this one, and the round-trip test that asserts a freshly built archive does
 * NOT contain the retired filename. Nothing else — there is deliberately no
 * allowance for "historical compatibility", because no real journal was ever
 * exported under the old name, so nothing needs to read it.
 *
 * Keep this list short. An entry here is a place the guard cannot see.
 */
const ALLOWED = new Set([
  'scripts/__tests__/branding.test.mjs',
  'src/export/roundtrip.test.ts',
]);

function trackedSourceFiles() {
  const output = execSync(
    'git ls-files --cached --others --exclude-standard src scripts tests .github index.html',
    { encoding: 'utf8' },
  );
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((path) => /\.(ts|tsx|mjs|js|json|yml|yaml|css|html|sh)$/.test(path))
    // Scripture and vendored source data contain the ordinary English word
    // "journey" and are never edited by hand.
    .filter((path) => !path.startsWith('src/data/'));
}

const files = trackedSourceFiles();

describe('the retired brand cannot come back', () => {
  it('found files to check', () => {
    // Without this the scan passes by looking at nothing, which is the failure
    // mode every floor in this repository exists to prevent.
    expect(files.length, 'git ls-files returned nothing').toBeGreaterThan(50);
  });

  for (const { pattern, what } of RETIRED) {
    it(`no committed source carries ${what}`, () => {
      const offenders = [];

      for (const path of files) {
        if (ALLOWED.has(path)) continue;
        const content = readFileSync(path, 'utf8');
        content.split('\n').forEach((line, index) => {
          if (pattern.test(line)) {
            offenders.push(`${path}:${index + 1} — ${line.trim().slice(0, 100)}`);
          }
        });
      }

      expect(offenders.join('\n')).toBe('');
    });
  }
});

/**
 * The other half of the guard.
 *
 * Forbidding the old name proves nothing on its own: deleting the title
 * altogether would satisfy every assertion above. So the new name is required
 * to be present, in the specific places that produce what a reader sees.
 */
describe('the current brand is actually in place', () => {
  const mustContain = [
    ['src/export/book.ts', '<h1>My Journey With Christ</h1>', 'the book title page'],
    ['src/export/book.ts', '<title>My Journey With Christ</title>', 'the book document title'],
    ['src/export/archive.ts', "path: 'book/my-journey-with-christ.html'", 'the archive book path'],
    ['src/export/readme.ts', 'MY JOURNEY WITH CHRIST', "the archive README banner"],
    ['src/views/LegacyView.tsx', 'My Journey With Christ', 'the printable view in the app'],
    ['index.html', '<title>My Life With Christ</title>', 'the application title'],
    ['src/app/Shell.tsx', "const APP_NAME = 'My Life With Christ'", 'the name shown in the header'],
    ['src/app/Shell.tsx', "const TAGLINE = 'Your walk, remembered.'", 'the tagline shown in the header'],
  ];

  for (const [path, needle, what] of mustContain) {
    it(`${what} says the current name`, () => {
      expect(readFileSync(path, 'utf8'), `${path} no longer contains ${needle}`).toContain(needle);
    });
  }
});
