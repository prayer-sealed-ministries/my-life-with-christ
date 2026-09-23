/**
 * The central acceptance rule of the startup lane.
 *
 * A person taps the widget during a sermon. The claim this file holds is that
 * everything between that tap and their first sentence works while the
 * Scripture section data has NOT arrived — and, in the strongest form
 * available, while it never arrives at all.
 *
 * A stopwatch cannot assert that. A stopwatch measures a machine on a Tuesday;
 * it passes on a fast laptop with the dependency fully intact, and it is
 * exactly the kind of check this repository has been caught by before. So the
 * loader is HELD — a promise that never settles — and the editor is asked to
 * do its whole job anyway. If any part of the capture path still reaches for
 * the divisions, it hangs here, deterministically, on every machine.
 *
 * This is the test that decides whether the dependency separation is real. If
 * it cannot pass, the separation is incomplete, whatever the bundle sizes say.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';

import { __setSectionsLoader, loadSections, sectionsIfLoaded } from '../app/sections';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import EntryEditor from './EntryEditor';

let counter = 0;

function setup(ui: ReactElement, hash: string) {
  window.location.hash = hash;
  const storage = new DexieStorageProvider(`journey-fastcap-${(counter += 1)}`);
  const view = render(
    <RouterProvider>
      <StorageContextProvider provider={storage}>{ui}</StorageContextProvider>
    </RouterProvider>,
  );
  return { storage, ...view };
}

/**
 * A loader that never settles, and a record of whether it was even asked.
 *
 * Two different facts, and both are worth having. "Did the capture path
 * survive without the data" is the acceptance rule; "did it ask at all" is the
 * sharper question, because a path that asks and then happens not to need the
 * answer would still pay the download on a real device.
 */
function heldLoader() {
  const state = { asked: 0 };
  __setSectionsLoader(() => {
    state.asked += 1;
    return new Promise(() => {});
  });
  return state;
}

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  // Back to the bundled loader, so no later file inherits a held one.
  __setSectionsLoader();
});

describe('Fast Capture does not wait for Scripture section data', () => {
  it('opens, focuses, accepts typing and saves a draft while the loader never resolves', async () => {
    const held = heldLoader();
    const { storage } = setup(<EntryEditor />, '#/entry/new?kind=sermon');

    // 1. The editor renders at all.
    const notes = await screen.findByLabelText('Notes');

    // 2. The kind is the one that was asked for, not a default.
    expect((screen.getByLabelText('Kind') as HTMLSelectElement).value).toBe('sermon');

    // 3. Notes has the cursor, without a tap.
    await waitFor(() => expect(document.activeElement).toBe(notes));

    // 4. Typing is accepted and reaches the form.
    const sentence = 'He began in Habakkuk, of all places.';
    fireEvent.change(notes, { target: { value: sentence } });
    expect((notes as HTMLTextAreaElement).value).toBe(sentence);

    // 5. The crash-safe draft is written — the promise Fast Capture actually
    //    makes. Everything above could be true of a form that loses the text.
    await waitFor(async () => {
      const drafts = await storage.listDrafts();
      expect(drafts).toHaveLength(1);
      expect(drafts[0].form.notes).toBe(sentence);
      expect(drafts[0].form.kind).toBe('sermon');
    });

    // 6. And none of it woke the divisions.
    expect(held.asked).toBe(0);
    expect(sectionsIfLoaded()).toBeNull();
  });

  it('is still true for a plain new entry with no kind at all', async () => {
    const held = heldLoader();
    const { storage } = setup(<EntryEditor />, '#/entry/new');

    const notes = await screen.findByLabelText('Notes');
    fireEvent.change(notes, { target: { value: 'Something to keep.' } });

    await waitFor(async () => expect((await storage.listDrafts()).length).toBe(1));
    expect(held.asked).toBe(0);
  });

  /**
   * The other half of the claim, and the one that stops this from being a test
   * for an editor that simply dropped the feature.
   *
   * Reaching for Scripture is what asks for the data. The passage picker is
   * the reader doing exactly that, so the request is not merely allowed here —
   * it is required, or the picker would be permanently empty.
   */
  it('asks for the divisions as soon as the reader reaches for a passage', async () => {
    const held = heldLoader();
    setup(<EntryEditor />, '#/entry/new?kind=sermon');
    await screen.findByLabelText('Notes');
    expect(held.asked).toBe(0);

    fireEvent.change(screen.getByLabelText('Add a passage'), {
      target: { value: 'samaritan' },
    });

    await waitFor(() => expect(held.asked).toBe(1));
  });

  /**
   * While the picker is waiting it says nothing, rather than saying something
   * false.
   *
   * "Nothing matched" computed against divisions that have not arrived is a
   * confident wrong answer, and it is the specific failure a reader would act
   * on — they would go and type a reference they did not need to type.
   */
  it('does not report "nothing matched" before the divisions have arrived', async () => {
    heldLoader();
    setup(<EntryEditor />, '#/entry/new?kind=sermon');
    await screen.findByLabelText('Notes');

    fireEvent.change(screen.getByLabelText('Add a passage'), {
      target: { value: 'samaritan woman' },
    });

    await waitFor(() => {
      expect(screen.queryByText(/Nothing matched/i)).toBeNull();
    });
  });

  /**
   * Parity with the product, asserted rather than assumed.
   *
   * Everything above runs against a substituted loader. That is a substitution
   * of TIMING only, and this is the check that keeps it so: the default loader
   * — the one the application ships — resolves real divisions from the same
   * generated module. Without this, every test in this file could be passing
   * against a seam that no longer resembles what runs on a phone.
   */
  it('restores a loader that yields the divisions this build actually ships', async () => {
    __setSectionsLoader();
    const sections = await loadSections();

    // Under refs-only this is legitimately empty, so the floor is on the
    // mechanism rather than on a count that only one profile can meet.
    expect(typeof sections.segmentsForBook).toBe('function');
    const john = sections.segmentsForBook('john');
    expect(john.length).toBeGreaterThan(0);
    expect(sections.segmentContaining('john', 15, 5)).toBeDefined();
  });
});
