/**
 * Crash-safe drafts, from the product surface.
 *
 * The promise is narrow and absolute: what somebody typed is still there after
 * the process dies, without them having pressed Save. These drive that through
 * the real editor, a real Dexie store and the real autosaver — the only thing
 * stubbed is the clock, so no test waits on a debounce.
 *
 * "Reopening" here means mounting a second editor over the same store, which is
 * the nearest a unit test gets to a relaunch. The device proof is separate.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EntryEditor from './EntryEditor';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import { DRAFT_DEBOUNCE_MS, hasDraftContent } from '../lib/drafts';
import type { DraftForm } from '../types';

let counter = 0;
let db: DexieStorageProvider;
let storeName: string;

const open = async (name: string) => {
  const provider = new DexieStorageProvider(name);
  await provider.open();
  return provider;
};

beforeEach(async () => {
  window.location.hash = '#/entry/new';
  storeName = `drafts-${(counter += 1)}`;
  db = await open(storeName);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(provider: DexieStorageProvider, props: Record<string, unknown> = {}) {
  return render(
    <RouterProvider>
      <StorageContextProvider provider={provider}>
        <EntryEditor {...props} />
      </StorageContextProvider>
    </RouterProvider>,
  );
}

const notes = () => screen.findByLabelText('Notes');

/** Let the debounce elapse without waiting on a real clock. */
const settle = async (provider: DexieStorageProvider, expected = 1) => {
  await waitFor(async () => expect((await provider.listDrafts()).length).toBe(expected), {
    timeout: 5_000,
  });
};

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('a new entry nobody has saved', () => {
  it('leaves nothing behind when the editor is opened and abandoned blank', async () => {
    mount(db);
    await notes();
    // Long enough that a write would have happened if one were coming.
    await new Promise((resolve) => setTimeout(resolve, DRAFT_DEBOUNCE_MS * 3));

    expect(
      await db.listDrafts(),
      'an untouched editor must not litter the store with empty drafts',
    ).toHaveLength(0);
  });

  it('makes the first real sentence durable without anyone pressing Save', async () => {
    mount(db);
    await notes();

    type('Notes', 'He read the whole letter aloud.');
    await settle(db);

    const [draft] = await db.listDrafts();
    expect(draft.form.notes).toBe('He read the whole letter aloud.');
    expect(await db.listEntries(), 'a draft is not an entry').toHaveLength(0);
  });

  it.each([
    ['Title', 'Grace at the door'],
    ['Notes', 'What was said.'],
    ['Reflection', 'What it meant.'],
  ])('a %s on its own is enough to preserve', async (label, value) => {
    mount(db);
    await notes();

    type(label, value);
    await settle(db);

    expect((await db.listDrafts())).toHaveLength(1);
  });

  it('does not invent a title for untitled work', async () => {
    mount(db);
    await notes();

    type('Notes', 'Just the notes, no title.');
    await settle(db);

    const [draft] = await db.listDrafts();
    expect(draft.form.title, 'blank stays blank').toBe('');
  });

  /** The central promise, as near as a unit test can stage it. */
  it('gives the exact text back when the editor is opened again over the same store', async () => {
    const paragraphs = [
      'Philemon is a letter about a debt somebody else offered to pay.',
      '',
      'He said: "charge it to my account" — and then wrote it in his own hand.',
      '',
      'I owe someone a letter like that. Trailing space on purpose.   ',
    ].join('\n');

    mount(db);
    await notes();
    type('Notes', paragraphs);
    type('Reflection', 'Write the letter this week.');
    await settle(db);

    const [saved] = await db.listDrafts();
    cleanup();

    // A second editor over the same store, resuming that draft.
    const reopened = await open(storeName);
    mount(reopened, { draftParam: saved.id });
    await notes();

    await waitFor(() =>
      expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toBe(paragraphs),
    );
    expect((screen.getByLabelText('Reflection') as HTMLTextAreaElement).value).toBe(
      'Write the letter this week.',
    );
    expect(screen.getByText('Your recent changes were restored.')).toBeInTheDocument();
  });

  it('keeps two unfinished pieces of work apart', async () => {
    mount(db);
    await notes();
    type('Notes', 'the sermon');
    await settle(db);
    cleanup();

    // A second new entry, started fresh — no draft parameter.
    window.location.hash = '#/entry/new';
    const second = await open(storeName);
    mount(second);
    await notes();
    type('Notes', 'the prayer');
    await settle(second, 2);

    const all = await second.listDrafts();
    expect(all.map((d) => d.form.notes).sort()).toEqual(['the prayer', 'the sermon']);
  });
});

describe('an entry that has been saved', () => {
  it('recovers edits that were never saved, without touching the saved copy', async () => {
    const entry = await db.createEntry({ title: 'Sunday', notes: 'The original notes.' });
    window.location.hash = `#/entry/${entry.id}`;

    mount(db, { entryId: entry.id });
    await notes();
    type('Notes', 'The original notes.\n\nThree new paragraphs nobody saved.');
    await settle(db);

    // The journal itself is untouched: the draft is separate by construction.
    expect((await db.getEntry(entry.id))?.notes).toBe('The original notes.');
    cleanup();

    const reopened = await open(storeName);
    mount(reopened, { entryId: entry.id });
    await notes();

    await waitFor(() =>
      expect((screen.getByLabelText('Notes') as HTMLTextAreaElement).value).toContain(
        'Three new paragraphs nobody saved.',
      ),
    );
    expect(await reopened.listEntries(), 'one entry, not two').toHaveLength(1);
  });
});

describe('explicit Save', () => {
  it('writes the entry, retires the draft, and no stale write brings it back', async () => {
    mount(db);
    await notes();
    type('Notes', 'Worth keeping.');
    await settle(db);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await db.listEntries()).length).toBe(1));
    const [entry] = await db.listEntries();
    expect(entry.notes).toBe('Worth keeping.');

    // The draft is gone, and stays gone: the autosaver is fenced, so a write
    // queued before the save cannot recreate it afterwards.
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
    await new Promise((resolve) => setTimeout(resolve, DRAFT_DEBOUNCE_MS * 3));
    expect(
      await db.listDrafts(),
      'a stale autosave resurrected the draft after Save retired it',
    ).toHaveLength(0);
  });

  it('saves the newest text even when the settle window has not elapsed', async () => {
    mount(db);
    await notes();
    type('Notes', 'First.');
    await settle(db);

    // Typed and saved immediately — inside the window, with no pause.
    type('Notes', 'First. And the sentence typed just before pressing Save.');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await db.listEntries()).length).toBe(1));
    const [entry] = await db.listEntries();
    expect(entry.notes, 'Save must flush the pending snapshot first').toBe(
      'First. And the sentence typed just before pressing Save.',
    );
  });
});

describe('meaningful content', () => {
  const form = (overrides: Partial<DraftForm> = {}): DraftForm => ({
    kind: 'sermon',
    title: '',
    date: '2026-03-01',
    place: '',
    speaker: '',
    sermonSeries: '',
    notes: '',
    reflection: '',
    prayer: '',
    tagsText: '',
    links: [],
    anchors: [],
    forDescendants: false,
    scriptureRefs: [],
    sourceMaterial: null,
    ...overrides,
  });

  it('says no to a blank editor, and to one holding only whitespace', () => {
    expect(hasDraftContent(form())).toBe(false);
    expect(hasDraftContent(form({ notes: '   \n  ' }))).toBe(false);
  });

  it.each([
    ['title', { title: 'A title' }],
    ['notes', { notes: 'Some notes' }],
    ['reflection', { reflection: 'A reflection' }],
    ['prayer', { prayer: 'A prayer' }],
    ['a tag', { tagsText: 'grace' }],
    ['an anchor', { anchors: [{ kind: 'topic' as const, topicId: 'humility' }] }],
    ['a half-typed link row', { links: [{ url: '', label: 'the audio', capturedTitle: '' }] }],
  ])('says yes to %s', (_what, overrides) => {
    expect(hasDraftContent(form(overrides))).toBe(true);
  });

  it('does not count the date and kind every blank editor already has', () => {
    // Otherwise every editor anyone opened would be "meaningful" and the
    // predicate would answer yes to nothing having happened.
    expect(hasDraftContent(form({ kind: 'prayer', date: '2026-12-25' }))).toBe(false);
  });
});
