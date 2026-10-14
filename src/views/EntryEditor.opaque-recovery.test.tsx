/** Merely opening imported recovery data must never silently retire it. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EntryEditor from './EntryEditor';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import { buildArchive } from '../export/archive';
import { applyImport, parseImport } from '../export/importer';
import type { Entry, EntryDraft } from '../types';
import { READING } from '../export/fixtures';

const WHEN = '2026-10-11T12:00:00.000Z';
const OPAQUE = { text: 'FICTIONAL-OPAQUE-RECOVERY', nested: ['café', '🙏', 'unfinished  '] };
const sourceMaterial = {
  format: 'sermon-notes-json' as const, filename: 'fictional.json', importedAt: WHEN,
  body: 'Fictional provided notes', parserVersion: 1,
};
const entry = (): Entry => ({
  ...READING,
  notes: 'Fictional saved notes',
  links: [{ url: 'https://example.invalid/fictional' }],
  anchors: [structuredClone(READING.anchors[0]), { kind: 'topic', topicId: 'humility' }, { kind: 'book', book: 'genesis' }],
  sourceMaterial: structuredClone(sourceMaterial),
});
const matchingDraft = (saved: Entry): EntryDraft => ({
  id: 'fictional-opaque-recovery', entryId: saved.id, createdAt: WHEN, updatedAt: WHEN,
  form: {
    kind: saved.kind, title: saved.title, date: saved.date, place: saved.place ?? '',
    speaker: saved.speaker ?? '', sermonSeries: saved.sermonSeries ?? '', notes: saved.notes,
    reflection: saved.reflection, prayer: saved.prayer ?? '', tagsText: saved.tags.join(', '),
    links: saved.links.map((link) => ({ ...link, label: link.label ?? '', capturedTitle: link.capturedTitle ?? '' })),
    anchors: structuredClone(saved.anchors), forDescendants: saved.forDescendants,
    scriptureRefs: saved.scriptureRefs, sourceMaterial: structuredClone(saved.sourceMaterial ?? null),
  },
});
let db: DexieStorageProvider;
let counter = 0;
beforeEach(async () => {
  db = new DexieStorageProvider(`fictional-opaque-recovery-${++counter}`);
  await db.open();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const mount = (id: string) => {
  window.location.hash = `#/entry/${id}`;
  return render(<RouterProvider><StorageContextProvider provider={db}><EntryEditor entryId={id} /></StorageContextProvider></RouterProvider>);
};
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

const cases: [string, (draft: EntryDraft) => void, (entry: Entry) => unknown][] = [
  ['draft preservation metadata', (draft) => { draft._unmigrated = { future: OPAQUE }; },
    (entry) => (entry._unmigrated?.journeyPromotedDraft as EntryDraft)._unmigrated?.future],
  ['colliding top-level draft metadata', (draft) => {
    draft._unmigrated = { future: 'prior value stays' };
    Object.assign(draft, { future: OPAQUE });
  }, (entry) => (entry._unmigrated?.journeyPromotedDraft as unknown as Record<string, unknown>).future],
  ['form metadata', (draft) => { Object.assign(draft.form, { future: OPAQUE }); },
    (entry) => ((entry._unmigrated?.journeyPromotedDraft as EntryDraft).form as unknown as Record<string, unknown>).future],
  ['link metadata', (draft) => { Object.assign(draft.form.links[0], { future: OPAQUE }); },
    (entry) => (entry.links[0] as unknown as Record<string, unknown>).future],
  ...(['scripture', 'topic', 'book'] as const).map((kind, index): typeof cases[number] => [
    `${kind} anchor metadata`, (draft) => { Object.assign(draft.form.anchors[index], { future: OPAQUE }); },
    (entry) => (entry.anchors[index] as unknown as Record<string, unknown>).future,
  ]),
  ['provided-source metadata', (draft) => { Object.assign(draft.form.sourceMaterial!, { future: OPAQUE }); },
    (entry) => (entry.sourceMaterial as unknown as Record<string, unknown>).future],
];

describe('opaque-only attached recovery drafts', () => {
  it.each(cases)('keeps %s through import, opening, deliberate Save and archive restore', async (_name, extend, retained) => {
    const saved = entry();
    const original = matchingDraft(saved);
    extend(original);
    await applyImport(await parseImport(JSON.stringify({ format: 'journey-export', version: 1, entries: [saved], drafts: [original] })), db, 'merge');
    const imported = (await db.getDraft(original.id))!;
    const canonical = (await db.getEntry(saved.id))!;
    const remove = vi.spyOn(db, 'deleteDraft');
    mount(saved.id);
    await screen.findByRole('button', { name: 'Discard draft' });
    expect(await db.getDraft(original.id)).toMatchObject({ form: imported.form });
    expect((await db.getDraft(original.id))?._unmigrated).toEqual(imported._unmigrated);
    expect(await db.getEntry(saved.id)).toEqual(canonical);
    expect(remove).not.toHaveBeenCalled();
    save();
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
    const completed = (await db.getEntry(saved.id))!;
    expect(retained(completed)).toEqual(OPAQUE);
    const archive = await buildArchive({ entries: [completed], drafts: [], outlineBooks: [], topics: [], profile: 'refs-only' });
    const receiving = new DexieStorageProvider(`fictional-opaque-restored-${counter}`);
    await receiving.open();
    await applyImport(await parseImport(archive.bytes), receiving, 'replace');
    expect(await receiving.getEntry(saved.id)).toEqual(completed);
    expect(retained((await receiving.getEntry(saved.id))!)).toEqual(OPAQUE);
  });

  it('retains opaque draft data after visible edits are undone to the canonical words', async () => {
    const saved = entry();
    const original = matchingDraft(saved);
    original.form.notes += ' An unfinished sentence.';
    original._unmigrated = { future: OPAQUE };
    await db.putEntries([saved]);
    await db.putDraft(original);
    mount(saved.id);
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(original.form.notes));
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: saved.notes } });
    window.dispatchEvent(new Event('pagehide'));
    await waitFor(async () => expect((await db.getDraft(original.id))?.form.notes).toBe(saved.notes));
    expect((await db.getDraft(original.id))?._unmigrated).toEqual(original._unmigrated);
    expect(screen.getByRole('button', { name: 'Discard draft' })).toBeInTheDocument();
    save();
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
    expect(((await db.getEntry(saved.id))?._unmigrated?.journeyPromotedDraft as EntryDraft)._unmigrated).toEqual(original._unmigrated);
  });

  it('keeps an opaque-only new draft even when all writable fields are empty', async () => {
    const original = matchingDraft(entry());
    delete original.entryId;
    original.form = {
      kind: 'sermon', date: '2026-10-11', title: '', notes: '', reflection: '', prayer: '',
      place: '', speaker: '', sermonSeries: '', tagsText: '', links: [], anchors: [],
      forDescendants: false, scriptureRefs: [], sourceMaterial: null,
    };
    original._unmigrated = { future: OPAQUE };
    await db.putDraft(original);
    const remove = vi.spyOn(db, 'deleteDraft');
    window.location.hash = `#/entry/new?draft=${original.id}`;
    render(<RouterProvider><StorageContextProvider provider={db}><EntryEditor draftParam={original.id} /></StorageContextProvider></RouterProvider>);
    await screen.findByRole('button', { name: 'Discard draft' });
    window.dispatchEvent(new Event('pagehide'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(await db.getDraft(original.id)).toMatchObject({ form: original.form, _unmigrated: original._unmigrated });
    expect(remove).not.toHaveBeenCalled();
  });

  it('still cleans up a known-only draft, including absent versus empty source references', async () => {
    const saved = entry();
    const original = matchingDraft(saved);
    original.form.sourceMaterial!.scripture = [];
    await db.putEntries([saved]);
    await db.putDraft(original);
    mount(saved.id);
    await screen.findByLabelText('Notes');
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
    expect(screen.queryByRole('button', { name: 'Discard draft' })).not.toBeInTheDocument();
    expect(await db.getEntry(saved.id)).toEqual(saved);
  });

  it('cleans up duplicate nested extensions already represented by the canonical entry', async () => {
    const saved = entry();
    Object.assign(saved.links[0], { future: OPAQUE });
    Object.assign(saved.anchors[0], { future: OPAQUE });
    Object.assign(saved.sourceMaterial!, { future: OPAQUE });
    await db.putEntries([saved]);
    await db.putDraft(matchingDraft(saved));
    mount(saved.id);
    await screen.findByLabelText('Notes');
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
    expect(await db.getEntry(saved.id)).toEqual(saved);
  });

  it('allows an explicit confirmed discard without promoting abandoned metadata', async () => {
    const saved = entry();
    const original = matchingDraft(saved);
    original._unmigrated = { future: OPAQUE };
    await db.putEntries([saved]);
    await db.putDraft(original);
    mount(saved.id);
    fireEvent.click(await screen.findByRole('button', { name: 'Discard draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, discard it' }));
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
    expect(await db.getEntry(saved.id)).toEqual(saved);
  });
});
