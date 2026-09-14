/**
 * These tests drive the real form: a real Dexie database on fake-indexeddb, the
 * real hash router, no mocked storage. What is asserted is what a person in a
 * pew would experience — the cursor lands in the notes box, notes alone saves,
 * and the two fields that must never merge do not merge.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import { hasOutlineTitles, segmentsForBook } from '../app/data';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { refToString } from '../lib/bible';
import { segmentRef } from '../lib/passages';
import { DexieStorageProvider, todayIso } from '../storage/db';
import type { Entry } from '../types';
import EntryEditor from './EntryEditor';

let counter = 0;

function setup(ui: ReactElement, hash = '#/entry/new') {
  window.location.hash = hash;
  // A fresh database per test: entries written by one test must not be visible
  // to the next.
  const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
  const view = render(
    <RouterProvider>
      <StorageContextProvider provider={storage}>{ui}</StorageContextProvider>
    </RouterProvider>,
  );
  return { storage, ...view };
}

/** Wait for the form itself, not just the shell around it. */
const notesBox = () => screen.findByLabelText('Notes');

const save = () => screen.getByRole('button', { name: 'Save' });

/**
 * Wait for the save to land, then hand back the entry.
 *
 * Waiting on the hash alone is not enough: the create route is already
 * "#/entry/new", so a pattern match on it passes before anything is written.
 */
const savedEntry = async (storage: DexieStorageProvider): Promise<Entry> => {
  let entries: Entry[] = [];
  await waitFor(async () => {
    entries = await storage.listEntries();
    expect(entries).toHaveLength(1);
  });
  return entries[0];
};

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  // This project's vitest runs without `globals`, so Testing Library never gets
  // to register its own afterEach and nothing is unmounted automatically.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('EntryEditor — fast capture', () => {
  it('opens on a sermon dated today with the cursor already in the notes box', async () => {
    const { container } = setup(<EntryEditor />);

    const notes = await notesBox();
    expect(screen.getByLabelText('Kind')).toHaveValue('sermon');
    expect(screen.getByLabelText('Date')).toHaveValue(todayIso());
    await waitFor(() => expect(notes).toHaveFocus());

    // Everything optional stays out of the way until it is asked for.
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });

  it('saves an entry that has nothing in it but notes', async () => {
    const { storage } = setup(<EntryEditor />);

    fireEvent.change(await notesBox(), { target: { value: 'Grace is not earned.' } });
    fireEvent.click(save());

    const entry = await savedEntry(storage);
    expect(entry.notes).toBe('Grace is not earned.');
    expect(entry.title).toBe('');
    expect(entry.reflection).toBe('');
    expect(entry.kind).toBe('sermon');
    expect(entry.date).toBe(todayIso());
    // Navigation lands a frame after the write, so the announcement has a
    // moment in the DOM before this view goes away.
    await waitFor(() => expect(window.location.hash).toBe(`#/entry/${entry.id}`));
  });

  it('announces the save', async () => {
    setup(<EntryEditor />);
    fireEvent.change(await notesBox(), { target: { value: 'Something worth keeping.' } });
    fireEvent.click(save());

    const live = await screen.findByText('Entry saved.');
    expect(live).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps what was taught and what it meant to me in separate fields', async () => {
    const { storage } = setup(<EntryEditor />);

    fireEvent.change(await notesBox(), { target: { value: 'Romans 8, no condemnation.' } });
    fireEvent.change(screen.getByLabelText('Reflection'), {
      target: { value: 'I have been carrying condemnation for years.' },
    });
    fireEvent.click(save());

    const entry = await savedEntry(storage);
    expect(entry.notes).toBe('Romans 8, no condemnation.');
    expect(entry.reflection).toBe('I have been carrying condemnation for years.');
    // Never concatenated, in either direction.
    expect(entry.notes).not.toContain('carrying condemnation');
    expect(entry.reflection).not.toContain('Romans 8');
  });

  it('refuses an entirely empty entry and says why', async () => {
    setup(<EntryEditor />);
    await notesBox();

    const button = save();
    expect(button).toBeDisabled();

    const reason = screen.getByText(/Nothing to save yet/);
    expect(button).toHaveAttribute('aria-describedby', reason.id);

    // A title alone is enough; validation is minimal by design.
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Sunday morning' } });
    expect(save()).toBeEnabled();
  });

  it('has exactly one h1 and no skipped heading levels', async () => {
    setup(<EntryEditor />);
    await notesBox();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New entry');
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});

describe('EntryEditor — anchors', () => {
  // Taken from whatever this build actually ships. Under `full` that is an
  // outline segment; under `refs-only` it is a whole chapter. Either way the
  // rule under test is the same one: the anchor stored is always a resolved
  // scripture range, and an outline id is only ever added on top of it.
  const segment = segmentsForBook('genesis')[1];
  const reference = refToString(segmentRef(segment, 'genesis'), 'Genesis');
  const removeChip = () =>
    screen.getByRole('button', {
      name: (name: string) => name.startsWith(`Remove ${reference}`),
    });

  it('resolves a segment id from the URL and stores a scripture ref, never an outline id alone', async () => {
    const { storage } = setup(<EntryEditor anchorParam={segment.id} />);
    await notesBox();

    expect(removeChip()).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Before the fall.' } });
    fireEvent.click(save());
    const entry = await savedEntry(storage);

    expect(entry.anchors).toHaveLength(1);
    expect(entry.anchors[0]).toMatchObject({
      kind: 'scripture',
      ...segmentRef(segment, 'genesis'),
    });
    if (segment.kind === 'outline') {
      expect(entry.anchors[0]).toMatchObject({ outlineEntryId: segment.id });
    } else {
      expect(entry.anchors[0]).not.toHaveProperty('outlineEntryId');
    }
  });

  it('ignores an anchor this build cannot resolve', async () => {
    setup(<EntryEditor anchorParam="not-a-real-segment-9-9" />);
    await notesBox();
    expect(screen.getByText('Not attached to anything yet.')).toBeInTheDocument();
  });

  it('lets an anchor be removed', async () => {
    setup(<EntryEditor anchorParam={segment.id} />);
    await notesBox();

    fireEvent.click(removeChip());
    expect(screen.getByText('Not attached to anything yet.')).toBeInTheDocument();
  });

  it('adds a topic anchor from the picker', async () => {
    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(screen.getByLabelText('Add a topic'), { target: { value: 'marriage' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add topic' }));
    expect(screen.getByText('Topic: Marriage')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'On covenant love.' } });
    fireEvent.click(save());
    const entry = await savedEntry(storage);
    expect(entry.anchors).toContainEqual({ kind: 'topic', topicId: 'marriage' });
  });

  /**
   * An entry written under `full` and reopened under `refs-only` carries
   * anchors whose outline ids resolve to nothing — as do anchors for a topic or
   * a book this build has never heard of. None of them may take the editor
   * down, and every one still has to name itself.
   */
  it('renders anchors that nothing in this build resolves, without crashing', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await storage.createEntry({
      notes: 'Written somewhere else.',
      anchors: [
        { kind: 'topic', topicId: 'no-such-topic' },
        { kind: 'book', book: 'no-such-book' },
        {
          kind: 'scripture',
          book: 'genesis',
          chapterStart: 1,
          verseStart: 1,
          chapterEnd: 1,
          verseEnd: 5,
          // An outline id from a build that had the outline layer.
          outlineEntryId: 'not-an-id-here',
        },
      ],
    });

    window.location.hash = `#/entry/${existing.id}`;
    render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={existing.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText('Notes')).toHaveValue('Written somewhere else.'),
    );
    // The unresolved names fall back to their ids rather than rendering blank.
    expect(screen.getByText('Topic: no-such-topic')).toBeInTheDocument();
    expect(screen.getByText('no-such-book')).toBeInTheDocument();
    // The scripture anchor names itself from its own range, never from the
    // outline layer, so it reads the same under both data profiles.
    expect(screen.getByText('Genesis 1:1-5')).toBeInTheDocument();
  });

  it('names a scripture anchor from its range, with no outline title assumed', async () => {
    setup(<EntryEditor anchorParam={segment.id} />);
    await notesBox();

    const chip = removeChip().getAttribute('aria-label') ?? '';
    expect(chip.startsWith(`Remove ${reference}`)).toBe(true);
    // Under refs-only there is no title to append, and the label is the bare
    // reference. Under full a title may follow it, but never replace it.
    if (!hasOutlineTitles) expect(chip).toBe(`Remove ${reference}`);
  });

  it('keeps focus on the page when an anchor is removed', async () => {
    setup(<EntryEditor anchorParam={segment.id} />);
    await notesBox();

    const chip = removeChip();
    chip.focus();
    fireEvent.click(chip);

    // The clicked button is gone. Focus must not fall to <body>, which would
    // drop a keyboard user back at the top of the document.
    expect(document.body).not.toHaveFocus();
    expect(screen.getByLabelText('Add a topic')).toHaveFocus();
    expect(await screen.findByText(/removed\.$/)).toHaveAttribute('aria-live', 'polite');
  });

  it('keeps focus on the page after a topic is added', async () => {
    setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(screen.getByLabelText('Add a topic'), { target: { value: 'marriage' } });
    const add = screen.getByRole('button', { name: 'Add topic' });
    add.focus();
    fireEvent.click(add);

    // Adding clears the choice, which disables this very button — and a
    // disabled element cannot hold focus.
    expect(add).toBeDisabled();
    expect(screen.getByLabelText('Add a topic')).toHaveFocus();
  });
});

describe('EntryEditor — details', () => {
  it('captures a link with what it pointed to, and makes no network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.click(screen.getByRole('button', { name: 'Add a link' }));
    fireEvent.change(screen.getByLabelText('Web address for link 1'), {
      target: { value: 'https://example.org/sermon-42' },
    });
    fireEvent.change(screen.getByLabelText('What this link is (link 1)'), {
      target: { value: 'Audio of the 8am service' },
    });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Linked.' } });
    fireEvent.click(save());
    const entry = await savedEntry(storage);
    expect(entry.links).toHaveLength(1);
    expect(entry.links[0].url).toBe('https://example.org/sermon-42');
    expect(entry.links[0].capturedTitle).toBe('Audio of the 8am service');
    expect(entry.links[0].capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  /**
   * A row with nothing but its display text is dropped on save. Save must not
   * light up for it either, or pressing it writes an entry with nothing in it
   * at all — a blank page in the book handed to a grandchild.
   */
  it('does not treat a link with only display text as something to save', async () => {
    setup(<EntryEditor />);
    await notesBox();

    fireEvent.click(screen.getByRole('button', { name: 'Add a link' }));
    fireEvent.change(screen.getByLabelText('Link text for link 1'), {
      target: { value: 'The audio' },
    });

    expect(save()).toBeDisabled();
    expect(screen.getByText(/Nothing to save yet/)).toBeInTheDocument();
  });

  it('keeps a link row once it has an address, and saves what is there', async () => {
    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.click(screen.getByRole('button', { name: 'Add a link' }));
    fireEvent.change(screen.getByLabelText('Link text for link 1'), {
      target: { value: 'The audio' },
    });
    fireEvent.change(screen.getByLabelText('Web address for link 1'), {
      target: { value: 'https://example.org/audio' },
    });

    expect(save()).toBeEnabled();
    fireEvent.click(save());
    const entry = await savedEntry(storage);
    expect(entry.links).toEqual([{ url: 'https://example.org/audio', label: 'The audio' }]);
  });

  it('moves focus into a new link row, and back out of a removed one', async () => {
    setup(<EntryEditor />);
    await notesBox();

    const addLink = screen.getByRole('button', { name: 'Add a link' });
    fireEvent.click(addLink);
    // The new row renders above the button that made it, so focus has to follow
    // it there rather than sitting behind it.
    await waitFor(() => expect(screen.getByLabelText('Web address for link 1')).toHaveFocus());

    const remove = screen.getByRole('button', { name: 'Remove link 1' });
    remove.focus();
    fireEvent.click(remove);

    expect(screen.queryByLabelText('Web address for link 1')).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(addLink).toHaveFocus();
  });

  it('parses comma-separated tags and drops repeats', async () => {
    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(screen.getByLabelText('Tags'), {
      target: { value: ' grace , patience, grace ,, ' },
    });
    fireEvent.click(save());
    const entry = await savedEntry(storage);
    expect(entry.tags).toEqual(['grace', 'patience']);
  });

  it('records the descendants choice', async () => {
    const { storage } = setup(<EntryEditor />);
    await notesBox();

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'For the children.' } });
    fireEvent.click(screen.getByLabelText('Include in the book for my descendants'));
    fireEvent.click(save());
    expect((await savedEntry(storage)).forDescendants).toBe(true);
  });
});

describe('EntryEditor — editing', () => {
  const seed = async (storage: DexieStorageProvider, patch: Partial<Entry> = {}) =>
    storage.createEntry({
      kind: 'sermon',
      title: 'Sunday morning',
      date: '2025-03-02',
      speaker: 'Pastor Ruiz',
      place: 'First Baptist',
      notes: 'Original notes.',
      reflection: 'Original reflection.',
      tags: ['grace'],
      ...patch,
    });

  it('loads the entry and opens the details panel when there is something in it', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await seed(storage);

    window.location.hash = `#/entry/${existing.id}`;
    const { container } = render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={existing.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('Original notes.'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Edit entry');
    expect(screen.getByLabelText('Speaker')).toHaveValue('Pastor Ruiz');
    expect(screen.getByLabelText('Tags')).toHaveValue('grace');
    expect(container.querySelector('details')?.open).toBe(true);

    // Editing does not steal the cursor; the shell owns focus on navigation.
    expect(screen.getByLabelText('Notes')).not.toHaveFocus();
  });

  it('leaves the details panel shut for an entry with nothing but notes', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await storage.createEntry({ notes: 'Just words.', date: '2025-04-01' });

    window.location.hash = `#/entry/${existing.id}`;
    const { container } = render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={existing.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('Just words.'));
    expect(container.querySelector('details')?.open).toBe(false);
  });

  it('saves changes back to the same entry', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await seed(storage);

    window.location.hash = `#/entry/${existing.id}`;
    render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={existing.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('Original notes.'));
    fireEvent.change(screen.getByLabelText('Reflection'), { target: { value: 'Changed my mind.' } });
    fireEvent.click(save());

    await waitFor(() => expect(window.location.hash).toBe(`#/entry/${existing.id}`));
    const entries = await storage.listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].reflection).toBe('Changed my mind.');
    expect(entries[0].notes).toBe('Original notes.');
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
  });

  it('shows a plain page when the entry is gone', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    window.location.hash = '#/entry/missing';
    render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId="missing" />
        </StorageContextProvider>
      </RouterProvider>,
    );

    expect(await screen.findByText('That entry is not here.')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('EntryEditor — the route switch reuses this instance', () => {
  // App.tsx renders <EntryEditor> for BOTH the "new entry" route and the entry
  // route, so React reuses the component when one becomes the other. Nothing
  // set during a save may survive into the view that follows it.
  const swapTo = (
    rerender: (ui: ReactElement) => void,
    storage: DexieStorageProvider,
    props: { entryId?: string; anchorParam?: string },
  ) =>
    rerender(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor {...props} />
        </StorageContextProvider>
      </RouterProvider>,
    );

  it('leaves a working editor behind after a new note becomes a saved one', async () => {
    const { storage, rerender } = setup(<EntryEditor />);
    fireEvent.change(await notesBox(), { target: { value: 'First words.' } });
    fireEvent.click(save());
    const entry = await savedEntry(storage);

    swapTo(rerender, storage, { entryId: entry.id });

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Edit entry'),
    );
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('First words.'));
    // Stuck on "Saving…" here would mean the entry could never be edited again.
    expect(save()).toBeEnabled();
  });

  /**
   * The route change lands a frame after the write, so there is a real window
   * in which Save is live again and `entryId` is still undefined. A second tap
   * in that window used to write a second copy of the same note.
   */
  it('does not write a second copy when Save is pressed twice', async () => {
    const { storage } = setup(<EntryEditor />);
    fireEvent.change(await notesBox(), { target: { value: 'Only once.' } });

    fireEvent.click(save());
    const first = await savedEntry(storage);
    await waitFor(() => expect(save()).toBeEnabled());

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Only once, edited.' } });
    fireEvent.click(save());

    await waitFor(async () => {
      const entries = await storage.listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe(first.id);
      expect(entries[0].notes).toBe('Only once, edited.');
    });
  });

  /**
   * Every piece of transient state has to be stood down when the target
   * changes. A delete confirmation left standing from the previous entry is one
   * tap away from destroying a note the reader never meant to touch.
   */
  it('does not carry a primed delete confirmation onto the next entry', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const first = await storage.createEntry({ notes: 'The first one.' });
    const second = await storage.createEntry({ notes: 'The second one.' });

    window.location.hash = `#/entry/${first.id}`;
    const { rerender } = render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={first.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('The first one.'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
    expect(screen.getByRole('button', { name: 'Yes, delete it' })).toBeInTheDocument();

    swapTo(rerender, storage, { entryId: second.id });

    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue('The second one.'));
    expect(screen.queryByRole('button', { name: 'Yes, delete it' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete this entry' })).toBeInTheDocument();
  });

  it('does not carry a missing entry over into a new one', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    window.location.hash = '#/entry/gone';
    const { rerender } = render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId="gone" />
        </StorageContextProvider>
      </RouterProvider>,
    );
    expect(await screen.findByText('That entry is not here.')).toBeInTheDocument();

    swapTo(rerender, storage, {});
    expect(await notesBox()).toBeInTheDocument();
    expect(screen.queryByText('That entry is not here.')).not.toBeInTheDocument();
  });
});

describe('EntryEditor — delete', () => {
  const renderEdit = async (storage: DexieStorageProvider, id: string) => {
    window.location.hash = `#/entry/${id}`;
    render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          <EntryEditor entryId={id} />
        </StorageContextProvider>
      </RouterProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Notes')).toBeInTheDocument());
  };

  it('confirms in the page, never with window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await storage.createEntry({ notes: 'To be deleted.' });
    await renderEdit(storage, existing.id);

    fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));

    const confirmButton = screen.getByRole('button', { name: 'Yes, delete it' });
    expect(confirmButton).toHaveFocus();
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(confirmButton);
    await waitFor(() => expect(window.location.hash).toBe('#/timeline'));
    expect(await storage.listEntries()).toHaveLength(0);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('backs out of the confirm without deleting, and hands focus back', async () => {
    const storage = new DexieStorageProvider(`journey-test-${(counter += 1)}`);
    const existing = await storage.createEntry({ notes: 'Keep me.' });
    await renderEdit(storage, existing.id);

    fireEvent.click(screen.getByRole('button', { name: 'Delete this entry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep this entry' }));

    expect(screen.queryByRole('button', { name: 'Yes, delete it' })).not.toBeInTheDocument();
    expect(await storage.listEntries()).toHaveLength(1);
    // Backing out unmounts the button that was clicked; focus goes to the one
    // that replaces it rather than dropping to <body>.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Delete this entry' })).toHaveFocus(),
    );
  });

  it('offers no delete when there is nothing saved yet', async () => {
    setup(<EntryEditor />);
    await notesBox();
    expect(screen.queryByRole('button', { name: 'Delete this entry' })).not.toBeInTheDocument();
  });
});

describe('EntryEditor — unsaved changes', () => {
  const fireBeforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('does not warn on a form nobody has touched', async () => {
    setup(<EntryEditor />);
    await notesBox();
    expect(fireBeforeUnload()).toBe(false);
  });

  it('warns once there are words in it, and stops warning after a save', async () => {
    const { storage } = setup(<EntryEditor />);
    fireEvent.change(await notesBox(), { target: { value: 'Half a thought.' } });
    expect(fireBeforeUnload()).toBe(true);

    fireEvent.click(save());
    await savedEntry(storage);
    await waitFor(() => expect(fireBeforeUnload()).toBe(false));
  });
});

describe('EntryEditor — accessibility of the controls', () => {
  it('gives every control a real label and a 44px target', async () => {
    const { container } = setup(<EntryEditor />);
    await notesBox();

    // No control relies on a placeholder for its name.
    for (const control of container.querySelectorAll('input, select, textarea')) {
      expect(control.getAttribute('placeholder')).toBeNull();
      expect(control.id).toBeTruthy();
      expect(container.querySelector(`label[for="${CSS.escape(control.id)}"]`)).not.toBeNull();
    }

    // Buttons come from the shared primitive, which carries min-h-11 (44px).
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-11');
    }
  });

  it('uses a native details element so the optional fields work without JS', async () => {
    const { container } = setup(<EntryEditor />);
    await notesBox();

    const details = container.querySelector('details');
    const summary = details?.querySelector('summary');
    expect(summary).not.toBeNull();
    expect(within(summary as HTMLElement).getByText('Details')).toBeInTheDocument();
  });
});
