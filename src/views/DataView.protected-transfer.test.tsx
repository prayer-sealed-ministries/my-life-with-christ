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
import type { PickedFile } from '../platform/ports';
import type { JournalSnapshot } from '../storage/journal';
import { trackPendingJournalWrite, settlePendingJournalWrites } from '../storage/pending';

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
  return render(<PlatformProvider platform={{...webPlatform, picker:{presentsOwnUI:true,pick:async()=>({name:'fictional.lwc',bytes})}}}>
    <RouterProvider><StorageContextProvider provider={db}><DataView /></StorageContextProvider></RouterProvider>
  </PlatformProvider>);
}
async function choose() {
  fireEvent.click(await screen.findByLabelText('Journal file to read'));
  return screen.findByLabelText('Transfer password');
}
describe('protected file import is wired into the journal screen', () => {
  it.each(['plain','protected'])('keeps deliberate focus during a slow %s DOM file read', async (kind) => {
    render(<PlatformProvider platform={webPlatform}><RouterProvider><StorageContextProvider provider={db}><DataView /></StorageContextProvider></RouterProvider></PlatformProvider>);
    const input=await screen.findByLabelText('Journal file to read');
    const contents=kind==='protected'?bytes:new TextEncoder().encode(JSON.stringify(journey));
    let finish!: (value:ArrayBuffer)=>void;
    input.focus();
    fireEvent.change(input,{target:{files:[{name:kind==='protected'?'slow.lwc':'slow.json',size:contents.length,arrayBuffer:()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;})}]}});
    const elsewhere=screen.getByRole('button',{name:'Export everything'});elsewhere.focus();
    await act(async()=>finish(contents.slice().buffer));
    if(kind==='protected')await screen.findByLabelText('Transfer password');
    else await screen.findByText('What this would do');
    expect(elsewhere).toHaveFocus();
  });

  it('keeps deliberate focus while a native picker is outstanding', async () => {
    let finish!: (result:PickedFile | null)=>void;
    render(<PlatformProvider platform={{...webPlatform,picker:{presentsOwnUI:true,pick:()=>new Promise<PickedFile | null>(resolve=>{finish=resolve;})}}}><RouterProvider><StorageContextProvider provider={db}><DataView /></StorageContextProvider></RouterProvider></PlatformProvider>);
    const input=await screen.findByLabelText('Journal file to read');input.focus();fireEvent.click(input);
    const elsewhere=screen.getByRole('button',{name:'Export everything'});elsewhere.focus();
    await act(async()=>finish({name:'native.json',bytes:new TextEncoder().encode(JSON.stringify(journey))}));
    await screen.findByText('What this would do');
    expect(elsewhere).toHaveFocus();
  });

  it('imports a metadata-only journal after explicit preview and keeps it on repeat', async () => {
    const incoming = {format:'journey-export',version:1,exportedAt:'2026-10-18T12:00:00Z',entries:[],drafts:[],futureJournal:{fictional:'Sunday metadata'}};
    render(<PlatformProvider platform={{...webPlatform,picker:{presentsOwnUI:true,pick:async()=>({name:'metadata.json',bytes:new TextEncoder().encode(JSON.stringify(incoming))})}}}><RouterProvider><StorageContextProvider provider={db}><DataView /></StorageContextProvider></RouterProvider></PlatformProvider>);
    fireEvent.click(await screen.findByLabelText('Journal file to read'));
    await screen.findByText('What this would do');
    expect((await db.readJournalSnapshot()).envelopeMetadata).toEqual([]);
    expect(screen.getByText(/Additional journal-level metadata will be preserved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Merge journal metadata'}));
    await screen.findAllByText(/Journal-level metadata was preserved/);
    expect((await db.readJournalSnapshot()).envelopeMetadata).toEqual([{futureJournal:incoming.futureJournal}]);
    fireEvent.click(screen.getByLabelText('Journal file to read'));
    await screen.findByText('What this would do');
    fireEvent.click(screen.getByRole('button',{name:'Merge journal metadata'}));
    await screen.findAllByText(/Journal-level metadata was preserved/);
    expect((await db.readJournalSnapshot()).envelopeMetadata).toEqual([{futureJournal:incoming.futureJournal}]);
  });

  it('refuses replacement when only journal metadata changes after preview', async () => {
    renderView(); fireEvent.change(await choose(),{target:{value:password}});
    fireEvent.click(screen.getByRole('button',{name:'Unlock and review'}));
    await screen.findByText('What this would do');
    await db.replaceJournal([],[],undefined,[{futureJournal:'Later fictional metadata'}]);
    fireEvent.click(screen.getByRole('radio',{name:/Replace — destructive/}));
    fireEvent.click(screen.getByRole('button',{name:'Delete everything and import 1 entry'}));
    await screen.findAllByText(/The import did not finish/);
    expect(await db.listEntries()).toEqual([]);
    expect((await db.readJournalSnapshot()).envelopeMetadata).toEqual([{futureJournal:'Later fictional metadata'}]);
  });

  it('does not steal focus if the reader moves elsewhere while unlocking', async () => {
    renderView(); const input = await choose();
    const snapshot = await db.readJournalSnapshot();
    let finish!: (value: JournalSnapshot) => void;
    vi.spyOn(db,'readJournalSnapshot').mockImplementationOnce(()=>new Promise<JournalSnapshot>(resolve=>{finish=resolve;}));
    fireEvent.change(input,{target:{value:password}});
    fireEvent.click(screen.getByRole('button',{name:'Unlock and review'}));
    const elsewhere = screen.getByRole('button',{name:'Export everything'});
    elsewhere.focus();
    await waitFor(()=>expect(finish).toBeTypeOf('function'));
    await act(async()=>finish(snapshot));
    await screen.findByText('What this would do');
    expect(elsewhere).toHaveFocus();
  });

  it('ignores native picker results that resolve after a newer request', async () => {
    const resolvers:((result:PickedFile | null)=>void)[]=[];
    render(<PlatformProvider platform={{...webPlatform,picker:{presentsOwnUI:true,pick:()=>new Promise<PickedFile | null>(resolve=>resolvers.push(resolve))}}}><RouterProvider><StorageContextProvider provider={db}><DataView /></StorageContextProvider></RouterProvider></PlatformProvider>);
    const input=await screen.findByLabelText('Journal file to read');
    fireEvent.click(input);fireEvent.click(input);
    const plain=new TextEncoder().encode(JSON.stringify(journey));
    await act(async()=>resolvers[1]({name:'latest.json',bytes:plain}));
    await screen.findByText('What this would do');
    await act(async()=>resolvers[0]({name:'earlier.lwc',bytes}));
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

  it('does not start a confirmed restore after unmount while earlier writing settles', async () => {
    const view = renderView(); fireEvent.change(await choose(), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock and review' }));
    await screen.findByText('What this would do');
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    trackPendingJournalWrite(held);
    const replace = vi.spyOn(db, 'replaceJournal');
    const read = vi.spyOn(db, 'readJournalSnapshot');
    try {
      fireEvent.click(screen.getByRole('radio', { name: /Replace — destructive/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete everything and import 1 entry' }));
      expect(read).not.toHaveBeenCalled();
      view.unmount();
      await act(async () => { release(); await settlePendingJournalWrites(); });
      expect(read).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(await db.listEntries()).toEqual([]);
      expect(await db.listDrafts()).toEqual([]);
    } finally {
      release(); await settlePendingJournalWrites();
    }
  });

  it('waits for writing queued after preview before confirming a destructive restore', async () => {
    renderView(); fireEvent.change(await choose(), { target: { value: password } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock and review' }));
    await screen.findByText('What this would do');
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const writing = held.then(() => db.createEntry({ title: 'Fictional later writing', notes: 'Keep me' }));
    trackPendingJournalWrite(writing.then(() => undefined));
    const read = vi.spyOn(db, 'readJournalSnapshot');
    try {
      fireEvent.click(screen.getByRole('radio', { name: /Replace — destructive/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete everything and import 1 entry' }));
      // No timing guess: without the barrier applyImport starts its snapshot
      // read synchronously during the click, before this assertion.
      expect(read).not.toHaveBeenCalled();
      await act(async () => { release(); await writing; });
      await screen.findAllByText(/The preview below has been refreshed/);
      expect((await db.listEntries()).map((entry) => entry.notes)).toEqual(['Keep me']);
      expect(await db.listDrafts()).toEqual([]);
    } finally {
      release(); await writing; await settlePendingJournalWrites();
    }
  });

  it('unlocks locally, previews before write, and reports committed entries and drafts', async () => {
    renderView(); const input=await choose(); await waitFor(()=>expect(input).toHaveFocus());
    expect(await db.listEntries()).toHaveLength(0);
    fireEvent.change(input,{target:{value:password}});
    fireEvent.click(screen.getByRole('button',{name:'Unlock and review'}));
    await screen.findByText('What this would do');
    expect(screen.queryByLabelText('Transfer password')).not.toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole('heading',{name:'What this would do'})).toHaveFocus());
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
