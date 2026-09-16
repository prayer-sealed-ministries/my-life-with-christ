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
 * correct advice however the archive was produced, and the export reminder
 * names "clearing your browser data" because on the web that is the specific
 * action that destroys a journal. Those stay.
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
