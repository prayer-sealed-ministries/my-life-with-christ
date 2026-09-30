/**
 * Opening a blank entry as a particular kind, through the real application.
 *
 * Home now has a Prayer card and a Reflection card, and the only thing that
 * makes them honest is that the route carries the request and the editor acts
 * on it. Both halves have to be exercised together: a parser test proves the
 * hash reads, and a rendered editor proves the field was actually seeded —
 * neither proves the wire between them, which is the part that would be quietly
 * missing if `kindParam` were accepted and never read.
 *
 * So this drives the real router, the real key-per-route switch and the real
 * Shell, saves through the `#/entry/new` -> `#/entry/<id>` transition that
 * remounts the editor, and reads the kind back out of storage afterwards.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import App from '../App';
import { FocusProvider } from '../app/focus';
import { NoticeProvider } from '../app/notice';
import { registerOverlay } from '../app/overlay';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { ThemeProvider } from '../app/theme';
import { ENTRY_KINDS, ENTRY_KIND_LABELS } from '../lib/entry-kinds';
import { PlatformProvider } from '../platform/provider';
import { DexieStorageProvider } from '../storage/db';

let dbCounter = 0;
let db: DexieStorageProvider;

function renderApp() {
  return render(
    <PlatformProvider>
      <ThemeProvider>
        <StorageContextProvider provider={db}>
          <RouterProvider>
            <NoticeProvider>
              <FocusProvider>
                <App />
              </FocusProvider>
            </NoticeProvider>
          </RouterProvider>
        </StorageContextProvider>
      </ThemeProvider>
    </PlatformProvider>,
  );
}

const notesBox = () => screen.findByLabelText('Notes', { exact: true });
const kindField = () => screen.getByLabelText('Kind', { exact: true }) as HTMLSelectElement;
const saveButton = () => screen.getByRole('button', { name: 'Save' });

/** Open a hash and wait for the editor behind it. */
async function open(hash: string) {
  window.location.hash = hash;
  renderApp();
  await notesBox();
}

beforeEach(async () => {
  // A save queues its navigation on the next animation frame, and that callback
  // can outlive the unmount and rewrite the hash mid-test.
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.location.hash = '#/entry/new';
  localStorage.setItem('journey:welcomed', '1');
  db = new DexieStorageProvider(`journey-kind-route-${(dbCounter += 1)}`);
});

afterEach(() => {
  cleanup();
  registerOverlay(null);
  localStorage.clear();
});

describe('what a blank entry opens as', () => {
  it('is a sermon when the route asks for nothing, exactly as before', async () => {
    await open('#/entry/new');
    expect(kindField().value, '#/entry/new stopped meaning what it always meant').toBe('sermon');
  });

  it('is whatever the route asked for — every kind, not just the two on Home', async () => {
    // Driven over the whole list so a sixth kind cannot be added to the model
    // and silently left unreachable by a link.
    for (const kind of ENTRY_KINDS) {
      await open(`#/entry/new?kind=${kind}`);
      expect(kindField().value, `${kind} did not reach the editor`).toBe(kind);
      // And the reader can see which one it is, not merely the machine value.
      expect(kindField().selectedOptions[0].text).toBe(ENTRY_KIND_LABELS[kind]);
      cleanup();
    }
  }, 30_000);

  it('is a sermon when the route asks for something that does not exist', async () => {
    await open('#/entry/new?kind=garbage');
    expect(kindField().value, 'a made-up kind reached the editor').toBe('sermon');
  });

  it('never writes a kind the model does not have', async () => {
    // The check the field cannot make. A <select> given a value none of its
    // options carry reports the first option's value, so reading the control
    // back says "sermon" and looks reassuring while the form state still holds
    // the string from the URL — and that is what a save would persist. So this
    // asks the database instead.
    await open('#/entry/new?kind=garbage');
    fireEvent.change(await notesBox(), { target: { value: 'Written anyway.' } });
    fireEvent.click(saveButton());

    await waitFor(async () => {
      const entries = await db.listEntries();
      expect(entries).toHaveLength(1);
      expect(
        ENTRY_KINDS as readonly string[],
        `a kind of "${entries[0].kind}" reached storage`,
      ).toContain(entries[0].kind);
      expect(entries[0].kind).toBe('sermon');
    });
  }, 20_000);

  it('is still the reader’s to change before anything is written down', async () => {
    await open('#/entry/new?kind=prayer');
    expect(kindField().value).toBe('prayer');

    fireEvent.change(kindField(), { target: { value: 'letter' } });
    fireEvent.change(await notesBox(), { target: { value: 'Dear Sarah,' } });
    fireEvent.click(saveButton());

    await waitFor(async () => {
      const entries = await db.listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].kind, 'the route overruled the reader').toBe('letter');
    });
  }, 20_000);
});

describe('an entry that already exists', () => {
  it('keeps its own kind, whatever a hash says', async () => {
    const existing = await db.createEntry({ kind: 'reflection', notes: 'Already written.' });

    // The parser refuses to carry a kind on this route at all, so this is the
    // belt to that braces: even asked for directly, the saved kind stands.
    window.location.hash = `#/entry/${existing.id}?kind=prayer`;
    renderApp();
    await notesBox();

    expect(kindField().value, 'a URL re-kinded a saved entry').toBe('reflection');

    fireEvent.change(await notesBox(), { target: { value: 'Already written, revised.' } });
    fireEvent.click(saveButton());

    await waitFor(async () => {
      expect((await db.getEntry(existing.id))!.notes).toBe('Already written, revised.');
    });
    expect((await db.getEntry(existing.id))!.kind, 'saving re-kinded it').toBe('reflection');
  }, 20_000);

  it('shows a real kind for a row saved as one this build retired', async () => {
    /*
     * `service` was a kind until 2026-09-30, and nothing rewrites stored rows on
     * upgrade — so a row can still say it.
     *
     * Reading the select alone does NOT test this, which is why this comment is
     * longer than the test. Removing the resolution and running it passed: a
     * `<select>` whose value matches no option falls back to the first, so it
     * reads "Sermon" either way and the assertion was measuring the option order.
     * The defect is that the state behind the control still says `service`, so
     * the editor takes its not-a-sermon branches while the control says Sermon.
     *
     * The prominent church-note import is that branch, made visible. It is the
     * assertion that actually distinguishes the two states, and the reason this
     * test reaches into the import affordance at all.
     *
     * `putEntries` writes verbatim, which is what makes this stageable;
     * `createEntry` would have defaulted the kind away. The cast is the point —
     * the value is one the current type cannot express, which is exactly the
     * situation a stored row puts the editor in.
     */
    await db.putEntries([
      {
        id: 'old-service',
        kind: 'service' as unknown as (typeof ENTRY_KINDS)[number],
        title: 'Easter morning',
        date: '2024-03-31',
        anchors: [],
        scriptureRefs: [],
        notes: 'Full church. The children did the reading.',
        reflection: '',
        links: [],
        tags: [],
        forDescendants: false,
        visibility: 'private',
        createdAt: '2024-03-31T10:00:00.000Z',
        updatedAt: '2024-03-31T10:00:00.000Z',
      },
    ]);

    window.location.hash = '#/entry/old-service';
    renderApp();
    await notesBox();

    expect(kindField().value).toBe('sermon');
    expect(ENTRY_KIND_LABELS.sermon).toBe('Sermon');

    // The one that actually distinguishes a resolved kind from an unresolved
    // one: a sermon gets the prominent church-note import, and every other kind
    // gets the quiet neutral route. A control reading "Sermon" above the quiet
    // control is the editor disagreeing with itself.
    expect(
      screen.getByRole('button', { name: 'Import church notes' }),
      'the control said Sermon and the editor behaved as something else',
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import notes/ })).toBeNull();

    // The words are untouched, which is the part that would actually be a loss.
    expect(screen.getByLabelText('Notes', { exact: true })).toHaveValue(
      'Full church. The children did the reading.',
    );

    // And nothing was written behind the reader's back. The row still says what
    // it said until they save it themselves — the canonical copy the dirty check
    // compares against comes through the same resolution, so the editor does not
    // claim unsaved changes either.
    expect((await db.getEntry('old-service'))!.kind).toBe('service');
  }, 20_000);
});

describe('saving a preselected entry', () => {
  for (const kind of ['prayer', 'reflection'] as const) {
    it(`persists ${kind} through the navigation the save causes`, async () => {
      await open(`#/entry/new?kind=${kind}`);
      fireEvent.change(await notesBox(), { target: { value: `A ${kind} worth keeping.` } });
      expect(window.location.hash).toBe(`#/entry/new?kind=${kind}`);

      fireEvent.click(saveButton());

      let saved: { id: string; kind: string } | undefined;
      await waitFor(async () => {
        const entries = await db.listEntries();
        expect(entries).toHaveLength(1);
        saved = entries[0];
      });
      expect(saved!.kind, `the stored row is not a ${kind}`).toBe(kind);

      // The route moves to the persisted entry and takes no request with it.
      await waitFor(() => {
        expect(window.location.hash).toBe(`#/entry/${saved!.id}`);
      });
      expect(window.location.hash, 'the kind request outlived the entry').not.toContain('kind=');

      // The editor remounts under a new key, and still shows the right kind —
      // now because the entry says so, not because the URL did.
      await screen.findByRole('heading', { level: 1, name: 'Edit entry' });
      await waitFor(() => expect(kindField().value).toBe(kind));
    }, 20_000);
  }
});

describe('focus mode, which knows nothing about kinds', () => {
  it('survives a prayer being saved, and so does the confirmation', async () => {
    await open('#/entry/new?kind=prayer');
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    await screen.findByRole('button', { name: 'Leave focus mode' });

    // The kind control in the focus bar is the same field, seeded the same way.
    expect(kindField().value).toBe('prayer');

    fireEvent.change(await notesBox(), { target: { value: 'Lord, let me stop negotiating.' } });
    fireEvent.click(saveButton());

    let saved: { id: string; kind: string } | undefined;
    await waitFor(async () => {
      const entries = await db.listEntries();
      expect(entries).toHaveLength(1);
      saved = entries[0];
    });
    expect(saved!.kind).toBe('prayer');

    await waitFor(() => expect(window.location.hash).toBe(`#/entry/${saved!.id}`));
    await screen.findByRole('heading', { level: 1, name: 'Edit entry' });

    expect(document.querySelector('header'), 'saving threw the reader out of focus mode').toBeNull();
    expect(screen.getByRole('button', { name: 'Leave focus mode' })).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Saved').closest('[aria-live]')).toBeTruthy();
    });
    expect(kindField().value).toBe('prayer');
  }, 20_000);

  it('does the same for a reflection', async () => {
    await open('#/entry/new?kind=reflection');
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    await screen.findByRole('button', { name: 'Leave focus mode' });
    fireEvent.change(await notesBox(), { target: { value: 'What am I still carrying?' } });
    fireEvent.click(saveButton());

    await waitFor(async () => {
      const entries = await db.listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].kind).toBe('reflection');
    });
    await waitFor(() => expect(window.location.hash).not.toBe('#/entry/new?kind=reflection'));
    await screen.findByRole('heading', { level: 1, name: 'Edit entry' });
    expect(document.querySelector('header')).toBeNull();
  }, 20_000);
});

describe('the way in', () => {
  it('is a real link on Home, pointing at the preselected route', async () => {
    // The wiring test for the cards themselves: a card that looked different
    // and opened the generic editor is exactly the thing this lane exists to
    // avoid, and only the href can rule it out.
    window.location.hash = '#/';
    localStorage.setItem('journey:intro', 'closed');
    renderApp();

    const prayer = await screen.findByRole('link', { name: /^Prayer/ });
    expect(prayer.getAttribute('href')).toBe('#/entry/new?kind=prayer');

    const reflection = screen.getByRole('link', { name: /^Reflection/ });
    expect(reflection.getAttribute('href')).toBe('#/entry/new?kind=reflection');

    // And following it really does land on a prayer.
    fireEvent.click(prayer);
    window.location.hash = prayer.getAttribute('href')!;
    await notesBox();
    expect(kindField().value).toBe('prayer');
  }, 20_000);
});
