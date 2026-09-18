/**
 * A save has to be visible, not only audible.
 *
 * The bug this exists for was found on a real iPhone, by the owner, and it is
 * worth writing down because every automated check passed straight through it.
 * Saving confirmed itself into an `sr-only` live region and nothing else. The
 * write committed; the screen did not change, because saving an entry routes to
 * the same editor showing the same entry. A sighted reader saw a button flicker
 * and concluded, reasonably, that their journal was not being kept — and saved
 * the same entry three times in four minutes trying to make it work.
 *
 * The existing tests all asked "did it persist?", which was true the whole
 * time. None asked "could a person tell?". That is the question here.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import EntryEditor from './EntryEditor';

let counter = 0;

function setup(ui: ReactElement, hash = '#/entry/new') {
  window.location.hash = hash;
  const storage = new DexieStorageProvider(`journey-saved-notice-${(counter += 1)}`);
  const view = render(
    <RouterProvider>
      <StorageContextProvider provider={storage}>{ui}</StorageContextProvider>
    </RouterProvider>,
  );
  return { storage, ...view };
}

const notesBox = () => screen.findByLabelText('Notes');
const saveButton = () => screen.getByRole('button', { name: 'Save' });

/** The confirmation as a person sees it: on screen, not only announced. */
const visibleConfirmation = () =>
  screen.queryAllByText(/^(Entry saved\.|Changes saved\.)$/).find((node) => {
    // `sr-only` is the live region. A confirmation that only exists there is
    // precisely the defect, so it does not count as having been seen.
    return !node.className.includes('sr-only');
  });

afterEach(cleanup);

describe('a saved entry says so where it can be seen', () => {
  it('shows nothing before anything has been saved', async () => {
    setup(<EntryEditor />);
    await notesBox();

    expect(visibleConfirmation(), 'a confirmation appeared before any save').toBeUndefined();
  });

  it('confirms a new entry visibly, not only to a screen reader', async () => {
    const { storage } = setup(<EntryEditor />);
    fireEvent.change(await notesBox(), { target: { value: 'Something worth keeping.' } });
    fireEvent.click(saveButton());

    // It really did save — the point is that this alone was never the problem.
    await waitFor(async () => expect(await storage.listEntries()).toHaveLength(1));

    await waitFor(() => {
      expect(visibleConfirmation(), 'the save was never confirmed on screen').toBeTruthy();
    });
    expect(visibleConfirmation()!.textContent).toMatch(/Entry saved\./);
  });

  it('still announces it to a screen reader', async () => {
    // The old behaviour was not wrong, only insufficient. It must survive.
    const { storage } = setup(<EntryEditor />);
    fireEvent.change(await notesBox(), { target: { value: 'Announced too.' } });
    fireEvent.click(saveButton());
    await waitFor(async () => expect(await storage.listEntries()).toHaveLength(1));

    const announced = screen
      .queryAllByText('Entry saved.')
      .find((node) => node.className.includes('sr-only'));
    expect(announced, 'the screen-reader announcement was lost').toBeTruthy();
    expect(announced!.getAttribute('aria-live')).toBe('polite');
  });

  it('takes the confirmation back down as soon as there is something unsaved', async () => {
    // A confirmation that outlives what it describes is worse than none: it
    // tells a reader their newest words are safe when they are not.
    const { storage } = setup(<EntryEditor />);
    fireEvent.change(await notesBox(), { target: { value: 'First pass.' } });
    fireEvent.click(saveButton());
    await waitFor(async () => expect(await storage.listEntries()).toHaveLength(1));
    await waitFor(() => expect(visibleConfirmation()).toBeTruthy());

    fireEvent.change(await notesBox(), { target: { value: 'First pass, now edited.' } });

    await waitFor(() => {
      expect(
        visibleConfirmation(),
        'it still claimed the entry was saved after further typing',
      ).toBeUndefined();
    });
  });

  it('does not describe an edit as a new entry', async () => {
    const storage = new DexieStorageProvider(`journey-saved-notice-${(counter += 1)}`);
    const existing = await storage.createEntry({ notes: 'Already here.' });
    window.location.hash = `#/entry/${existing.id}`;
    render(
      <RouterProvider>
        <StorageContextProvider provider={storage}>
          {/* `entryId` is a prop, not read from the hash — setting the hash
              alone leaves this in "new entry" mode and the case proves
              nothing. */}
          <EntryEditor entryId={existing.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );

    fireEvent.change(await notesBox(), { target: { value: 'Already here, revised.' } });
    fireEvent.click(saveButton());

    await waitFor(() => {
      const shown = visibleConfirmation();
      expect(shown, 'an edit was never confirmed on screen').toBeTruthy();
      expect(shown!.textContent).toMatch(/Changes saved\./);
    });
  });
});
