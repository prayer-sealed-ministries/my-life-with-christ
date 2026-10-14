// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildArchive } from './archive';
import { parseImport } from './importer';
import { createZip, readZip, sha256 } from './zip';

const fixture = JSON.parse(readFileSync('src/export/test-fixtures/protected-v1.journey.json', 'utf8'));
const payload = { ...fixture, entries: [{ ...fixture.entries[0], notes: 'ENCODING_SENTINEL' }] };
const corruptText = (bytes: Uint8Array) => {
  const copy = bytes.slice();
  const index = Buffer.from(copy).indexOf('ENCODING_SENTINEL');
  expect(index, 'the corruption probe must actually reach journal writing').toBeGreaterThan(0);
  copy[index] = 0xff;
  return copy;
};

describe('journal text must decode without replacing unreadable writing', () => {
  it('refuses invalid UTF-8 in a plain journal instead of importing a replacement character', async () => {
    const bytes = corruptText(new TextEncoder().encode(JSON.stringify(payload)));
    await expect(parseImport(bytes)).rejects.toThrow(/UTF-8/);
  });

  it('refuses invalid canonical UTF-8 even when an archive has a matching manifest', async () => {
    const archive = await buildArchive({ entries: payload.entries, drafts: payload.drafts, outlineBooks: [], topics: [], profile: 'refs-only' });
    const members = await readZip(archive.bytes);
    const canonical = members.find((member) => member.path === 'data/journey.json')!;
    canonical.bytes = corruptText(canonical.bytes);
    const claims = await Promise.all(members.filter((member) => member.path !== 'MANIFEST.txt').map(async (member) =>
      `${await sha256(member.bytes)}  ${member.bytes.length}  ${member.path}`));
    const bytes = await createZip(members.map((member) => ({ path: member.path, content: member.path === 'MANIFEST.txt' ? claims.join('\n') : member.bytes })));
    await expect(parseImport(bytes)).rejects.toThrow(/UTF-8/);
  });

  it('retains a real replacement character and non-ASCII writing when the bytes are valid', async () => {
    const notes = 'Fictional café / café / 🙏 / �';
    const parsed = await parseImport(new TextEncoder().encode(JSON.stringify({ ...payload, entries: [{ ...payload.entries[0], notes }] })));
    expect(parsed.entries[0].notes).toBe(notes);
  });
});
