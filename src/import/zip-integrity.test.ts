/**
 * Two descriptions of one archive, and the bytes they describe.
 *
 * A ZIP says everything twice: once in the central directory, once in each
 * local header. A reader that trusts whichever it happens to consult can be
 * shown one member by its checks and hand a different one to the parser, which
 * is the oldest trick in the format. And a member whose bytes were damaged in
 * transit should be reported as damaged rather than interpreted.
 *
 * Every archive here is built in code and is fictional.
 */
import { describe, expect, it } from 'vitest';

import { crc32, readZipLimited } from './zip-limits';
import { makeDeflatedZip, makeDocx } from './fixtures';
import { inspectDocxPackage } from './document-type';

const encoder = new TextEncoder();
const body = () => encoder.encode('FICTIONAL-DOC the quick brown fox'.repeat(8));

/** Find a little-endian uint32 signature and return every offset it is at. */
function offsetsOf(data: Uint8Array, signature: number): number[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const found: number[] = [];
  for (let i = 0; i + 4 <= data.length; i += 1) {
    if (view.getUint32(i, true) === signature) found.push(i);
  }
  return found;
}

const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

describe('CRC', () => {
  it('computes the ordinary ZIP checksum', () => {
    // The standard check value for "123456789", so the table is right rather
    // than merely self-consistent.
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('refuses a member whose bytes are not what the archive claims', async () => {
    const archive = await makeDeflatedZip([{ path: 'word/document.xml', content: body() }]);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    // Corrupt the declared checksum rather than the data, so the member still
    // inflates to exactly the declared length: size agreement alone would pass
    // this, which is the whole reason a checksum is also required.
    const central = offsetsOf(archive, CENTRAL)[0];
    view.setUint32(central + 16, 0xdeadbeef, true);

    await expect(
      readZipLimited(archive, { only: (path) => path === 'word/document.xml' }),
    ).rejects.toThrow(/damaged/i);
  });
});

describe('the central directory and the local headers must agree', () => {
  it('refuses an archive whose two descriptions name different members', async () => {
    const archive = await makeDeflatedZip([{ path: 'word/document.xml', content: body() }]);
    const local = offsetsOf(archive, LOCAL)[0];
    // Same length, different name: the central directory says document.xml and
    // the local header says docuMeNt.xmL — one reader would take one, another
    // the other, and that disagreement is the vulnerability.
    const renamed = encoder.encode('word/DOCUMENT.xml');
    archive.set(renamed, local + 30);

    await expect(
      readZipLimited(archive, { only: (path) => path === 'word/document.xml' }),
    ).rejects.toThrow(/disagree/i);
  });

  it('refuses an archive whose two descriptions disagree about compression', async () => {
    const archive = await makeDeflatedZip([{ path: 'word/document.xml', content: body() }]);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const local = offsetsOf(archive, LOCAL)[0];
    view.setUint16(local + 8, 0, true); // local says stored, central says deflate

    await expect(
      readZipLimited(archive, { only: (path) => path === 'word/document.xml' }),
    ).rejects.toThrow(/disagree/i);
  });
});

describe('features this reader does not implement', () => {
  it('refuses a split archive rather than reading the volume it has', async () => {
    const archive = await makeDeflatedZip([{ path: 'word/document.xml', content: body() }]);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const eocd = offsetsOf(archive, 0x06054b50)[0];
    view.setUint16(eocd + 4, 1, true); // "this is disk 1"

    await expect(readZipLimited(archive)).rejects.toThrow(/split across volumes/i);
  });

  it('refuses ZIP64 rather than reading its sentinels as values', async () => {
    const archive = await makeDeflatedZip([{ path: 'word/document.xml', content: body() }]);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const eocd = offsetsOf(archive, 0x06054b50)[0];
    view.setUint16(eocd + 10, 0xffff, true);

    await expect(readZipLimited(archive)).rejects.toThrow(/ZIP64/i);
  });
});

describe('a damaged Word document is reported as damaged', () => {
  it('does not interpret a package whose body failed its checksum', async () => {
    const docx = await makeDocx([{ text: 'FICTIONAL-DOC handout' }]);
    const central = offsetsOf(docx, CENTRAL);
    const view = new DataView(docx.buffer, docx.byteOffset, docx.byteLength);
    // Corrupt every member's checksum; whichever is read first must fail.
    for (const at of central) view.setUint32(at + 16, 0x0badf00d, true);

    const verdict = await inspectDocxPackage(docx);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/damaged/i);
  });
});
