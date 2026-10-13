import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dismissWelcome } from './seed';
const dir = 'src/export/test-fixtures/';
const { password } = JSON.parse(readFileSync(dir+'protected-v1.metadata.json','utf8'));
const fixture = JSON.parse(readFileSync(dir+'protected-v1.journey.json','utf8'));

test('protected companion file previews, imports, survives reload and skips duplicates without network egress', async ({page},testInfo)=>{
  const offsite:string[]=[];
  page.on('request',r=>{if(!r.url().startsWith('http://localhost:4173')&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))offsite.push(r.url());});
  await dismissWelcome(page);
  await page.goto('#/data');
  await page.getByLabel('Journal file to read').setInputFiles(dir+'protected-v1.lwc');
  await expect(page.getByLabel('Transfer password')).toBeFocused();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:testInfo.outputPath('protected-import.png'),fullPage:true});
  await page.getByLabel('Transfer password').fill(password);
  await page.getByRole('button',{name:'Unlock and review'}).click();
  await expect(page.getByText('What this would do',{exact:true})).toBeVisible();
  await expect(page.getByText(/additional journal-level metadata/)).toBeVisible();
  await page.getByRole('button',{name:'Merge 1 entry',exact:true}).click();
  await expect(page.locator('main p').filter({hasText:/Merged protected-v1.lwc: 1 entry and 1 unfinished draft written/}).first()).toBeVisible();
  await page.reload();
  await page.getByLabel('Journal file to read').setInputFiles(dir+'protected-v1.lwc');
  await page.getByLabel('Transfer password').fill(password);
  await page.getByRole('button',{name:'Unlock and review'}).click();
  await page.getByRole('button',{name:'Merge 1 entry',exact:true}).click();
  await expect(page.locator('main p').filter({hasText:/0 entries and 0 unfinished drafts written; 1 entry and 1 draft already present and skipped/}).first()).toBeVisible();
  // Verify the actual persisted records, not a success toast alone.
  const state=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('journey');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const tx=db.transaction(['entries','drafts'],'readonly');
    const all=(name:string)=>new Promise<unknown[]>((resolve,reject)=>{const r=tx.objectStore(name).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return {entries:await all('entries'),drafts:await all('drafts')};
  });
  expect(state.entries).toHaveLength(1); expect(state.drafts).toHaveLength(1);
  expect(state.entries[0]).toMatchObject({id:fixture.entries[0].id,notes:fixture.entries[0].notes,reflection:fixture.entries[0].reflection,prayer:fixture.entries[0].prayer,anchors:fixture.entries[0].anchors});
  expect(offsite).toEqual([]);
});

test('a wrong password and cancellation never create writing',async({page})=>{
  await dismissWelcome(page);await page.goto('#/data');
  await page.getByLabel('Journal file to read').setInputFiles(dir+'protected-v1.lwc');
  await page.getByLabel('Transfer password').fill('Fictional wrong password');
  await page.getByRole('button',{name:'Unlock and review'}).click();
  await expect(page.locator('main p').filter({hasText:/Could not unlock this file/}).first()).toBeVisible();
  await expect(page.getByLabel('Transfer password')).toHaveValue('');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByLabel('Transfer password')).toHaveCount(0);
  await expect(page.getByText('What this would do',{exact:true})).toHaveCount(0);
});
