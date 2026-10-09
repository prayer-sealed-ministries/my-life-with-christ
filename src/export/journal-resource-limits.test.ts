import { describe, expect, it } from 'vitest';

import {
  MAX_JOURNAL_COMPRESSION_RATIO,
  MAX_JOURNAL_MEMBER_BYTES,
} from '../lib/journal-limits';
import { createZip, readZip, zipEntryText } from './zip';

const CENTRAL = 0x02014b50;

function centralOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    if (view.getUint32(offset, true) === CENTRAL) return offset;
  }
  throw new Error('test archive has no central directory');
}

describe('journal ZIP resource limits', () => {
  it('accepts a highly compressible legitimate long journal member', async () => {
    const content = `${'A long repeated reflection. '.repeat(40_000)}\n`;
    const archive = await createZip([{ path: 'data/journey.json', content }]);

    const [read] = await readZip(archive);

    expect(zipEntryText(read)).toBe(content);
  });

  it('rejects a declared oversized member before attempting decompression', async () => {
    const archive = (await createZip([{ path: 'data/journey.json', content: '{}' }])).slice();
    const offset = centralOffset(archive);
    new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
      .setUint32(offset + 24, MAX_JOURNAL_MEMBER_BYTES + 1, true);

    await expect(readZip(archive)).rejects.toThrow(/supported limit/i);
  });

  it('rejects impossible compression metadata below the absolute size ceiling', async () => {
    const archive = (await createZip([{ path: 'data/journey.json', content: '{}' }])).slice();
    const offset = centralOffset(archive);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    view.setUint32(offset + 20, 1, true);
    view.setUint32(offset + 24, MAX_JOURNAL_COMPRESSION_RATIO + 1, true);

    await expect(readZip(archive)).rejects.toThrow(/compression ratio/i);
  });

  it('rejects an out-of-bounds local header offset with a controlled error', async () => {
    const archive = (await createZip([{ path: 'data/journey.json', content: '{}' }])).slice();
    const offset = centralOffset(archive);
    new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
      .setUint32(offset + 42, 0xfffffff0, true);

    await expect(readZip(archive)).rejects.toThrow(/damaged/i);
  });
});
