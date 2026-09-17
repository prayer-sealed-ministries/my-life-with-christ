/**
 * What this view has to get right, tested against the real thing: a real Dexie
 * database on fake-indexeddb, the real archive builder, the real importer.
 *
 * The two behaviours worth breaking a build over are here — export is one press
 * away and says what it produced, and an import writes nothing until someone
 * has seen the preview and pressed confirm.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import type { StorageProvider } from '../storage/StorageProvider';
import type { Entry, JourneyExport } from '../types';
import DataView from './DataView';

/** A journal that will not open: private browsing, or blocked site data. */
const brokenStorage = (): StorageProvider => {
  const fail = () => Promise.reject(new Error('site data is blocked'));
  return {
    open: fail,
    getEntry: fail,
    listEntries: fail,
    listEntriesChronological: fail,
    createEntry: fail,
    updateEntry: fail,
    deleteEntry: fail,
    findEntriesForAnchor: fail,
    putEntries: fail,
    replaceEntries: fail,
    clearEntries: fail,
    getSettings: fail,
    updateSettings: fail,
    listTags: fail,
    listSpeakers: fail,
    listPlaces: fail,
  };
};

const entry = (overrides: Partial<Entry> & { id: string }): Entry => ({
  kind: 'sermon',
  title: 'Untitled',
  date: '2026-03-15',
  anchors: [],
  scriptureRefs: [],
  notes: '',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-03-15T10:00:00.000Z',
  updatedAt: '2026-03-15T10:00:00.000Z',
  ...overrides,
});

// Philemon on purpose: a real passage anchor, and the smallest book to load.
const PHILEMON = {
  kind: 'scripture' as const,
  book: 'philemon',
  chapterStart: 1,
  verseStart: 1,
  chapterEnd: 1,
  verseEnd: 7,
};

const GRACE = entry({
  id: 'entry-grace',
  title: 'Grace at the door',
  anchors: [PHILEMON],
  notes: 'He read the whole letter aloud.',
  reflection: 'I owe someone a letter like that.',
});

const QUIET = entry({
  id: 'entry-quiet',
  title: 'A quiet Wednesday',
  kind: 'reflection',
  date: '2026-04-01',
  createdAt: '2026-04-01T10:00:00.000Z',
  updatedAt: '2026-04-01T10:00:00.000Z',
});

let db: DexieStorageProvider;
let counter = 0;

const renderView = () =>
  render(
    <RouterProvider>
      <StorageContextProvider provider={db}>
        <DataView />
      </StorageContextProvider>
    </RouterProvider>,
  );

/** Let the archive reach a download without jsdom's missing blob plumbing. */
function stubDownload() {
  const click = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:journey'),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
  return click;
}

beforeEach(async () => {
  counter += 1;
  db = new DexieStorageProvider(`journey-dataview-${counter}`);
  await db.open();
});

// Vitest globals are off in this project, so Testing Library never registers
// its own cleanup; without this, one test's DOM is still on the page in the next.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DataView', () => {
  it('leads with the warning and says plainly that nothing has been exported', async () => {
    renderView();

    expect(await screen.findByRole('heading', { level: 1, name: 'Your journal' })).toBeInTheDocument();
    expect(
      screen.getByText(/Warning: the copy on this device is not a backup/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Never exported/i)).toBeInTheDocument();

    // The warning is the first thing after the heading, not a footnote.
    const heading = screen.getByRole('heading', { level: 1 });
    const warning = screen.getByText(/Warning: the copy on this device is not a backup/i);
    expect(heading.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('exports everything in one press and reports the filename and entry count', async () => {
    const click = stubDownload();
    await db.putEntries([GRACE, QUIET]);
    // A reader who chose a weekly reminder keeps it through an export. The
    // export writes the date and clears the dismissal; it has no business
    // resetting how often they asked to be told.
    await db.updateSettings({ backupReminderDays: 7 });

    renderView();
    fireEvent.click(await screen.findByRole('button', { name: 'Export everything' }));

    // Visible once, announced once: the same sentence in a live region.
    const reported = await screen.findAllByText(/Saved journey-export-\d{4}-\d{2}-\d{2}\.zip — 2 entries/, undefined, {
      timeout: 15_000,
    });
    expect(reported).toHaveLength(2);
    expect(click).toHaveBeenCalled();

    // The export is recorded, so the reminder resets and the line above updates.
    const afterExport = await db.getSettings();
    expect(afterExport.lastExportAt).toBeTruthy();
    expect(afterExport.backupReminderDays, 'the export overwrote the chosen interval').toBe(7);
    expect(screen.getByText('Last exported today.')).toBeInTheDocument();
  }, 30_000);

  it('refuses a partial export until something actually narrows it', async () => {
    renderView();

    const partial = await screen.findByRole('button', { name: 'Export the selected part' });
    expect(partial).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Sermon'));
    expect(screen.getByRole('button', { name: 'Export the selected part' })).toBeEnabled();

    expect(
      screen.getByText(/A partial export is not a backup of your journal/i),
    ).toBeInTheDocument();
  });

  it('previews an import and writes nothing until the confirm press', async () => {
    renderView();
    await screen.findByRole('heading', { level: 1 });

    const payload: JourneyExport = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-05-01T00:00:00.000Z',
      entries: [GRACE, QUIET],
    };
    const file = new File([JSON.stringify(payload)], 'journey.json', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('Journal file to read'), { target: { files: [file] } });

    const preview = await screen.findByRole('heading', { name: 'What this would do' });
    const card = preview.closest('div');
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText(/not in this journal yet/).textContent).toContain(
      '2 new',
    );

    // The whole point: seeing the preview must not have written anything.
    expect(await db.listEntries()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Merge 2 entries' }));

    expect(await screen.findAllByText(/Merged journey\.json: 2 entries written/)).toHaveLength(2);
    await waitFor(async () => expect(await db.listEntries()).toHaveLength(2));
  });

  it('offers replace as a labelled radio, marked destructive', async () => {
    await db.putEntries([GRACE]);
    renderView();
    await screen.findByRole('heading', { level: 1 });

    const payload: JourneyExport = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-05-01T00:00:00.000Z',
      entries: [QUIET],
    };
    const file = new File([JSON.stringify(payload)], 'journey.zip', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('Journal file to read'), { target: { files: [file] } });
    await screen.findByRole('heading', { name: 'What this would do' });

    // Merge is the default; replace has to be chosen deliberately.
    expect(screen.getByRole('radio', { name: /Merge \(recommended\)/ })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: /Replace — destructive/ }));

    expect(screen.getByText(/Deletes all 1 entry in this journal first/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete everything and import 1 entry' }),
    ).toBeInTheDocument();
  });

  it('keeps an old bare-id anchor readable, or preserves it, but never stores it raw', async () => {
    renderView();
    await screen.findByRole('heading', { level: 1 });

    // A journal from before anchors were structured: bare ids, one a topic this
    // build knows and one an outline id it does not.
    const payload = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-05-01T00:00:00.000Z',
      entries: [{ ...QUIET, id: 'entry-old', anchors: ['humility', 'an-outline-id-from-2019'] }],
    };
    const file = new File([JSON.stringify(payload)], 'old-journal.json', {
      type: 'application/json',
    });

    fireEvent.change(screen.getByLabelText('Journal file to read'), { target: { files: [file] } });
    await screen.findByRole('heading', { name: 'What this would do' });

    // The unresolvable one is said out loud before anything is written.
    expect(
      screen.getByText(/anchor "an-outline-id-from-2019" could not be resolved/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Merge 1 entry' }));
    await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));

    const [stored] = await db.listEntries();
    // Every stored anchor is a structured anchor. A bare outline id is never one.
    expect(stored.anchors).toEqual([{ kind: 'topic', topicId: 'humility' }]);
    expect(stored._unmigrated?.anchors).toEqual(['an-outline-id-from-2019']);
  });

  it('counts an anchor this build cannot resolve, and imports the entry anyway', async () => {
    renderView();
    await screen.findByRole('heading', { level: 1 });

    const payload: JourneyExport = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-05-01T00:00:00.000Z',
      entries: [
        entry({
          id: 'entry-elsewhere',
          title: 'A book that is not in the canon',
          anchors: [
            { kind: 'scripture', book: 'book-of-eli', chapterStart: 1, verseStart: 1, chapterEnd: 1, verseEnd: 3 },
          ],
        }),
      ],
    };
    const file = new File([JSON.stringify(payload)], 'journey.json', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('Journal file to read'), { target: { files: [file] } });
    await screen.findByRole('heading', { name: 'What this would do' });

    expect(screen.getByText(/with a passage or topic this build does not know/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Merge 1 entry' }));
    await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));
    // "The entries import in full" has to be true, not just reassuring.
    expect((await db.listEntries())[0].title).toBe('A book that is not in the canon');
  });

  it('hands focus back to the export button once the archive is built', async () => {
    stubDownload();
    await db.putEntries([GRACE]);
    renderView();

    const button = await screen.findByRole('button', { name: 'Export everything' });
    button.focus();
    fireEvent.click(button);
    // A browser drops focus to <body> when the control under it goes disabled.
    // jsdom does neither that nor blur() on a disabled element, so reach the
    // same state the long way round. The assertion is the precondition, not
    // decoration: without focus actually on <body>, this test proves nothing.
    const elsewhere = screen.getByLabelText('Journal file to read');
    elsewhere.focus();
    elsewhere.blur();
    expect(document.activeElement).toBe(document.body);

    await screen.findAllByText(/Saved journey-export/, undefined, { timeout: 15_000 });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export everything' })).toHaveFocus(),
    );
  }, 30_000);

  it('hands focus back to the file input when the preview is cancelled', async () => {
    renderView();
    await screen.findByRole('heading', { level: 1 });

    const payload: JourneyExport = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-05-01T00:00:00.000Z',
      entries: [QUIET],
    };
    const file = new File([JSON.stringify(payload)], 'journey.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Journal file to read'), { target: { files: [file] } });
    await screen.findByRole('heading', { name: 'What this would do' });

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.click(cancel);

    // The card holding that button is gone; focus must not land on nothing.
    await waitFor(() => expect(screen.getByLabelText('Journal file to read')).toHaveFocus());
    expect(await db.listEntries()).toHaveLength(0);
  });

  // The detached-node case is covered in src/lib/focus-restore.test.ts, not
  // here. A component-level version of it passed against the BROKEN code too —
  // jsdom resets activeElement to <body> before the effect runs, so the race it
  // claimed to reproduce never happened. A test that cannot fail is worse than
  // no test, because it reads like coverage.

  it('does not steal focus when the user really has moved on', async () => {
    // The other half of the rule. A restore that fires regardless would yank a
    // keyboard user out of whatever they moved to.
    renderView();
    await screen.findByRole('heading', { level: 1 });

    const payload: JourneyExport = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-05-01T00:00:00.000Z',
      entries: [QUIET],
    };
    const file = new File([JSON.stringify(payload)], 'journey.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Journal file to read'), { target: { files: [file] } });
    await screen.findByRole('heading', { name: 'What this would do' });

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();

    // A real, connected element the user moved to deliberately.
    const elsewhere = screen.getByRole('button', { name: 'Export everything' });
    fireEvent.click(cancel);
    elsewhere.focus();

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'What this would do' })).toBeNull());
    expect(elsewhere).toHaveFocus();
  });

  it('does not offer an export it cannot run, or call an unreadable journal empty', async () => {
    render(
      <RouterProvider>
        <StorageContextProvider provider={brokenStorage()}>
          <DataView />
        </StorageContextProvider>
      </RouterProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be opened/i);
    expect(screen.queryByText(/0 entries in this journal/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export everything' })).toBeDisabled();
    expect(screen.getByLabelText('Journal file to read')).toBeDisabled();
  });

  it('reports a file it cannot read without touching the journal', async () => {
    await db.putEntries([GRACE]);
    renderView();
    await screen.findByRole('heading', { level: 1 });

    const file = new File(['this is not a journal'], 'holiday.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Journal file to read'), { target: { files: [file] } });

    expect(await screen.findAllByText(/holiday\.json could not be read/)).not.toHaveLength(0);
    expect(await db.listEntries()).toHaveLength(1);
  });
});
