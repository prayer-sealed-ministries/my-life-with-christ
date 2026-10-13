// @vitest-environment node
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseImport, applyImport } from './importer';
import { ProtectedTransferPasswordRequired, unlockProtectedTransfer } from './protected-transfer';
import { DexieStorageProvider } from '../storage/db';
import { buildArchive } from './archive';

vi.stubGlobal('crypto', webcrypto);
const raw = JSON.parse(readFileSync(new URL('./test-fixtures/protected-v1.lwc', import.meta.url), 'utf8'));
const journey = JSON.parse(readFileSync(new URL('./test-fixtures/protected-v1.journey.json', import.meta.url), 'utf8'));
const { password } = JSON.parse(readFileSync(new URL('./test-fixtures/protected-v1.metadata.json', import.meta.url), 'utf8'));

const changedByte = (value: string) => {
  const b = Buffer.from(value, 'base64'); b[0] ^= 1; return b.toString('base64');
};

describe('companion protected transfer v1', () => {
  it('requires a password after validating the encrypted envelope', async () => {
    await expect(parseImport(JSON.stringify(raw))).rejects.toBeInstanceOf(ProtectedTransferPasswordRequired);
  });
  it('opens the independently generated OpenSSL fixture with exact UTF-8 password bytes', async () => {
    expect(JSON.parse(await unlockProtectedTransfer(raw, password))).toEqual(journey);
    const parsed = await parseImport(JSON.stringify(raw), {}, password);
    expect(parsed.source).toBe('protected');
    expect(parsed.entries[0].notes).toBe(journey.entries[0].notes);
    expect(parsed.entries[0].reflection).toBe(journey.entries[0].reflection);
    expect(parsed.entries[0].prayer).toBe(journey.entries[0].prayer);
    expect(parsed.drafts).toHaveLength(1);
    expect(parsed.entries[0].anchors).toEqual(journey.entries[0].anchors);
  });
  it.each(['wrong password', password + ' ', password.normalize('NFD')])('refuses incorrect password bytes without exposing content (%#)', async (wrong) => {
    await expect(unlockProtectedTransfer(raw, wrong)).rejects.toThrow('Could not unlock this file');
  });
  it.each(['data', 'iv', 'salt'])('rejects tampered %s', async (key) => {
    await expect(unlockProtectedTransfer({ ...raw, [key]: changedByte(raw[key]) }, password)).rejects.toThrow('Could not unlock');
  });
  it.each([{version:2}, {iterations:1}, {iterations:999999999}, {cipher:'AES-CBC'}, {kdf:'PBKDF2-SHA1'}])('rejects unsupported parameters before password prompt: %j', async (patch) => {
    await expect(unlockProtectedTransfer({ ...raw, ...patch })).rejects.toThrow('not supported');
  });
  it.each([{salt:'AA=='}, {iv:'AA=='}, {data:'AAAA'}, {salt:raw.salt+'\n'}, {iv:'not-base64'}, {data:'A'.repeat(16*1024*1024)}])('rejects malformed or oversized data (%#)', async (patch) => {
    await expect(unlockProtectedTransfer({ ...raw, ...patch })).rejects.toThrow(/malformed|too large/);
  });
  it('rejects a whole oversized envelope before password work', async () => {
    await expect(parseImport(JSON.stringify({ ...raw, extra:'x'.repeat(16*1024*1024) }))).rejects.toThrow('16 MiB');
  });
  it('includes authenticated journal-level metadata in the review without claiming it is unsupported', async () => {
    const parsed = await parseImport(JSON.stringify(raw), {}, password);
    expect(parsed.envelopeMetadata).toEqual([{futureEnvelope:journey.futureEnvelope}]);
    expect(parsed.warnings).not.toContainEqual(expect.stringContaining('journal-level metadata'));
  });
  it('keeps entry/draft separation, handles repeat and changed imports, and round-trips an isolated backup', async () => {
    const db = new DexieStorageProvider('protected-sunday-'+crypto.randomUUID());
    await db.open();
    const parsed = await parseImport(JSON.stringify(raw), {}, password);
    const first = await applyImport(parsed, db);
    expect(first.imported).toBe(1); expect(first.draftsImported).toBe(1);
    const again = await applyImport(parsed, db);
    expect(again.imported).toBe(0); expect(again.draftsImported).toBe(0);
    const changed = structuredClone(parsed);
    changed.entries[0].notes += '\nFictional changed version.';
    changed.drafts[0].form.notes += '\nFictional changed draft.';
    const conflict = await applyImport(changed, db);
    expect(conflict.imported).toBe(1); expect(conflict.draftsImported).toBe(1);
    expect((await applyImport(changed, db)).imported).toBe(0);
    expect(await db.listEntries()).toHaveLength(2);
    expect(await db.listDrafts()).toHaveLength(2);
    const {entries,drafts,envelopeMetadata} = await db.readJournalSnapshot();
    expect(envelopeMetadata).toEqual([{futureEnvelope:journey.futureEnvelope}]);
    const archive = await buildArchive({ entries, drafts, envelopeMetadata, outlineBooks:[], topics:[], profile:'refs-only' });
    const restored = await parseImport(archive.bytes);
    expect(restored.entries).toEqual(entries);
    expect(restored.drafts).toEqual(drafts);
    expect(restored.envelopeMetadata).toEqual(envelopeMetadata);
  });
});
