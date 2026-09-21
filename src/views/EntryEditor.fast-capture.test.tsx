/**
 * Sermon note, now.
 *
 * The product promise is that a person in a pew goes from phone-in-hand to
 * typing without deciding anything. Most of that already existed — the editor
 * defaults to a sermon, collapses Details and claims the caret. What this lane
 * added is a doorway something outside the app can name, so these hold both:
 * the destination the shortcut selects, and what the reader finds when it opens.
 *
 * Driven through the real editor over a real Dexie store, because "the cursor
 * is in Notes" is the claim, and a stub cannot make it.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EntryEditor from './EntryEditor';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import { DRAFT_DEBOUNCE_MS } from '../lib/drafts';
import { routeForLaunchAction } from '../app/launch-actions';
import { href } from '../app/router';
import type { EntryKind } from '../types';

let counter = 0;
let db: DexieStorageProvider;
let storeName: string;

/** The destination the launcher shortcut selects — read, never written down. */
const CAPTURE = routeForLaunchAction('sermon-fast-capture') as {
  name: 'newEntry';
  kind: EntryKind;
};

const open = async (name: string) => {
  const provider = new DexieStorageProvider(name);
  await provider.open();
  return provider;
};

beforeEach(async () => {
  window.location.hash = href(CAPTURE);
  storeName = `fast-capture-${(counter += 1)}`;
  db = await open(storeName);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Mount the editor exactly as App does for this route. */
function mountCapture(provider: DexieStorageProvider) {
  return render(
    <RouterProvider>
      <StorageContextProvider provider={provider}>
        <EntryEditor kindParam={CAPTURE.kind} />
      </StorageContextProvider>
    </RouterProvider>,
  );
}

const notes = () => screen.findByLabelText('Notes');

describe('what the shortcut opens', () => {
  it('is a sermon, already chosen', async () => {
    mountCapture(db);
    const kind = (await screen.findByLabelText('Kind')) as HTMLSelectElement;
    expect(kind.value).toBe('sermon');
  });

  it('puts the cursor in Notes, not merely on the page', async () => {
    mountCapture(db);
    const box = await notes();
    // activeElement, not scrollIntoView. On a phone this is what raises the
    // keyboard; anything less means the reader still has to tap.
    await waitFor(() => expect(document.activeElement).toBe(box));
  });

  it('asks for no title and no details before writing', async () => {
    mountCapture(db);
    await notes();

    // Details is a real <details>, and it starts shut.
    const details = screen.getByText('Details').closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    // Nothing blocks the first keystroke: no dialog, no chooser, no title.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const title = screen.queryByLabelText(/^Title/) as HTMLInputElement | null;
    if (title) expect(title.required).toBe(false);
  });

  it('still reaches Details and Save — nothing was hidden to save a moment', async () => {
    mountCapture(db);
    await notes();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    const details = screen.getByText('Details').closest('details') as HTMLDetailsElement;
    fireEvent.click(screen.getByText('Details'));
    await waitFor(() => expect(details.open).toBe(true));
  });
});

describe('the first words are safe without pressing anything', () => {
  it('becomes a durable sermon draft, and reopens with the exact text', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mountCapture(db);
    const box = await notes();

    const typed = 'He opened on the vine and the branches, and did not hurry.';
    fireEvent.change(box, { target: { value: typed } });
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS + 50);
    vi.useRealTimers();

    await waitFor(async () => expect((await db.listDrafts()).length).toBe(1));
    const [draft] = await db.listDrafts();
    expect(draft.form.kind).toBe('sermon');
    expect(draft.form.notes).toBe(typed);
    // Nothing was invented on the reader's behalf.
    expect(draft.form.title).toBe('');

    // The nearest a unit test gets to a relaunch: a second editor over the
    // same store, opened the way Home's "Continue writing" opens it.
    cleanup();
    const reopened = await open(storeName);
    render(
      <RouterProvider>
        <StorageContextProvider provider={reopened}>
          <EntryEditor draftParam={draft.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );
    await waitFor(async () => expect((await notes()) as HTMLTextAreaElement).toHaveValue(typed));
  });

  it('does not create a draft for an untouched editor', async () => {
    // Opening the shortcut and putting the phone away must not litter Home
    // with empty sermons.
    mountCapture(db);
    await notes();
    expect(await db.listDrafts()).toHaveLength(0);
  });
});

describe('a second sermon never lands on the first', () => {
  it('starts a new draft and leaves the unfinished one alone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mountCapture(db);
    fireEvent.change(await notes(), { target: { value: 'Last Sunday, unfinished.' } });
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS + 50);
    vi.useRealTimers();
    await waitFor(async () => expect((await db.listDrafts()).length).toBe(1));
    const first = (await db.listDrafts())[0];

    // Another service, the same shortcut.
    cleanup();
    const again = await open(storeName);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <RouterProvider>
        <StorageContextProvider provider={again}>
          <EntryEditor kindParam={CAPTURE.kind} />
        </StorageContextProvider>
      </RouterProvider>,
    );
    const box = await notes();
    // A blank page, not last week's sermon.
    expect(box).toHaveValue('');

    fireEvent.change(box, { target: { value: 'This Sunday, different church.' } });
    await vi.advanceTimersByTimeAsync(DRAFT_DEBOUNCE_MS + 50);
    vi.useRealTimers();

    await waitFor(async () => expect((await again.listDrafts()).length).toBe(2));
    const drafts = await again.listDrafts();
    const ids = drafts.map((each) => each.id);
    expect(new Set(ids).size).toBe(2);

    // The first is untouched, word for word.
    const kept = drafts.find((each) => each.id === first.id);
    expect(kept?.form.notes).toBe('Last Sunday, unfinished.');
  });
});

describe('the ordinary way in is unchanged', () => {
  it('Home’s sermon note and the shortcut open the same destination', async () => {
    // One editor, one data model, several doorways. If these ever diverge, the
    // shortcut has quietly become a second kind of entry.
    expect(href(CAPTURE)).toBe('#/entry/new?kind=sermon');

    mountCapture(db);
    const viaShortcut = (await screen.findByLabelText('Kind')) as HTMLSelectElement;
    expect(viaShortcut.value).toBe('sermon');
    cleanup();

    // The plain route, with no kind at all — what Home used to link to.
    const plain = await open(storeName);
    render(
      <RouterProvider>
        <StorageContextProvider provider={plain}>
          <EntryEditor />
        </StorageContextProvider>
      </RouterProvider>,
    );
    const viaHome = (await screen.findByLabelText('Kind')) as HTMLSelectElement;
    expect(viaHome.value).toBe('sermon');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Notes')));
  });
});
