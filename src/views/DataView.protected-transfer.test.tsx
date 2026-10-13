import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { PlatformProvider } from '../platform/provider';
import { webPlatform } from '../platform/web';
import { DexieStorageProvider } from '../storage/db';
import { loadSections } from '../app/sections';
import DataView from './DataView';
import type { PickResult } from '../platform/ports';

await loadSections();
const bytes = new Uint8Array(readFileSync('src/export/test-fixtures/protected-v1.lwc'));
const journey = JSON.parse(readFileSync('src/export/test-fixtures/protected-v1.journey.json', 'utf8'));
const { password } = JSON.parse(readFileSync('src/export/test-fixtures/protected-v1.metadata.json', 'utf8'));
let db: DexieStorageProvider;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  db = new DexieStorageProvider('protected-view-'+crypto.randomUUID()); await db.open();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function renderView() {
  return render(<PlatformProvider platform={{...webPlatform, picker:{presentsOwnUI:true,pick:async()=>({status:'picked',file:{name:'fictional.lwc',bytes}})}}}>
    <RouterProvider><StorageContextProvider provider={db}><DataView /></StorageContextProvider></RouterProvider>
  </PlatformProvider>);
}
async function choose() {
  fireEvent.click(await screen.findByLabelText('Journal file to read'));
  return screen.findByLabelText('Transfer password');
}
describe('protected file import is wired into the journal screen', () => {
  it('ignores native picker results that resolve after a newer request', async () => {
    const resolvers:((result:PickResult)=>void)[]=[];
    render(<PlatformProvider platform={{...webPlatform,picker:{presentsOwnUI:true,pick:()=>new Promise<PickResult>(resolve=>resolvers.push(resolve))}}}><RouterProvider><StorageContextProvider provider={db}><DataView /></StorageContextProvider></RouterProvider></PlatformProvider>);
    const input=await screen.findByLabelText('Journal file to read');
    fireEvent.click(input);fireEvent.click(input);
    const plain=new TextEncoder().encode(JSON.stringify(journey));
    await act(async()=>resolvers[1]({status:'picked',file:{name:'latest.json',bytes:plain}}));
    await screen.findByText('What this would do');
    await act(async()=>resolvers[0]({status:'picked',file:{name:'earlier.lwc',bytes}}));
    expect(screen.queryByLabelText('Transfer password')).not.toBeInTheDocument();
    expect(screen.getByText(/latest.json holds 1 entry/)).toBeInTheDocument();
  });

  it('never replaces the latest selected file with an earlier slow DOM read', async () => {
    render(<PlatformProvider platform={webPlatform}><RouterProvider><StorageContextProvider provider={db}><DataView /></StorageContextProvider></RouterProvider></PlatformProvider>);
    const input=await screen.findByLabelText('Journal file to read');
    let finish!: (bytes:ArrayBuffer)=>void;
    const first={name:'earlier.lwc',size:bytes.length,arrayBuffer:()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;})};
    const plain=new TextEncoder().encode(JSON.stringify(journey));
    const latest={name:'latest.json',size:plain.length,arrayBuffer:async()=>plain.buffer};
    fireEvent.change(input,{target:{files:[first]}});
    fireEvent.change(input,{target:{files:[latest]}});
    await screen.findByText('What this would do');
    await act(async()=>{finish(bytes.slice().buffer);});
    expect(screen.queryByLabelText('Transfer password')).not.toBeInTheDocument();
    expect(screen.getByText(/latest.json holds 1 entry/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Merge 1 entry'}));
    await waitFor(async()=>expect(await db.listEntries()).toHaveLength(1));
  });

  it('refuses a destructive restore if new writing appears after the reviewed preview', async () => {
    renderView(); fireEvent.change(await choose(),{target:{value:password}});
    fireEvent.click(screen.getByRole('button',{name:'Unlock and review'}));
    await screen.findByText('What this would do');
    const newer = await db.createEntry({notes:'Fictional writing after preview',title:'New writing'});
    fireEvent.click(screen.getByRole('radio',{name:/Replace — destructive/}));
    fireEvent.click(screen.getByRole('button',{name:'Delete everything and import 1 entry'}));
    await screen.findAllByText(/The import did not finish/);
    expect(await db.listEntries()).toEqual([newer]);
    expect(await db.listDrafts()).toHaveLength(0);
  });

  it('unlocks locally, previews before write, and reports committed entries and drafts', async () => {
    renderView(); const input=await choose(); await waitFor(()=>expect(input).toHaveFocus());
    expect(await db.listEntries()).toHaveLength(0);
    fireEvent.change(input,{target:{value:password}});
    fireEvent.click(screen.getByRole('button',{name:'Unlock and review'}));
    await screen.findByText('What this would do');
    expect(screen.queryByLabelText('Transfer password')).not.toBeInTheDocument();
    expect(await db.listEntries()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button',{name:'Merge 1 entry'}));
    await waitFor(async()=>expect(await db.listEntries()).toHaveLength(1));
    expect(await db.listDrafts()).toHaveLength(1);
    expect(await screen.findAllByText(/Merged fictional.lwc: 1 entry and 1 unfinished draft written/)).toHaveLength(2);
  });
  it('clears a wrong password, preserves the encrypted original for retry, and cancels without writing', async () => {
    renderView(); fireEvent.change(await choose(),{target:{value:'incorrect'}});
    fireEvent.click(screen.getByRole('button',{name:'Unlock and review'}));
    await screen.findAllByText(/Could not unlock this file/);
    expect(screen.getByLabelText('Transfer password')).toHaveValue('');
    fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
    expect(screen.queryByLabelText('Transfer password')).not.toBeInTheDocument();
    expect(await db.listEntries()).toHaveLength(0);
    expect(await db.listDrafts()).toHaveLength(0);
  });
});
