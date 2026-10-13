// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DexieStorageProvider } from '../storage/db';
import { applyImport, parseImport, previewImport } from './importer';
import { stableJson } from '../storage/semantics';
import { sha256 } from './zip';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync('src/export/test-fixtures/protected-v1.journey.json','utf8'));
const incoming = async (entries: unknown[], drafts: unknown[] = []) => parseImport(JSON.stringify({format:'journey-export',version:1,entries,drafts}));
const db = async () => {const value=new DexieStorageProvider('conflict-reservation-'+crypto.randomUUID());await value.open();return value;};

describe('merge conflict ids reserve the entire incoming inventory',()=>{
  it('preserves both incoming entries even when the later id matches an earlier generated conflict id',async()=>{
    const storage=await db();
    const parsed=await incoming([fixture.entries[0]]);
    const a=parsed.entries[0];
    const b={...a,id:`${a.id}~conflict-${(await sha256(stableJson(a))).slice(0,16)}`,notes:'Fictional second independent entry'};
    await storage.putEntries([{...a,notes:'Fictional local original'}]);
    parsed.entries.push(b);
    const result=await applyImport(parsed,storage);
    const saved=await storage.listEntries();
    expect(result.imported).toBe(2);expect(saved).toHaveLength(3);
    expect(saved.map(e=>e.notes)).toEqual(expect.arrayContaining([a.notes,b.notes,'Fictional local original']));
    const repeat=await applyImport(parsed,storage);
    expect(repeat.imported).toBe(0);expect(repeat.entriesSkipped).toBe(2);
    const preview=previewImport(parsed,await storage.listEntries());
    expect(preview.unchanged).toBe(2);expect(preview.conflicts).toHaveLength(0);
    expect(await storage.listEntries()).toHaveLength(3);
  });
  it('preserves later incoming drafts when a generated conflict id would collide',async()=>{
    const storage=await db();
    const parsed=await incoming([],fixture.drafts);
    const a=parsed.drafts[0];
    const b={...a,id:`${a.id}~conflict-${(await sha256(stableJson(a))).slice(0,16)}`,form:{...a.form,notes:'Fictional independent draft'}};
    await storage.putDraft({...a,form:{...a.form,notes:'Fictional local draft'}});
    parsed.drafts.push(b);
    const result=await applyImport(parsed,storage);
    const saved=await storage.listDrafts();
    expect(result.draftsImported).toBe(2);expect(saved).toHaveLength(3);
    expect(saved.map(d=>d.form.notes)).toEqual(expect.arrayContaining([a.form.notes,b.form.notes,'Fictional local draft']));
    expect((await applyImport(parsed,storage)).draftsImported).toBe(0);
  });
  it('retains an existing conflict extension value in entry and draft provenance',async()=>{
    const storage=await db();
    const parsed=await incoming(fixture.entries,fixture.drafts);
    const previous={originalId:'older-record',extension:'Fictional opaque provenance'};
    parsed.entries[0]._unmigrated={journeyImportConflict:previous};
    parsed.drafts[0]._unmigrated={journeyImportConflict:previous};
    await storage.putEntries([{...parsed.entries[0],notes:'local differs'}]);
    await storage.putDraft({...parsed.drafts[0],form:{...parsed.drafts[0].form,notes:'local differs'}});
    await applyImport(parsed,storage);
    const importedEntry=(await storage.listEntries()).find(e=>e.id!==parsed.entries[0].id)!;
    const importedDraft=(await storage.listDrafts()).find(d=>d.id!==parsed.drafts[0].id)!;
    expect(importedEntry._unmigrated?.journeyImportConflict).toEqual({originalId:parsed.entries[0].id,previous});
    expect(importedDraft._unmigrated?.journeyImportConflict).toEqual({originalId:parsed.drafts[0].id,previous});
  });
});
