/**
 * The promises import makes, tested as promises rather than as intentions.
 *
 * "Processed on this device, nothing uploaded" is printed on the screen where
 * somebody chooses a file. A claim shown to a user has to be enforced by
 * something, and these are that something: every network primitive is replaced
 * with a spy that fails the test if it is touched at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { examinedAtLeast } from '../testing/floor';
import { parseDocument } from './candidates';
import { parseDocx } from './docx';
import { safeFilename } from './limits';
import { makeDocx, makeZipBomb } from './fixtures';
import { DecompressionLimit, readZipLimited } from './zip-limits';

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);

/** Every way a browser can reach the network, watched at once. */
function watchNetwork() {
  const calls: string[] = [];
  const trap = (name: string) =>
    vi.fn((...args: unknown[]) => {
      calls.push(`${name}(${String(args[0]).slice(0, 80)})`);
      throw new Error(`${name} must not be called during import`);
    });

  vi.stubGlobal('fetch', trap('fetch'));
  vi.stubGlobal('XMLHttpRequest', class { open = trap('XMLHttpRequest.open'); send = trap('XMLHttpRequest.send'); });
  vi.stubGlobal('WebSocket', trap('WebSocket'));
  vi.stubGlobal('EventSource', trap('EventSource'));
  vi.stubGlobal('sendBeacon', trap('sendBeacon'));
  // jsdom does not implement sendBeacon, so it is installed rather than spied
  // on: the point is that nothing calls it, not that it already existed.
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    writable: true,
    value: trap('navigator.sendBeacon'),
  });
  return calls;
}

let network: string[];

beforeEach(() => {
  network = watchNetwork();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('import makes no network request', () => {
  it('parses plain text without reaching the network', async () => {
    const parsed = await parseDocument(bytes('A note about John 3:16.\n'), 'notes.txt');
    examinedAtLeast(parsed.candidates.length, 1, 'candidates parsed');
    expect(network).toEqual([]);
  });

  it('parses Markdown without reaching the network', async () => {
    const parsed = await parseDocument(bytes('# One\n\nBody\n\n# Two\n\nBody\n'), 'notes.md');
    examinedAtLeast(parsed.candidates.length, 2, 'candidates parsed');
    expect(network).toEqual([]);
  });

  it('parses a Word document without reaching the network', async () => {
    const docx = await makeDocx([{ text: 'Sunday sermon' }, { text: 'On Romans 8:28.' }]);
    const parsed = await parseDocument(docx, 'sermons.docx');
    examinedAtLeast(parsed.candidates.length, 1, 'candidates parsed');
    expect(network).toEqual([]);
  });

  /**
   * The specific worry: a Word document can declare an external image, a linked
   * subdocument or a remote template in word/_rels/document.xml.rels. Those are
   * instructions to go and fetch something, and this parser must ignore them
   * rather than follow them.
   */
  it('does not follow a Word document\u2019s external relationships', async () => {
    const docx = await makeDocx([{ text: 'Body text with Romans 8:28.' }], [
      {
        path: 'word/_rels/document.xml.rels',
        content:
          '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/tracker.png" TargetMode="External"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="https://example.invalid/template.dotm" TargetMode="External"/>' +
          '</Relationships>',
      },
      { path: 'word/settings.xml', content: '<w:settings><w:attachedTemplate r:id="rId2"/></w:settings>' },
    ]);

    const parsed = await parseDocument(docx, 'tracked.docx');
    expect(parsed.candidates[0].body).toContain('Romans 8:28');
    expect(network, `import reached the network: ${network.join(', ')}`).toEqual([]);
  });

  it('never opens a macro or an embedded object', async () => {
    const opened: string[] = [];
    const docx = await makeDocx([{ text: 'Harmless text.' }], [
      { path: 'word/vbaProject.bin', content: encoder.encode('macro bytes') },
      { path: 'word/embeddings/oleObject1.bin', content: encoder.encode('ole bytes') },
    ]);

    // Prove it by watching which members the reader is even asked for.
    await readZipLimited(docx, {
      only: (path) => {
        opened.push(path);
        return path === 'word/document.xml';
      },
    });

    expect(opened).toContain('word/vbaProject.bin');
    // Considered, and refused: the macro is never inflated or decoded.
    const paragraphs = await parseDocx(docx);
    expect(paragraphs.map((p) => p.text).join(' ')).toBe('Harmless text.');
    expect(network).toEqual([]);
  });
});

describe('imported text stays inert', () => {
  it('keeps script-like text as text, with no markup interpreted', async () => {
    const hostile = [
      '# Notes',
      '',
      '<script>window.__pwned = true</script>',
      '<img src=x onerror="window.__pwned = true">',
      '<iframe src="https://example.invalid"></iframe>',
      '[a link](javascript:alert(1))',
      '',
      '# Second',
      '',
      'Ordinary text.',
    ].join('\n');

    const parsed = await parseDocument(bytes(hostile), 'hostile.md');
    const body = parsed.candidates.map((candidate) => candidate.body).join('\n');

    // Preserved verbatim as characters — never parsed, never executed.
    expect(body).toContain('<script>');
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
    expect(network).toEqual([]);
  });

  it('does not expand XML entities in a Word document', async () => {
    // A billion-laughs payload. The parser resolves only the five entities it
    // writes itself, so a declared entity is left as the literal text it is.
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">]>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:t>&lol2;</w:t></w:r></w:p></w:body></w:document>';

    const { createZip } = await import('../export/zip');
    const docx = await createZip([{ path: 'word/document.xml', content: bomb }]);

    const paragraphs = await parseDocx(docx);
    expect(paragraphs[0].text).toBe('&lol2;');
    expect(network).toEqual([]);
  });
});

describe('decompression limits', () => {
  it('refuses an archive whose single member inflates past the per-entry ceiling', async () => {
    const bomb = await makeZipBomb(4 * 1024 * 1024);
    // Compressed, this is tiny — which is exactly why a compressed-size check
    // would wave it through.
    expect(bomb.byteLength).toBeLessThan(200 * 1024);

    await expect(
      readZipLimited(bomb, { maxEntryBytes: 64 * 1024, maxTotalBytes: 10 * 1024 * 1024 }),
    ).rejects.toThrow(/expands to more than/i);
  });

  /**
   * It must stop WHILE inflating, not after.
   *
   * There are two ceilings in that reader and only one of them protects the
   * browser: aborting the stream partway means a bomb costs the budget, while
   * noticing afterwards means it has already been allocated in full. Deleting
   * the early check left every other test in this file green, so it is asserted
   * directly.
   */
  it('stops partway through rather than inflating the whole bomb first', async () => {
    const bomb = await makeZipBomb(4 * 1024 * 1024);
    const error = await readZipLimited(bomb, {
      maxEntryBytes: 64 * 1024,
      maxTotalBytes: 10 * 1024 * 1024,
    }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(DecompressionLimit);
    expect(
      (error as DecompressionLimit).stoppedEarly,
      'the whole payload was inflated before it was refused',
    ).toBe(true);
  });

  it('refuses an archive whose members are small alone but vast together', async () => {
    const { createZip } = await import('../export/zip');
    // Each member is under the per-entry ceiling; together they are not.
    const many = await createZip(
      Array.from({ length: 12 }, (_, i) => ({
        path: `word/part${i}.xml`,
        content: encoder.encode('B'.repeat(256 * 1024)),
      })),
    );

    await expect(
      readZipLimited(many, { maxEntryBytes: 512 * 1024, maxTotalBytes: 1024 * 1024 }),
    ).rejects.toThrow(/expands to more than/i);
  });

  it('refuses an archive with an absurd number of members', async () => {
    const { createZip } = await import('../export/zip');
    const many = await createZip(
      Array.from({ length: 40 }, (_, i) => ({ path: `f${i}.xml`, content: 'x' })),
    );
    await expect(readZipLimited(many, { maxEntries: 10 })).rejects.toThrow(/more than a document/i);
  });

  it('reads an ordinary document without complaint', async () => {
    const docx = await makeDocx([{ text: 'Perfectly normal.' }]);
    const entries = await readZipLimited(docx, { only: (p) => p === 'word/document.xml' });
    examinedAtLeast(entries.length, 1, 'members read from a normal document');
  });
});

describe('provenance records a filename, never a path', () => {
  // Written with neutral directory names rather than a real home path: the
  // property under test is "strip every directory component", which /a/b tests
  // exactly as well, and a literal home-rooted path in committed source is what
  // scripts/__tests__/no-absolute-paths.test.mjs exists to stop.
  const PATHS: Array<[string, string]> = [
    ['/one/two/sermons.docx', 'sermons.docx'],
    ['D:\\one\\two\\sermons.docx', 'sermons.docx'],
    ['..\\..\\etc\\passwd.txt', 'passwd.txt'],
    ['../../../secret.md', 'secret.md'],
    ['notes.txt', 'notes.txt'],
  ];

  for (const [given, expected] of PATHS) {
    it(`reduces ${JSON.stringify(given)} to ${JSON.stringify(expected)}`, () => {
      expect(safeFilename(given)).toBe(expected);
    });
  }

  it('strips control characters and never yields an empty name', () => {
    expect(safeFilename('a\u0000b.txt')).toBe('ab.txt');
    expect(safeFilename('   ')).toBe('imported file');
    expect(safeFilename('..')).toBe('imported file');
  });

  it('writes only the basename into an entry\u2019s provenance', async () => {
    const parsed = await parseDocument(bytes('Some notes.'), '/one/two/diary.txt');
    expect(parsed.filename).toBe('diary.txt');

    const { candidateToEntry } = await import('./candidates');
    const entry = candidateToEntry(parsed.candidates[0], parsed, '2026-01-01T00:00:00.000Z', 0);
    expect(entry.source?.filename).toBe('diary.txt');
    // Not one directory component survives anywhere in the written record.
    expect(JSON.stringify(entry)).not.toContain('/one/');
    expect(JSON.stringify(entry)).not.toContain('two');
  });
});
