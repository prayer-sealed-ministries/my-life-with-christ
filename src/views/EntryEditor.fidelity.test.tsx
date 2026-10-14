/** Ordinary edits must not discard metadata preserved by journal transfer. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import EntryEditor from './EntryEditor';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import type { EntryDraft } from '../types';
import { READING } from '../export/fixtures';

const WHEN = '2026-10-11T12:00:00.000Z';
const link = {
  url: 'https://example.invalid/fictional', label: 'Fictional link', capturedTitle: 'Fictional title',
  capturedAt: WHEN, futureLink: { keep: ['every', 'field'] },
};
const sourceMaterial = {
  format: 'sermon-notes-json' as const, filename: 'fictional.json', importedAt: WHEN,
  body: 'Fictional outline', parserVersion: 1, futureMaterial: { revision: 2 },
};
const draft = () => ({
  id: 'fictional-draft', createdAt: WHEN, updatedAt: WHEN,
  futureDraft: { caret: 5 }, _unmigrated: { futureDraft: { caret: 2 }, earlier: 'keep' },
  form: {
    kind: 'sermon' as const, title: 'Fictional draft', date: '2026-10-11', place: '', speaker: '',
    sermonSeries: '', notes: 'Fictional unfinished note', reflection: '', prayer: '', tagsText: '',
    links: [link], anchors: [], forDescendants: false, scriptureRefs: [], sourceMaterial,
    futureForm: { keep: true },
  },
});

let db: DexieStorageProvider;
let counter = 0;
beforeEach(async () => {
  window.location.hash = '#/entry/new';
  db = new DexieStorageProvider(`fictional-editor-fidelity-${++counter}`);
  await db.open();
});
afterEach(cleanup);

const mount = (props: { entryId?: string; draftParam?: string }) => render(
  <RouterProvider>
    <StorageContextProvider provider={db}><EntryEditor {...props} /></StorageContextProvider>
  </RouterProvider>,
);
const write = (text: string) => {
  fireEvent.change(screen.getByLabelText('Notes'), { target: { value: text } });
  window.dispatchEvent(new Event('pagehide'));
};

function expectDraftMetadata(saved: EntryDraft, original = draft()) {
  expect(saved).toMatchObject({ futureDraft: original.futureDraft, _unmigrated: original._unmigrated });
  expect(saved.form).toMatchObject({ futureForm: original.form.futureForm });
  expect(saved.form.links).toEqual([link]);
  expect(saved.form.sourceMaterial).toEqual(sourceMaterial);
}

describe('ordinary editing preserves opaque transferred metadata', () => {
  it('preserves existing entry, link, source and provided-material metadata through Save', async () => {
    const original = {
      ...READING, links: [link], sourceMaterial,
      source: { format: 'markdown' as const, filename: 'fictional.md', importedAt: WHEN,
        itemIndex: 1, parserVersion: 1, futureSource: 'keep' },
      futureEntry: { keep: true }, _unmigrated: { futureEntry: { older: true } },
    };
    await db.putEntries([original]);
    window.location.hash = `#/entry/${original.id}`;
    mount({ entryId: original.id });
    await screen.findByLabelText('Notes');
    write('Fictional edited note');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.getEntry(original.id))?.notes).toBe('Fictional edited note'));
    const saved = await db.getEntry(original.id);
    expect(saved?.links).toEqual([link]);
    expect(saved?.sourceMaterial).toEqual(sourceMaterial);
    expect(saved?.source).toEqual(original.source);
    expect(saved).toMatchObject({ futureEntry: original.futureEntry, _unmigrated: original._unmigrated });
  });

  it('keeps imported draft-record and form metadata through another autosave', async () => {
    const original = draft();
    await db.putDraft(original);
    mount({ draftParam: original.id });
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(original.form.notes));
    write('Fictional resumed writing');
    await waitFor(async () => expect((await db.getDraft(original.id))?.form.notes).toBe('Fictional resumed writing'));
    expectDraftMetadata((await db.getDraft(original.id))!);
    expect(await db.listEntries()).toHaveLength(0);
    expect(await db.listDrafts()).toHaveLength(1);
  });

  it('preserves draft metadata on the recovery copy when another writer advanced the source', async () => {
    const original = draft();
    await db.putDraft(original);
    mount({ draftParam: original.id });
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(original.form.notes));
    const otherWriter = { ...original, form: { ...original.form, notes: 'Fictional other writer' },
      updatedAt: '2026-10-11T12:01:00.000Z' };
    await db.putDraft(otherWriter, original);
    write('Fictional local writer');
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(2));
    const all = await db.listDrafts();
    expect(all.find((item) => item.id === original.id)).toEqual(otherWriter);
    const recovery = all.find((item) => item.id !== original.id)!;
    expect(recovery.form.notes).toBe('Fictional local writer');
    expectDraftMetadata(recovery);
  });

  it('retains orphan metadata without reattaching its missing parent during recovery', async () => {
    const original = { ...draft(), entryId: 'fictional-missing-parent' };
    await db.putDraft(original);
    mount({ draftParam: original.id });
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(original.form.notes));
    write('Fictional recovered orphan');
    await waitFor(async () => expect((await db.getDraft(original.id))?.form.notes).toBe('Fictional recovered orphan'));
    const saved = (await db.getDraft(original.id))!;
    expect(saved.entryId).toBeUndefined();
    expectDraftMetadata(saved);
  });
});
