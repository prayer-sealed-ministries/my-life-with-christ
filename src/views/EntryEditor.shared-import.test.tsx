/**
 * A shared handout, through the real editor and a real store.
 *
 * The unit tests own the gate, the slot and the binding. These own what the
 * journal does — which is nothing, until somebody presses the button.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EntryEditor from './EntryEditor';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import { DRAFT_DEBOUNCE_MS } from '../lib/drafts';
import {
  offerIncomingDocument,
  hasIncomingDocument,
  reviewingIncomingDocument,
  resetIncomingDocuments,
} from '../app/incoming-document';
import type { IncomingDocument } from '../import/incoming';

let counter = 0;
let db: DexieStorageProvider;

const utf8 = (text: string) => new TextEncoder().encode(text);

const handout = (over: Partial<IncomingDocument> = {}): IncomingDocument => ({
  name: 'handout.md',
  mimeType: 'text/markdown',
  bytes: utf8('# Abiding\n\nPoint three: the pelican in the wilderness.\n'),
  ...over,
});

const open = async (name: string) => {
  const provider = new DexieStorageProvider(name);
  await provider.open();
  return provider;
};

beforeEach(async () => {
  resetIncomingDocuments();
  window.location.hash = '#/entry/new?kind=sermon';
  db = await open(`shared-import-${(counter += 1)}`);
});

afterEach(() => {
  cleanup();
  resetIncomingDocuments();
  vi.useRealTimers();
});

function mount(provider: DexieStorageProvider, props: Record<string, unknown> = {}) {
  return render(
    <RouterProvider>
      <StorageContextProvider provider={provider}>
        <EntryEditor kindParam="sermon" {...props} />
      </StorageContextProvider>
    </RouterProvider>,
  );
}

/** Everything the journal holds, as one comparable value. */
async function journal(provider: DexieStorageProvider) {
  return {
    entries: (await provider.listEntries()).map((e) => ({ id: e.id, title: e.title })),
    drafts: (await provider.listDrafts()).map((d) => ({ id: d.id, notes: d.form.notes })),
  };
}

describe('a shared document opens for review, and only for review', () => {
  it('shows the preview without being asked for a file', async () => {
    offerIncomingDocument(handout());
    mount(db);

    // The import panel is open in the first render, with the document already
    // read — no file chooser, no extra press.
    expect(await screen.findByText(/pelican in the wilderness/)).toBeInTheDocument();
    expect(screen.getByText('handout.md')).toBeInTheDocument();
    expect(reviewingIncomingDocument()).toBe(true);
  });

  it('changes nothing in the journal while it is on screen', async () => {
    const before = await journal(db);
    offerIncomingDocument(handout());
    mount(db);
    await screen.findByText(/pelican in the wilderness/);

    // Review is not commit. Nothing saved, nothing drafted, no partial
    // material left anywhere.
    expect(await journal(db)).toEqual(before);
    expect(before.entries).toHaveLength(0);
    expect(before.drafts).toHaveLength(0);
  });

  it('leaves the journal untouched when the reader cancels', async () => {
    offerIncomingDocument(handout());
    mount(db);
    await screen.findByText(/pelican in the wilderness/);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(reviewingIncomingDocument()).toBe(false));
    expect(await journal(db)).toEqual({ entries: [], drafts: [] });
    // And the slot is free, so the next share is accepted rather than refused.
    expect(hasIncomingDocument()).toBe(false);
  });

  it('refuses a document it cannot read, and still writes nothing', async () => {
    offerIncomingDocument(handout({ name: 'photo.jpg', mimeType: 'image/jpeg' }));
    mount(db);

    // Scoped to the alert: the same sentence is also announced in a polite
    // live region, so an unscoped query matches twice and resolves neither.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/\.txt, \.md, \.json, \.docx or text-based \.pdf/);
    expect(await journal(db)).toEqual({ entries: [], drafts: [] });
  });
});

describe('a document that arrives after the editor is already open', () => {
  it('opens the review where the reader already is', async () => {
    // The case an emulator found and no unit test had: the web view restores
    // the hash it was last on, so a cold share into an app last left on
    // `#/entry/new` mounts this editor FIRST, with an empty slot, and the
    // navigation that follows goes to the address already showing. Nothing
    // remounts, and without a subscription the handout waits forever.
    mount(db);
    await screen.findByLabelText('Notes');
    expect(screen.queryByText(/pelican in the wilderness/)).not.toBeInTheDocument();

    await act(async () => {
      offerIncomingDocument(handout());
    });

    expect(await screen.findByText(/pelican in the wilderness/)).toBeInTheDocument();
    expect(reviewingIncomingDocument()).toBe(true);
  });

  it('does not displace a review already on screen', async () => {
    offerIncomingDocument(handout({ name: 'first.md', bytes: utf8('FIRST handout body.') }));
    mount(db);
    await screen.findByText(/FIRST handout body/);

    // The registry refuses the second offer, so nothing is announced and
    // nothing changes under the reader.
    await act(async () => {
      offerIncomingDocument(handout({ name: 'second.md', bytes: utf8('SECOND handout body.') }));
    });

    expect(screen.getByText(/FIRST handout body/)).toBeInTheDocument();
    expect(screen.queryByText(/SECOND handout body/)).not.toBeInTheDocument();
  });
});

describe('whose words they are', () => {
  it('becomes provided material and never the reader’s own writing', async () => {
    offerIncomingDocument(handout());
    mount(db);
    await screen.findByText(/pelican in the wilderness/);

    fireEvent.click(screen.getByRole('button', { name: /Use these notes/i }));

    // The handout is attached; Notes, Reflection and Prayer are as empty as on
    // any blank entry.
    await waitFor(() =>
      expect(screen.getByLabelText('Notes')).toHaveValue(''),
    );
    expect(screen.getByLabelText('Reflection')).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await db.listEntries()).length).toBe(1));
    const [saved] = await db.listEntries();

    expect(saved.sourceMaterial?.body).toContain('pelican in the wilderness');
    expect(saved.sourceMaterial?.filename).toBe('handout.md');
    expect(saved.notes).toBe('');
    expect(saved.reflection).toBe('');
    expect(saved.prayer ?? '').toBe('');
  });

  it('never lets a filename claim authorship', async () => {
    offerIncomingDocument(
      handout({ name: 'my-own-reflection.md', bytes: utf8('Handed out at the door.') }),
    );
    mount(db);
    await screen.findByText(/Handed out at the door/);
    fireEvent.click(screen.getByRole('button', { name: /Use these notes/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await db.listEntries()).length).toBe(1));
    const [saved] = await db.listEntries();
    expect(saved.reflection).toBe('');
    expect(saved.sourceMaterial?.body).toBe('Handed out at the door.');
  });
});

describe('a share cannot take somebody’s unfinished writing', () => {
  it('leaves an existing draft exactly as it was', async () => {
    // Start a sermon and type a marker into it.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount(db);
    const marker = 'UNIQUE MARKER: he began with the vine.';
    fireEvent.change(await screen.findByLabelText('Notes'), { target: { value: marker } });
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS + 50);
    vi.useRealTimers();
    await waitFor(async () => expect((await db.listDrafts()).length).toBe(1));
    const [before] = await db.listDrafts();

    // A handout arrives and is reviewed in a fresh editor, as a share opens.
    cleanup();
    const second = await open(`shared-import-${counter}`);
    offerIncomingDocument(handout());
    mount(second);
    await screen.findByText(/pelican in the wilderness/);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // The draft is word for word what it was.
    const [after] = await second.listDrafts();
    expect(after.id).toBe(before.id);
    expect(after.form.notes).toBe(marker);
  });
});

describe('a redelivered share cannot import twice', () => {
  it('is taken once, however many editors mount', async () => {
    offerIncomingDocument(handout());

    mount(db);
    await screen.findByText(/pelican in the wilderness/);
    // The slot is already empty: a second editor mounting — a remount, a
    // redelivered intent, a recomposition — finds nothing to import.
    expect(hasIncomingDocument()).toBe(false);

    cleanup();
    const again = await open(`shared-import-${counter}`);
    mount(again);
    await screen.findByLabelText('Notes');
    expect(screen.queryByText(/pelican in the wilderness/)).not.toBeInTheDocument();
    expect(await journal(again)).toEqual({ entries: [], drafts: [] });
  });

  it('applies once even if the button is pressed twice', async () => {
    offerIncomingDocument(handout());
    mount(db);
    await screen.findByText(/pelican in the wilderness/);

    const use = screen.getByRole('button', { name: /Use these notes/i });
    fireEvent.click(use);
    fireEvent.click(use);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.listEntries()).length).toBe(1));

    const [saved] = await db.listEntries();
    // One entry, one copy of the material — not the handout twice over.
    expect(saved.sourceMaterial?.body.match(/pelican/g) ?? []).toHaveLength(1);
  });
});

describe('an editor that is not a new entry', () => {
  it('does not swallow a shared document meant for a new sermon', async () => {
    const existing = await db.createEntry({ kind: 'sermon', title: 'Already saved', date: '2026-03-01' });
    offerIncomingDocument(handout());

    mount(db, { entryId: existing.id, kindParam: undefined });
    await screen.findByDisplayValue('Already saved');

    // Still waiting for the new-sermon editor a share opens.
    expect(hasIncomingDocument()).toBe(true);
    expect(screen.queryByText(/pelican in the wilderness/)).not.toBeInTheDocument();
  });
});
