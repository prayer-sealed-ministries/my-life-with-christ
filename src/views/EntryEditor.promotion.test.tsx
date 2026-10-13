/** An intentional Save may retire a draft, never opaque imported writing. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EntryEditor from './EntryEditor';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import { settlePendingJournalWrites } from '../storage/pending';
import { buildArchive, buildContext } from '../export/archive';
import { applyImport, parseImport } from '../export/importer';
import { renderBook } from '../export/book';
import { PRIVATE_BY_DEFAULT, buildSharedEntryDocument, renderSharedEntryMarkdown, renderSharedEntryText } from '../share/entry-document';
import { READING } from '../export/fixtures';
import type { EntryDraft } from '../types';

const WHEN = '2026-10-11T12:00:00.000Z';
const OPAQUE = 'HIDDEN-PROMOTION-METADATA';
const draft = () => ({
  id: 'fictional-imported-draft', createdAt: WHEN, updatedAt: WHEN,
  futureDraft: { meaning: OPAQUE }, _unmigrated: { futureDraft: { older: true } },
  form: {
    kind: 'sermon' as const, title: 'Fictional promotion', date: '2026-10-11', place: '', speaker: '',
    sermonSeries: '', notes: 'Fictional current writing', reflection: 'PRIVATE-PROMOTION-REFLECTION',
    prayer: 'PRIVATE-PROMOTION-PRAYER', tagsText: ' fictional ,, ', links: [], anchors: [],
    forDescendants: false, scriptureRefs: [], sourceMaterial: null, futureForm: { original: OPAQUE },
  },
});
let db: DexieStorageProvider;
let counter = 0;
const dbName = () => `fictional-draft-promotion-${counter}`;
beforeEach(async () => {
  window.location.hash = '#/entry/new';
  counter += 1;
  db = new DexieStorageProvider(dbName());
  await db.open();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const mount = (props: { entryId?: string; draftParam?: string }) => render(
  <RouterProvider><StorageContextProvider provider={db}><EntryEditor {...props} /></StorageContextProvider></RouterProvider>,
);
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

async function completedEntry() {
  await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));
  await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
  return (await db.listEntries())[0];
}


function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function flushDraft() {
  act(() => { window.dispatchEvent(new Event('pagehide')); });
}

describe('metadata-bearing draft completion', () => {
  it('keeps the exact durable source snapshot through Save, full archive and isolated recovery', async () => {
    const original = draft();
    await db.putDraft(original);
    let durableAtSave: EntryDraft | undefined;
    const create = db.createEntry.bind(db);
    vi.spyOn(db, 'createEntry').mockImplementation(async (input) => {
      durableAtSave = await db.getDraft(original.id);
      return create(input);
    });
    mount({ draftParam: original.id });
    await screen.findByLabelText('Notes');
    save();
    const entry = await completedEntry();
    expect(durableAtSave).toBeDefined();
    expect(entry._unmigrated?.journeyPromotedDraft).toEqual(durableAtSave);
    expect(entry._unmigrated?.journeyPromotedDraft).toMatchObject({
      id: original.id, createdAt: original.createdAt, futureDraft: original.futureDraft,
      _unmigrated: original._unmigrated, form: original.form,
    });
    const archive = await buildArchive({ entries: [entry], drafts: [], outlineBooks: [], topics: [], profile: 'refs-only' });
    const receiving = new DexieStorageProvider(`fictional-draft-promotion-restored-${counter}`);
    await receiving.open();
    await applyImport(await parseImport(archive.bytes), receiving, 'replace');
    const restored = (await receiving.listEntries())[0];
    expect(restored).toEqual(entry);
    const recovered = restored._unmigrated?.journeyPromotedDraft as EntryDraft;
    // This isolated synthetic store demonstrates recoverability without making
    // normal Save leave an unfinished duplicate on the user's home screen.
    const recoveryFile = JSON.stringify({ format: 'journey-export', version: 1, entries: [], drafts: [recovered] });
    await applyImport(await parseImport(recoveryFile), receiving, 'merge');
    // Current main additionally mirrors unrecognised form keys into its
    // preservation map. All original snapshot values must still be present.
    expect(await receiving.getDraft(original.id)).toMatchObject(durableAtSave!);
  });

  it('does not leak the retained snapshot through text, Markdown sharing or the printable book', async () => {
    const original = draft();
    await db.putDraft(original);
    mount({ draftParam: original.id });
    await screen.findByLabelText('Notes');
    save();
    const entry = await completedEntry();
    expect(JSON.stringify(entry._unmigrated)).toContain(OPAQUE);
    const document = buildSharedEntryDocument(entry, PRIVATE_BY_DEFAULT);
    for (const rendered of [renderSharedEntryText(document), renderSharedEntryMarkdown(document)]) {
      expect(rendered).toContain(original.form.notes);
      expect(rendered).not.toContain(OPAQUE);
      expect(rendered).not.toContain(original.id);
      expect(rendered).not.toContain(original.form.reflection);
      expect(rendered).not.toContain(original.form.prayer);
    }
    const book = renderBook(await buildContext({ entries: [entry], outlineBooks: [], topics: [], profile: 'refs-only' }));
    expect(book).toContain(original.form.notes);
    expect(book).not.toContain(OPAQUE);
  });

  it('keeps all occupied metadata keys when an attached draft is deliberately saved', async () => {
    const prior = { journeyPromotedDraft: 'external value', 'journeyPromotedDraft:1': { opaque: 'another value' } };
    const entry = { ...READING, _unmigrated: prior };
    const original = { ...draft(), entryId: entry.id };
    await db.putEntries([entry]);
    await db.putDraft(original);
    window.location.hash = `#/entry/${entry.id}`;
    mount({ entryId: entry.id });
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(original.form.notes));
    save();
    const saved = await completedEntry();
    expect(saved._unmigrated).toMatchObject(prior);
    expect(saved._unmigrated?.['journeyPromotedDraft:2']).toMatchObject({
      id: original.id, entryId: entry.id, form: original.form, futureDraft: original.futureDraft,
    });
  });

  it('composes promotion metadata with a concurrent writer instead of replacing it', async () => {
    const original = { ...draft(), entryId: READING.id };
    const prior = { journeyPromotedDraft: 'prior preserved data' };
    await db.putEntries([{ ...READING, _unmigrated: prior }]);
    await db.putDraft(original);
    window.location.hash = `#/entry/${READING.id}`;
    mount({ entryId: READING.id });
    await screen.findByLabelText('Notes');
    // This is a real second durable update after the editor's initial read.
    const concurrent = { ...prior, otherWriter: { text: 'Fictional concurrent metadata' } };
    await db.updateEntry(READING.id, { _unmigrated: concurrent });
    save();
    const saved = await completedEntry();
    expect(saved._unmigrated).toMatchObject(concurrent);
    expect(saved._unmigrated?.['journeyPromotedDraft:1']).toMatchObject({ id: original.id, form: original.form });
  });

  it('does not duplicate an identical already retained draft snapshot', async () => {
    // Freeze Date only; UI timers/IndexedDB remain real. A redundant flush of an
    // unchanged draft therefore produces the exact same durable snapshot.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(WHEN));
    const original = { ...draft(), entryId: READING.id };
    await db.putEntries([{ ...READING, _unmigrated: { journeyPromotedDraft: original } }]);
    await db.putDraft(original);
    window.location.hash = `#/entry/${READING.id}`;
    mount({ entryId: READING.id });
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(original.form.notes));
    save();
    const saved = await completedEntry();
    expect(saved._unmigrated).toEqual({ journeyPromotedDraft: original });
  });

  it('keeps normal known-only draft completion free of implicit revision snapshots', async () => {
    const { futureDraft: _a, _unmigrated: _b, ...original } = draft();
    const { futureForm: _c, ...form } = original.form;
    await db.putDraft({ ...original, form });
    mount({ draftParam: original.id });
    await screen.findByLabelText('Notes');
    save();
    expect((await completedEntry())._unmigrated).toBeUndefined();
  });

  it('retains metadata on an otherwise empty link row that deliberate Save would omit', async () => {
    const { futureDraft: _a, _unmigrated: _b, ...original } = draft();
    const { futureForm: _c, ...form } = original.form;
    const extended = { ...original, form: { ...form, links: [{ url: '', label: '', capturedTitle: '', futureLink: OPAQUE }] } };
    await db.putDraft(extended);
    mount({ draftParam: original.id });
    await screen.findByLabelText('Notes');
    save();
    const saved = await completedEntry();
    expect(saved.links).toEqual([]);
    expect((saved._unmigrated?.journeyPromotedDraft as EntryDraft).form.links).toEqual(extended.form.links);
  });

  it('keeps directly representable link extensions without starting a revision history', async () => {
    const { futureDraft: _a, _unmigrated: _b, ...original } = draft();
    const { futureForm: _c, ...form } = original.form;
    const link = { url: 'https://example.invalid/fictional', label: '', capturedTitle: '', futureLink: OPAQUE };
    await db.putDraft({ ...original, form: { ...form, links: [link] } });
    mount({ draftParam: original.id });
    await screen.findByLabelText('Notes');
    save();
    const saved = await completedEntry();
    expect(saved.links[0]).toMatchObject({ url: link.url, futureLink: OPAQUE });
    expect(saved._unmigrated).toBeUndefined();
    cleanup();
    window.location.hash = `#/entry/${saved.id}`;
    mount({ entryId: saved.id });
    await screen.findByLabelText('Notes');
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Fictional later edit' } });
    save();
    await waitFor(async () => expect((await db.getEntry(saved.id))?.notes).toBe('Fictional later edit'));
    expect((await db.getEntry(saved.id))?._unmigrated).toBeUndefined();
    expect((await db.getEntry(saved.id))?.links[0]).toMatchObject({ futureLink: OPAQUE });
  });

  it('leaves the source draft recoverable when the canonical save fails', async () => {
    const original = draft();
    await db.putDraft(original);
    vi.spyOn(db, 'createEntry').mockRejectedValue(new Error('synthetic write refusal'));
    mount({ draftParam: original.id });
    await screen.findByLabelText('Notes');
    save();
    await screen.findByText('Your entry could not be saved: synthetic write refusal');
    expect(await db.listEntries()).toHaveLength(0);
    expect(await db.getDraft(original.id)).toMatchObject({
      futureDraft: original.futureDraft, _unmigrated: original._unmigrated, form: original.form,
    });
  });
});


describe('draft and entry concurrency from the editor', () => {
  it('keeps both versions when a stale autosave meets another window’s draft', async () => {
    const original = draft();
    await db.putDraft(original);
    mount({ draftParam: original.id });
    await screen.findByLabelText('Notes');
    const concurrent = { ...original, form: { ...original.form, notes: 'Other window acknowledged words' } };
    await db.putDraft(concurrent);
    await flushDraft();
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(2));
    expect(await db.getDraft(original.id)).toEqual(concurrent);
    const fork = (await db.listDrafts()).find((item) => item.id !== original.id)!;
    expect(fork).toMatchObject({ form: original.form, futureDraft: original.futureDraft, _unmigrated: original._unmigrated });
  });

  it('refuses a stale canonical Save and retains both writers’ words', async () => {
    await db.putEntries([READING]);
    window.location.hash = `#/entry/${READING.id}`;
    mount({ entryId: READING.id });
    await screen.findByLabelText('Notes');
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Local unpublished sentence' } });
    const otherWindow = new DexieStorageProvider(dbName());
    await otherWindow.open();
    const concurrent = await otherWindow.updateEntry(READING.id, {
      notes: 'Other window acknowledged notes', reflection: 'Other window acknowledged reflection',
    });
    const attempted = gate();
    const update = db.updateEntry.bind(db);
    vi.spyOn(db, 'updateEntry').mockImplementation(async (...args) => {
      try { return await update(...args); } finally { attempted.release(); }
    });
    save();
    await attempted.promise;
    expect(await db.getEntry(READING.id)).toEqual(concurrent);
    await screen.findByText(/entry changed in another window/i);
    expect((await db.getDraftForEntry(READING.id))?.form.notes).toBe('Local unpublished sentence');
    expect(screen.getByLabelText('Notes')).toHaveValue('Local unpublished sentence');
  });

  it('leaves another writer’s newer draft intact when Save retires its own revision', async () => {
    const original = draft();
    await db.putDraft(original);
    const started = gate(); const held = gate(); const removed = gate();
    const create = db.createEntry.bind(db); const remove = db.deleteDraft.bind(db);
    vi.spyOn(db, 'createEntry').mockImplementation(async (input) => {
      started.release(); await held.promise; return create(input);
    });
    vi.spyOn(db, 'deleteDraft').mockImplementation(async (...args) => {
      try { return await remove(...args); } finally { removed.release(); }
    });
    mount({ draftParam: original.id });
    await screen.findByLabelText('Notes');
    save();
    await started.promise;
    const current = (await db.getDraft(original.id))!;
    const concurrent = { ...current, form: { ...current.form, notes: 'Other writer during canonical Save' } };
    await db.putDraft(concurrent);
    held.release();
    await removed.promise;
    expect(await db.getDraft(original.id)).toEqual(concurrent);
    const [saved] = await db.listEntries();
    expect(saved.notes).toBe(original.form.notes);
    expect(saved._unmigrated?.journeyPromotedDraft).toEqual(current);
  });

  it('leaves another writer’s newer revision intact when Discard reaches deletion', async () => {
    const original = draft();
    await db.putDraft(original);
    mount({ draftParam: original.id });
    await screen.findByLabelText('Notes');
    await flushDraft();
    await waitFor(async () => expect((await db.getDraft(original.id))?.updatedAt).not.toBe(original.updatedAt));
    const started = gate(); const held = gate(); const removed = gate();
    const remove = db.deleteDraft.bind(db);
    vi.spyOn(db, 'deleteDraft').mockImplementation(async (...args) => {
      started.release(); await held.promise;
      try { return await remove(...args); } finally { removed.release(); }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, discard it' }));
    await started.promise;
    const current = (await db.getDraft(original.id))!;
    const concurrent = { ...current, form: { ...current.form, notes: 'Other writer before Discard delete' } };
    await db.putDraft(concurrent);
    held.release();
    await removed.promise;
    expect(await db.getDraft(original.id)).toEqual(concurrent);
  });

  it.each([false, true])('retires an in-flight fork without deleting another writer (new local edit: %s)', async (editAgain) => {
    const original = draft();
    await db.putDraft(original);
    mount({ draftParam: original.id });
    await screen.findByLabelText('Notes');
    const started = gate(); const held = gate(); const removed = gate();
    const put = db.putDraft.bind(db); const remove = db.deleteDraft.bind(db);
    let first = true;
    vi.spyOn(db, 'putDraft').mockImplementation(async (...args) => {
      if (first) { first = false; started.release(); await held.promise; }
      return put(...args);
    });
    vi.spyOn(db, 'deleteDraft').mockImplementation(async (...args) => {
      try { return await remove(...args); } finally { removed.release(); }
    });
    await flushDraft();
    await started.promise;
    const concurrent = { ...original, form: { ...original.form, notes: 'Other writer before fork' } };
    await put(concurrent);
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, discard it' }));
    if (editAgain) fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'New local words after Discard' } });
    held.release();
    await removed.promise;
    expect(await db.getDraft(original.id)).toEqual(concurrent);
    await waitFor(async () => {
      const drafts = await db.listDrafts();
      expect(drafts).toHaveLength(editAgain ? 2 : 1);
      if (editAgain) expect(drafts.find((item) => item.id !== original.id)?.form.notes).toBe('New local words after Discard');
    });
  });
});


describe('editor terminal operations fence every delayed write', () => {
  it('keeps words typed while Save is waiting for draft deletion', async () => {
    const original = draft();
    await db.putDraft(original);
    const started = gate(); const held = gate();
    const remove = db.deleteDraft.bind(db);
    vi.spyOn(db, 'deleteDraft').mockImplementation(async (...args) => {
      started.release(); await held.promise; return remove(...args);
    });
    mount({ draftParam: original.id });
    await screen.findByLabelText('Notes');
    save();
    await started.promise;
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Accepted while Save retired its draft' } });
    held.release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled());
    expect(screen.getByLabelText('Notes')).toHaveValue('Accepted while Save retired its draft');
    const [saved] = await db.listEntries();
    expect(saved.notes).toBe(original.form.notes);
    await waitFor(async () => expect((await db.getDraftForEntry(saved.id))?.form.notes).toBe('Accepted while Save retired its draft'));
  });

  it('settles an in-flight autosave before confirmed entry deletion so no orphan returns', async () => {
    await db.putEntries([READING]);
    const original = { ...draft(), entryId: READING.id };
    await db.putDraft(original);
    window.location.hash = `#/entry/${READING.id}`;
    mount({ entryId: READING.id });
    await screen.findByLabelText('Notes');
    const started = gate(); const held = gate(); const deleted = gate();
    const put = db.putDraft.bind(db); const remove = db.deleteEntry.bind(db);
    let first = true;
    vi.spyOn(db, 'putDraft').mockImplementation(async (...args) => {
      if (first) { first = false; started.release(); await held.promise; }
      return put(...args);
    });
    vi.spyOn(db, 'deleteEntry').mockImplementation(async (...args) => {
      try { return await remove(...args); } finally { deleted.release(); }
    });
    await flushDraft(); await started.promise;
    fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    // Drive a whole event-loop turn with the write held. A correct delete may
    // not reach the provider while that older write can still materialize.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const calledBeforeRelease = vi.mocked(db.deleteEntry).mock.calls.length;
    held.release(); await deleted.promise;
    expect(calledBeforeRelease).toBe(0);
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
    expect(await db.getEntry(READING.id)).toBeUndefined();
  });
});


it('restarts draft protection after a confirmed entry deletion fails', async () => {
  await db.putEntries([READING]);
  window.location.hash = `#/entry/${READING.id}`;
  mount({ entryId: READING.id });
  await screen.findByLabelText('Notes');
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Keep these words if deletion fails' } });
  vi.spyOn(db, 'deleteEntry').mockRejectedValue(new Error('synthetic deletion refusal'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
  await screen.findByText(/entry could not be deleted.*synthetic deletion refusal/i);
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'New writing after the deletion failed' } });
  await flushDraft();
  await waitFor(async () => expect((await db.getDraftForEntry(READING.id))?.form.notes).toBe('New writing after the deletion failed'));
  expect(await db.getEntry(READING.id)).toEqual(READING);
  expect(screen.getByLabelText('Notes')).toHaveValue('New writing after the deletion failed');
});


it('holds the next backup behind deletion failure and recovery even after route leave', async () => {
  await db.putEntries([READING]);
  window.location.hash = `#/entry/${READING.id}`;
  const view = mount({ entryId: READING.id });
  await screen.findByLabelText('Notes');
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Uncommitted words before leaving during deletion' } });
  const started = gate(); const held = gate();
  vi.spyOn(db, 'deleteEntry').mockImplementation(async () => {
    started.release(); await held.promise; throw new Error('synthetic delayed deletion refusal');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
  await started.promise;
  view.unmount();
  let settled = false;
  const nextBackup = settlePendingJournalWrites().then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const settledBeforeDeletionFinished = settled;
  held.release();
  await nextBackup;
  expect(settledBeforeDeletionFinished).toBe(false);
  expect((await db.getDraftForEntry(READING.id))?.form.notes).toBe('Uncommitted words before leaving during deletion');
  expect(await db.getEntry(READING.id)).toEqual(READING);
});


it('fails the next backup closed when failed deletion recovery cannot become durable', async () => {
  await db.putEntries([READING]);
  window.location.hash = `#/entry/${READING.id}`;
  const view = mount({ entryId: READING.id });
  await screen.findByLabelText('Notes');
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Writing that storage must not falsely acknowledge' } });
  const started = gate(); const held = gate();
  vi.spyOn(db, 'deleteEntry').mockImplementation(async () => {
    started.release(); await held.promise; throw new Error('synthetic deletion refusal');
  });
  fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
  await started.promise;
  view.unmount();
  vi.spyOn(db, 'putDraft').mockRejectedValue(new Error('synthetic recovery refusal'));
  const nextBackup = expect(settlePendingJournalWrites()).rejects.toThrow(/Recent writing could not be saved.*synthetic recovery refusal/);
  held.release();
  await nextBackup;
  expect(await db.getEntry(READING.id)).toEqual(READING);
});


it('does not navigate over a newer route after the deleting editor unmounts', async () => {
  await db.putEntries([READING]);
  window.location.hash = `#/entry/${READING.id}`;
  const view = mount({ entryId: READING.id });
  await screen.findByLabelText('Notes');
  const started = gate(); const held = gate();
  const remove = db.deleteEntry.bind(db);
  vi.spyOn(db, 'deleteEntry').mockImplementation(async (...args) => {
    started.release(); await held.promise; return remove(...args);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
  fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
  await started.promise;
  view.unmount();
  window.location.hash = '#/data';
  held.release();
  await settlePendingJournalWrites();
  expect(await db.getEntry(READING.id)).toBeUndefined();
  expect(window.location.hash).toBe('#/data');
});
