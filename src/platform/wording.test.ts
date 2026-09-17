/**
 * User-facing wording that must survive leaving the browser.
 *
 * Every string asserted here is reachable from inside an installed iOS or
 * Android application, where telling somebody about "this browser" is simply
 * wrong — there is no browser from their point of view. The mistake is easy to
 * make and invisible on the web, where the wording reads fine, so it is
 * checked rather than remembered.
 *
 * Wording that is legitimately about a browser is NOT listed. The archive's own
 * README tells a stranger to open an HTML file "in any web browser", which is
 * correct advice however the archive was produced. That stays.
 *
 * The export reminder used to be excused on the same grounds — "clearing your
 * browser data" is the exact risk on the web. It is not the risk on a phone,
 * where the journal is in SQLite and the equivalent act is removing the app, and
 * the string is shown in both editions. It is now neutral, and asserted here.
 */

import { describe, expect, it } from 'vitest';

import { CANNOT_DECOMPRESS } from './compression';

const BROWSER_WORDS = /\b(browser|webpage|website|this tab)\b/i;

describe('runtime error wording is platform-neutral', () => {
  it('the archive-cannot-be-read message names the device', () => {
    expect(CANNOT_DECOMPRESS).toMatch(/device/i);
    expect(CANNOT_DECOMPRESS).not.toMatch(BROWSER_WORDS);
  });

  it('the out-of-room message names the device', async () => {
    const { commitImport } = await import('../import/commit');
    const failing = {
      listEntries: async () => [],
      putEntries: async () => {
        throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      },
    } as never;

    const { parseDocument } = await import('../import/candidates');
    const parsed = await parseDocument(new TextEncoder().encode('A note.'), 'note.txt');
    const result = await commitImport(parsed, parsed.candidates, failing);

    expect(result.failures[0]).toMatch(/device/i);
    expect(result.failures[0]).not.toMatch(BROWSER_WORDS);
  });

  it('the PDF and Word failures name the device', async () => {
    const { parseDocument } = await import('../import/candidates');

    // A .docx whose body is far too large to read.
    const oversize = await parseDocument(
      new TextEncoder().encode('x'.repeat(10)),
      'broken.docx',
    ).catch((cause: Error) => cause);
    expect((oversize as Error).message).not.toMatch(BROWSER_WORDS);
  });
});

describe('the backup warnings are true in an installed app as well as a tab', () => {
  // These are the strings a person reads while deciding whether their journal
  // is safe. On a phone the store is SQLite, not browser storage, and the act
  // that destroys it is removing the app — so wording about "clearing your
  // browser data" is not a cosmetic mismatch, it is advice that does not apply.

  it('the never-exported reminder does not name a browser', async () => {
    const { exportReminder } = await import('../export/reminder');
    const reminder = exportReminder({}, 3, new Date());

    expect(reminder.show).toBe(true);
    expect(reminder.message).not.toMatch(BROWSER_WORDS);
    // And still says the thing that matters.
    expect(reminder.message).toMatch(/not a backup/i);
  });

  /**
   * The prose a reader actually sees, with the code's own explanations removed.
   *
   * Block comments are stripped wholesale rather than line by line: a JSX
   * comment's continuation lines start with ordinary words, so a per-line
   * filter leaves them in and the test then fails on a sentence nobody reads.
   */
  const proseOf = async (relative: string): Promise<string> => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), relative), 'utf8');
    return source
      .replace(/\/\*[\s\S]*?\*\//g, ' ') // block and JSX comments
      .replace(/^\s*\/\/.*$/gm, ' '); // line comments
  };

  it('the standing warning on the journal page does not name a browser', async () => {
    const prose = await proseOf('src/views/DataView.tsx');

    expect(prose).toMatch(/not a backup/i);
    expect(prose, 'DataView still tells a phone user about their browser').not.toMatch(
      /\bbrowser\b/i,
    );
  });

  it('the first-visit notice does not name a browser', async () => {
    const prose = await proseOf('src/components/FirstVisitNotice.tsx');

    expect(prose, 'the first thing a reader sees mentions a browser').not.toMatch(/\bbrowser\b/i);
    // A floor: the notice still says where the notes live.
    expect(prose).toMatch(/live on this device/i);
  });
});
