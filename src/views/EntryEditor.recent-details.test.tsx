/**
 * Offering back details the reader has already saved.
 *
 * Every Sunday asks for the same church, the same preacher, the same series.
 * The promise is one tap instead of typing it again — and, just as firmly,
 * that the app never decides any of it for them. A field opens empty and stays
 * empty until somebody presses something.
 *
 * Driven through the real editor over a real Dexie store, because the parts
 * that could go wrong are wiring: where the values come from, when they are
 * read, and whether a tap is indistinguishable from typing.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EntryEditor from './EntryEditor';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import { DRAFT_DEBOUNCE_MS } from '../lib/drafts';
import { SUGGESTION_LIMIT } from '../lib/recent-details';
import type { Entry } from '../types';

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
  storeName = `recent-details-${(counter += 1)}`;
  db = await open(storeName);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Open the disclosure the way a reader does, and prove it opened. */
function openDetails(container: HTMLElement) {
  const details = container.querySelector('details') as HTMLDetailsElement;
  fireEvent.click(details.querySelector('summary') as HTMLElement);
  if (!details.open) {
    // jsdom does not always toggle from the click alone; drive the element and
    // let React hear about it exactly as the browser would.
    details.open = true;
    fireEvent(details, new Event('toggle'));
  }
  expect(details.open, 'the Details panel did not open').toBe(true);
  return details;
}

/** The chips offered for one field, in the order they are shown. */
const chipsFor = async (spoken: string) => {
  const found = await screen.findAllByRole('button', { name: new RegExp(`^Use ${spoken} `) });
  return found.map((button) => button.textContent?.trim() ?? '');
};
const chipsForNow = (spoken: string) =>
  screen
    .queryAllByRole('button', { name: new RegExp(`^Use ${spoken} `) })
    .map((button) => button.textContent?.trim() ?? '');

const saved = (overrides: Partial<Entry> = {}) =>
  db.createEntry({ title: 'A Sunday', notes: 'Something.', ...overrides });

describe('where the suggestions come from', () => {
  it('offers details from entries that were actually saved', async () => {
    await saved({ place: 'City Gate Church', speaker: 'Pastor John', sermonSeries: 'James' });

    const { container } = mount(db);
    await notes();
    openDetails(container);

    expect(await chipsFor('place')).toEqual(['City Gate Church']);
    expect(await chipsFor('speaker')).toEqual(['Pastor John']);
    expect(await chipsFor('series')).toEqual(['James']);
  });

  it('never offers something left in an unfinished draft', async () => {
    // Half-typed work in another editor is not a decision, and must not come
    // back as though it were.
    await db.putDraft({
      id: 'unfinished',
      form: {
        kind: 'sermon',
        title: '',
        date: '2026-03-01',
        place: '',
        speaker: 'NEVER-SUGGEST-DRAFT',
        sermonSeries: '',
        notes: 'Started only.',
        reflection: '',
        prayer: '',
        tagsText: '',
        links: [],
        anchors: [],
        forDescendants: false,
        scriptureRefs: [],
        sourceMaterial: null,
      },
      createdAt: '2026-03-01T09:00:00.000Z',
      updatedAt: '2026-03-01T09:00:00.000Z',
    });
    await saved({ speaker: 'Pastor John' });

    const { container } = mount(db);
    await notes();
    openDetails(container);

    await waitFor(async () => expect(await chipsFor('speaker')).toEqual(['Pastor John']));
    expect(chipsForNow('speaker')).not.toContain('NEVER-SUGGEST-DRAFT');
  });

  it('stops offering a value once the only entry holding it is deleted', async () => {
    const entry = await saved({ speaker: 'Pastor John' });
    await saved({ speaker: 'Rev. Smith' });
    await db.deleteEntry(entry.id);

    const { container } = mount(db);
    await notes();
    openDetails(container);

    await waitFor(async () => expect(await chipsFor('speaker')).toEqual(['Rev. Smith']));
  });

  it('follows an edit to the canonical entry', async () => {
    const entry = await saved({ speaker: 'Pastor John' });
    await db.updateEntry(entry.id, { speaker: 'Pastor Michael' });

    const { container } = mount(db);
    await notes();
    openDetails(container);

    await waitFor(async () => expect(await chipsFor('speaker')).toEqual(['Pastor Michael']));
  });
});

describe('what is shown', () => {
  it('shows each value once, newest first', async () => {
    // Saved oldest to newest; listEntries hands them back the other way.
    await saved({ date: '2026-01-04', sermonSeries: 'James' });
    await saved({ date: '2026-01-11', sermonSeries: 'James' });
    await saved({ date: '2026-01-18', sermonSeries: 'Romans' });
    await saved({ date: '2026-01-25', sermonSeries: 'James' });

    const { container } = mount(db);
    await notes();
    openDetails(container);

    await waitFor(async () =>
      expect(await chipsFor('series'), 'four Sundays, two series').toEqual(['James', 'Romans']),
    );
  });

  it('puts the most recently used first, not the oldest', async () => {
    /*
     * Asymmetric on purpose. A history whose distinct values read the same
     * either way cannot tell a newest-first list from an oldest-first one, and
     * the obvious series example — James, James, Romans, James — is exactly
     * that shape. This one is not.
     */
    await saved({ date: '2026-01-04', sermonSeries: 'Romans' });
    await saved({ date: '2026-01-11', sermonSeries: 'James' });
    await saved({ date: '2026-01-18', sermonSeries: 'James' });

    const { container } = mount(db);
    await notes();
    openDetails(container);

    await waitFor(async () => expect(await chipsFor('series')).toEqual(['James', 'Romans']));
  });

  it('keeps the spelling most recently saved', async () => {
    await saved({ date: '2026-01-04', speaker: 'pastor john' });
    await saved({ date: '2026-01-11', speaker: 'Pastor John' });

    const { container } = mount(db);
    await notes();
    openDetails(container);

    await waitFor(async () => expect(await chipsFor('speaker')).toEqual(['Pastor John']));
  });

  it('shows no more than the limit, however long the history', async () => {
    for (let week = 1; week <= SUGGESTION_LIMIT + 4; week += 1) {
      await saved({ date: `2026-02-${String(week).padStart(2, '0')}`, place: `Church ${week}` });
    }

    const { container } = mount(db);
    await notes();
    openDetails(container);

    await waitFor(async () => expect((await chipsFor('place')).length).toBe(SUGGESTION_LIMIT));
  });

  it('offers nothing on a first visit, rather than an empty shelf', async () => {
    const { container } = mount(db);
    await notes();
    openDetails(container);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chipsForNow('speaker')).toEqual([]);
    expect(screen.queryByText('Recent'), 'an empty heading is furniture').toBeNull();
  });
});

describe('nothing is filled in for anybody', () => {
  it('opens a new entry with the fields still empty, suggestions or not', async () => {
    await saved({ place: 'City Gate Church', speaker: 'Pastor John', sermonSeries: 'James' });

    const { container } = mount(db);
    await notes();
    openDetails(container);
    await waitFor(async () => expect(await chipsFor('speaker')).toEqual(['Pastor John']));

    expect(field('Place').value, 'the most recent church was filled in').toBe('');
    expect(field('Speaker').value, 'the most recent speaker was filled in').toBe('');
    expect(field('Series').value, 'a series was chosen for the reader').toBe('');
  });

  it('writes no draft merely for having shown them', async () => {
    await saved({ place: 'City Gate Church', speaker: 'Pastor John', sermonSeries: 'James' });

    const { container } = mount(db);
    await notes();
    openDetails(container);
    await waitFor(async () => expect(await chipsFor('speaker')).toEqual(['Pastor John']));
    await new Promise((resolve) => setTimeout(resolve, DRAFT_DEBOUNCE_MS * 4));

    expect(
      await db.listDrafts(),
      'rendering a suggestion is not the reader beginning to write',
    ).toHaveLength(0);
  });
});

describe('choosing one', () => {
  it('puts the value in the field, and lets it be edited afterwards', async () => {
    await saved({ speaker: 'Pastor James' });

    const { container } = mount(db);
    await notes();
    openDetails(container);
    fireEvent.click(await screen.findByRole('button', { name: 'Use speaker Pastor James' }));

    expect(field('Speaker').value).toBe('Pastor James');

    type('Speaker', 'Pastor James Jr.');
    expect(field('Speaker').value, 'the reader’s own edit must win').toBe('Pastor James Jr.');
  });

  it('lets the field be cleared again, with nothing locking it', async () => {
    await saved({ place: 'City Gate Church' });

    const { container } = mount(db);
    await notes();
    openDetails(container);
    fireEvent.click(await screen.findByRole('button', { name: 'Use place City Gate Church' }));
    expect(field('Place').value).toBe('City Gate Church');

    type('Place', '');
    expect(field('Place').value).toBe('');
    expect(
      screen.getByRole('button', { name: 'Use place City Gate Church' }),
      'the suggestion should still be there to pick again',
    ).toBeTruthy();
  });

  it('lets a different one be picked instead', async () => {
    await saved({ date: '2026-01-04', speaker: 'Rev. Smith' });
    await saved({ date: '2026-01-11', speaker: 'Pastor John' });

    const { container } = mount(db);
    await notes();
    openDetails(container);
    fireEvent.click(await screen.findByRole('button', { name: 'Use speaker Pastor John' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use speaker Rev. Smith' }));

    expect(field('Speaker').value).toBe('Rev. Smith');
  });

  it('saves exactly like a typed value', async () => {
    await saved({ speaker: 'Pastor James', place: 'City Gate Church' });

    const { container } = mount(db);
    await notes();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'This week.' } });
    openDetails(container);
    fireEvent.click(await screen.findByRole('button', { name: 'Use speaker Pastor James' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use place City Gate Church' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await db.listEntries()).length).toBe(2));
    const [newest] = await db.listEntries();
    expect(newest.speaker).toBe('Pastor James');
    expect(newest.place).toBe('City Gate Church');
  });

  it('is kept by the crash-safe draft like any other writing', async () => {
    await saved({ speaker: 'Pastor James' });

    const { container } = mount(db);
    await notes();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Half a sermon.' } });
    openDetails(container);
    fireEvent.click(await screen.findByRole('button', { name: 'Use speaker Pastor James' }));

    await waitFor(async () => {
      const [draft] = await db.listDrafts();
      expect(draft?.form.speaker, 'the chosen speaker was not in the recovery draft').toBe(
        'Pastor James',
      );
      expect(draft?.form.notes).toBe('Half a sermon.');
    });
    expect(await db.listEntries(), 'choosing a suggestion must not create an entry').toHaveLength(1);
  });
});

describe('an entry that already exists', () => {
  it('leaves the saved value alone and writes no draft for opening Details', async () => {
    const entry = await saved({ speaker: 'Rev. Smith', notes: 'The original notes.' });
    await saved({ date: '2026-02-01', speaker: 'Pastor John' });
    window.location.hash = `#/entry/${entry.id}`;

    const { container } = mount(db, { entryId: entry.id });
    await notes();
    openDetails(container);
    await waitFor(async () => expect((await chipsFor('speaker')).length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, DRAFT_DEBOUNCE_MS * 4));

    expect(field('Speaker').value, 'the saved speaker was overwritten').toBe('Rev. Smith');
    expect(
      await db.listDrafts(),
      'reading an entry with Details open is not unfinished work',
    ).toHaveLength(0);
  });

  it('treats picking a different one as a real edit, and going back as no edit at all', async () => {
    const entry = await saved({ speaker: 'Rev. Smith' });
    await saved({ date: '2026-02-01', speaker: 'Pastor John' });
    window.location.hash = `#/entry/${entry.id}`;

    const { container } = mount(db, { entryId: entry.id });
    await notes();
    openDetails(container);
    fireEvent.click(await screen.findByRole('button', { name: 'Use speaker Pastor John' }));

    await waitFor(async () => expect((await db.listDrafts()).length).toBe(1));

    // Back to what the journal holds: there is nothing left to recover.
    fireEvent.click(screen.getByRole('button', { name: 'Use speaker Rev. Smith' }));
    await waitFor(async () => expect(await db.listDrafts()).toHaveLength(0));
  });
});

describe('fast capture pays nothing for this', () => {
  it('does not read the journal until Details is opened', async () => {
    await saved({ speaker: 'Pastor John' });
    const readEntries = vi.spyOn(db, 'listEntries');

    const { container } = mount(db);
    await notes();
    // The notes box is up and usable. Nothing has gone looking through the
    // journal for last week's preacher.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      readEntries,
      'the journal was read before Details was even opened',
    ).not.toHaveBeenCalled();

    openDetails(container);
    await waitFor(() => expect(readEntries).toHaveBeenCalled());
  });

  it('reads once, however often Details is opened and shut', async () => {
    await saved({ speaker: 'Pastor John' });
    const readEntries = vi.spyOn(db, 'listEntries');

    const { container } = mount(db);
    await notes();
    const details = openDetails(container);
    await waitFor(() => expect(readEntries).toHaveBeenCalledTimes(1));

    for (let visit = 0; visit < 3; visit += 1) {
      details.open = false;
      fireEvent(details, new Event('toggle'));
      details.open = true;
      fireEvent(details, new Event('toggle'));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(readEntries, 'the journal was re-read on every toggle').toHaveBeenCalledTimes(1);
  });
});
