/**
 * The editor shows what the kind of entry is actually about.
 *
 * A sermon is the one kind somebody arrives at holding a piece of paper, so the
 * way to bring a handout in is a real button with a line explaining what it
 * takes. A prayer is not. Offering "Import church notes" above an empty prayer
 * is the app guessing wrong about what somebody sat down to do, in the largest
 * control on the screen.
 *
 * The capability is not removed from the other kinds — somebody may genuinely
 * have a file for a reading — but it becomes one quiet, neutrally worded line,
 * because on those kinds the material may have nothing to do with a church.
 *
 * These drive the real editor through the real router, because the thing being
 * tested is what a person sees, and the selected kind reaching the right branch
 * is exactly the wire that would go missing silently.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import App from '../App';
import { FocusProvider } from '../app/focus';
import { NoticeProvider } from '../app/notice';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { ThemeProvider } from '../app/theme';
import { PlatformProvider } from '../platform/provider';
import { DexieStorageProvider } from '../storage/db';
import type { Entry } from '../types';

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

/** The loud way in: a real button, with a line saying what it takes. */
const prominentImport = () => screen.queryByRole('button', { name: 'Import church notes' });

/** The quiet way in, for the kinds a handout is unusual on. */
const quietImport = () => screen.queryByRole('button', { name: /^Import notes/ });

const providedNotesHeading = () =>
  screen.queryByRole('heading', { name: 'Provided notes', level: 2 }) ??
  screen.queryByText('Provided notes');

async function open(hash: string) {
  window.location.hash = hash;
  renderApp();
  await notesBox();
}

beforeEach(async () => {
  dbCounter += 1;
  db = new DexieStorageProvider(`journey-kind-visibility-${dbCounter}`);
  await db.open();
  window.location.hash = '';
  // jsdom has no HTMLDialogElement.showModal, and the first-visit notice opens
  // one on mount. The flag is a disposable UI preference, so seeding it is not
  // hiding anything this lane is about.
  localStorage.setItem('journey:welcomed', '1');
});

afterEach(cleanup);

describe('a sermon keeps the full church-oriented editor', () => {
  it('offers the handout import prominently, with its explanation', async () => {
    await open('#/entry/new?kind=sermon');

    expect(prominentImport()).toBeInTheDocument();
    expect(
      screen.getByText(/A file your church handed out/i),
      'the sermon import keeps the line that says what it takes',
    ).toBeInTheDocument();
    // The quiet variant is the other kinds' affordance, not a second one here.
    expect(quietImport()).toBeNull();
  });

  it('still shows speaker, place and series', async () => {
    await open('#/entry/new?kind=sermon');
    fireEvent.click(screen.getByText(/^Details/));

    for (const label of ['Speaker', 'Place', 'Series']) {
      expect(screen.getByLabelText(label, { exact: true })).toBeInTheDocument();
    }
  });
});

describe('the kinds a handout is unusual on', () => {
  for (const kind of ['reading', 'prayer', 'reflection'] as const) {
    it(`${kind}: hides Provided notes and the prominent import, keeping a quiet way in`, async () => {
      await open(`#/entry/new?kind=${kind}`);

      // Nothing provided yet, so the section itself is not there to read.
      expect(providedNotesHeading()).toBeNull();

      // The loud control, and its church-specific wording, are gone.
      expect(prominentImport()).toBeNull();
      expect(screen.queryByText(/A file your church handed out/i)).toBeNull();

      // But the capability is not: one quiet, neutrally worded line remains.
      const quiet = quietImport();
      expect(quiet, `${kind} must keep a way to import`).not.toBeNull();
      expect(quiet!.textContent).toMatch(/^Import notes/);
      // Neutral on purpose: on these kinds the file may not be a church's.
      expect(quiet!.textContent).not.toMatch(/church/i);
    });
  }
});

describe('switching kind', () => {
  it('takes the church wording away, and brings it back', async () => {
    await open('#/entry/new?kind=sermon');
    expect(prominentImport()).toBeInTheDocument();

    fireEvent.change(kindField(), { target: { value: 'prayer' } });
    await waitFor(() => expect(prominentImport()).toBeNull());
    expect(quietImport()).not.toBeNull();

    fireEvent.change(kindField(), { target: { value: 'sermon' } });
    await waitFor(() => expect(prominentImport()).not.toBeNull());
    expect(quietImport()).toBeNull();
  });

  it('never discards material that was already imported', async () => {
    // A saved entry that carries provided notes, opened and re-kinded. The
    // point of the test is the data, not the layout: hiding a section must
    // never be implemented by emptying it.
    const entry: Entry = {
      id: 'kept',
      kind: 'sermon',
      title: 'MARKER-TITLE',
      date: '2026-03-01',
      anchors: [],
      scriptureRefs: [],
      notes: '',
      reflection: '',
      links: [],
      tags: [],
      forDescendants: false,
      visibility: 'private',
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-01T10:00:00.000Z',
      sourceMaterial: {
        body: 'MARKER-PROVIDED-BODY',
        filename: 'handout.txt',
        format: 'txt',
        importedAt: '2026-03-01T09:00:00.000Z',
        sha256: 'a'.repeat(64),
        parserVersion: 1,
      },
    };
    await db.putEntries([entry]);

    await open('#/entry/kept');
    expect(screen.getByText('MARKER-PROVIDED-BODY')).toBeInTheDocument();

    fireEvent.change(kindField(), { target: { value: 'reflection' } });

    // Still there, still readable — the section is shown because content
    // exists, not because the kind happens to be a sermon.
    await waitFor(() => expect(screen.getByText('MARKER-PROVIDED-BODY')).toBeInTheDocument());

    // And it is still on the record, not merely on the screen.
    const stored = await db.getEntry('kept');
    expect(stored?.sourceMaterial?.body).toBe('MARKER-PROVIDED-BODY');
  });
});

describe('provided content decides the section, on every kind', () => {
  it('shows it on a prayer that has some', async () => {
    const entry: Entry = {
      id: 'prayed',
      kind: 'prayer',
      title: '',
      date: '2026-03-02',
      anchors: [],
      scriptureRefs: [],
      notes: '',
      reflection: '',
      links: [],
      tags: [],
      forDescendants: false,
      visibility: 'private',
      createdAt: '2026-03-02T10:00:00.000Z',
      updatedAt: '2026-03-02T10:00:00.000Z',
      sourceMaterial: {
        body: 'MARKER-PRAYER-PROVIDED',
        filename: 'notes.txt',
        format: 'txt',
        importedAt: '2026-03-02T09:00:00.000Z',
        sha256: 'b'.repeat(64),
        parserVersion: 1,
      },
    };
    await db.putEntries([entry]);

    await open('#/entry/prayed');

    // Imported material is never hidden with no way to see it — that would be
    // the one genuinely bad outcome of hiding the section by kind.
    expect(screen.getByText('MARKER-PRAYER-PROVIDED')).toBeInTheDocument();
  });
});

describe('the quiet route reaches the same place', () => {
  /**
   * The failure this exists to catch is the one §8 of the brief names: material
   * imported into a hidden state, with no way to see it. Hiding the section by
   * kind and then importing into it would produce exactly that, and would look
   * like a working import from the outside — the file is read, the confirmation
   * appears, the journal is written, and the reader is shown nothing.
   *
   * So this drives the whole path on a prayer: the quiet button, the real
   * chooser, the real review step, the real confirmation.
   */
  it('imports on a prayer, and the section then appears', async () => {
    await open('#/entry/new?kind=prayer');

    // Nothing to show yet.
    expect(providedNotesHeading()).toBeNull();

    fireEvent.click(quietImport()!);

    // The review step is the same one a sermon gets — no second flow.
    const input = (await screen.findByLabelText('Sermon notes file')) as HTMLInputElement;
    const file = new File(['MARKER-QUIET-IMPORT'], 'handout.txt', { type: 'text/plain' });
    // jsdom's File has no usable arrayBuffer in every version, so the input is
    // driven directly, the way SermonNotesImport.wiring.test.tsx does it.
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    // Review before commit, unchanged (§12).
    const use = await screen.findByRole('button', { name: 'Use these notes' }, { timeout: 5_000 });
    fireEvent.click(use);

    // And now it is on screen, on a prayer, because content exists.
    await waitFor(() => expect(providedNotesHeading()).not.toBeNull());
    expect(screen.getByText('MARKER-QUIET-IMPORT')).toBeInTheDocument();
  });
});

describe('the panel is framed the way the way in was', () => {
  /**
   * Found by driving this on an emulator rather than by reading the code: the
   * quiet control is neutrally worded, and pressing it opened a panel headed
   * "Import church notes" whose first sentence said the file was one a church
   * handed out. The label had been made neutral and the thing it opened had
   * not, which leaves the reader worse off than before — told, in the largest
   * text on the panel, that they have pressed something they have not.
   */
  const panelHeading = () =>
    screen.getByRole('heading', { name: /^Import (church )?notes$/, level: 2 });

  it('a sermon still says church, because there it is true and useful', async () => {
    await open('#/entry/new?kind=sermon');
    fireEvent.click(prominentImport()!);

    await screen.findByLabelText('Sermon notes file');
    expect(panelHeading().textContent).toBe('Import church notes');
    expect(screen.getByText(/Notes your church handed out/)).toBeInTheDocument();
  });

  for (const kind of ['reading', 'prayer', 'reflection'] as const) {
    it(`a ${kind} opens a panel that does not claim a church`, async () => {
      await open(`#/entry/new?kind=${kind}`);
      fireEvent.click(quietImport()!);

      await screen.findByLabelText('Sermon notes file');
      expect(panelHeading().textContent).toBe('Import notes');
      expect(screen.queryByText(/Notes your church handed out/)).toBeNull();

      // Still says plainly that it is not the reader's own writing, which is
      // the part that must survive every rewording.
      expect(screen.getByText(/kept as provided notes/)).toBeInTheDocument();
    });
  }
});
