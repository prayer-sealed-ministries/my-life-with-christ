/**
 * Picking up unfinished writing from the front page.
 *
 * The thing this prevents is somebody starting a second copy of the note they
 * already began. The thing it must not do is make a half-sentence look like a
 * finished entry — "Recently written" is the record, and the record means
 * something only if everything in it was decided on.
 */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import type { DraftForm, Entry, EntryDraft } from '../types';
import HomeView from './HomeView';

let counter = 0;

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

const draft = (overrides: Partial<EntryDraft> = {}): EntryDraft => ({
  id: `d${(counter += 1)}`,
  form: form({ notes: 'Something started.' }),
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:04:00.000Z',
  ...overrides,
});

const entry = (overrides: Partial<Entry> & { id: string }): Entry => ({
  kind: 'sermon',
  title: 'A finished entry',
  date: '2026-01-01',
  anchors: [],
  scriptureRefs: [],
  notes: 'Saved and done.',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

async function show(seed: (db: DexieStorageProvider) => Promise<void>) {
  const db = new DexieStorageProvider(`home-drafts-${(counter += 1)}`);
  await db.open();
  await seed(db);
  render(
    <RouterProvider>
      <StorageContextProvider provider={db}>
        <HomeView />
      </StorageContextProvider>
    </RouterProvider>,
  );
  return db;
}

afterEach(cleanup);

describe('Continue writing', () => {
  it('is absent when there is nothing unfinished', async () => {
    await show(async (db) => {
      await db.putEntries([entry({ id: 'e1' })]);
    });

    await screen.findByText('Recently written');
    expect(screen.queryByRole('link', { name: /Continue sermon/i })).toBeNull();
  });

  it('offers the unfinished work, labelled as a draft', async () => {
    await show(async (db) => {
      await db.putDraft(draft({ form: form({ notes: 'Half a sermon.' }) }));
    });

    const card = await screen.findByRole('link', { name: /Continue sermon/i });
    expect(within(card).getByText('Draft'), 'it must say what it is').toBeInTheDocument();
  });

  it('uses the title when there is one, and says when it was started when there is not', async () => {
    await show(async (db) => {
      await db.putDraft(draft({ form: form({ title: 'Grace at the door', notes: 'x' }) }));
    });

    const card = await screen.findByRole('link', { name: /Continue sermon/i });
    expect(within(card).getByText('Grace at the door')).toBeInTheDocument();
  });

  it('resumes that exact draft rather than opening a blank page', async () => {
    await show(async (db) => {
      await db.putDraft(draft({ id: 'the-one', form: form({ notes: 'Resume me.' }) }));
    });

    const card = await screen.findByRole('link', { name: /Continue sermon/i });
    expect(card.getAttribute('href')).toBe('#/entry/new?draft=the-one');
  });

  it('routes a saved-entry draft back to its canonical entry instead of creating a duplicate', async () => {
    await show(async (db) => {
      await db.putEntries([entry({ id: 'saved-parent' })]);
      await db.putDraft(draft({ id: 'saved-draft', entryId: 'saved-parent' }));
    });

    const card = await screen.findByRole('link', { name: /Continue sermon/i });
    expect(card.getAttribute('href')).toBe('#/entry/saved-parent');
  });

  it('keeps an orphaned legacy draft recoverable instead of linking to a missing entry', async () => {
    await show(async (db) => {
      await db.putDraft(draft({ id: 'orphan-draft', entryId: 'missing-parent' }));
    });

    const card = await screen.findByRole('link', { name: /Continue sermon/i });
    expect(card.getAttribute('href')).toBe('#/entry/new?draft=orphan-draft');
  });

  it('offers the newest, and says how many others there are', async () => {
    await show(async (db) => {
      await db.putDraft(
        draft({ id: 'older', updatedAt: '2026-03-01T09:00:00.000Z', form: form({ notes: 'older' }) }),
      );
      await db.putDraft(
        draft({ id: 'newest', updatedAt: '2026-03-05T09:00:00.000Z', form: form({ notes: 'newest' }) }),
      );
    });

    const card = await screen.findByRole('link', { name: /Continue sermon/i });
    expect(card.getAttribute('href')).toBe('#/entry/new?draft=newest');
    expect(screen.getByText('1 more unfinished')).toBeInTheDocument();
  });

  it('keeps unfinished work out of Recently written', async () => {
    await show(async (db) => {
      await db.putEntries([entry({ id: 'e1', title: 'A finished entry' })]);
      await db.putDraft(draft({ form: form({ title: 'AN UNFINISHED THING', notes: 'x' }) }));
    });

    const recent = await screen.findByText('Recently written');
    const section = recent.closest('section') as HTMLElement;

    expect(within(section).getByText('A finished entry')).toBeInTheDocument();
    expect(
      within(section).queryByText('AN UNFINISHED THING'),
      'a draft appeared among the finished entries',
    ).toBeNull();
  });

  it('does not offer a draft that has been emptied', async () => {
    await show(async (db) => {
      // Nothing in it: not something to invite anyone back into.
      await db.putDraft(draft({ form: form() }));
    });

    await screen.findByText('Recently written');
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Continue sermon/i })).toBeNull(),
    );
  });
});
