import { describe, expect, it } from 'vitest';

import { ArchiveIntegrityError, parseImport } from './importer';

/** A minimal ZIP-shaped input whose EOCD advertises too many members. */
function excessiveMemberArchive(count: number): Uint8Array {
  const bytes = new Uint8Array(26);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint32(4, 0x06054b50, true);
  view.setUint16(12, count, true);
  view.setUint16(14, count, true);
  return bytes;
}

describe('journal archive resource limits', () => {
  it('rejects an excessive member count before walking or inflating the archive', async () => {
    const error = await parseImport(excessiveMemberArchive(10_001)).catch((cause) => cause);

    expect(error).toBeInstanceOf(ArchiveIntegrityError);
    expect((error as ArchiveIntegrityError).problems[0]?.detail).toMatch(/10[,.]?001 parts/i);
  });
});
