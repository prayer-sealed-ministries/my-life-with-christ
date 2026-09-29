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
import { buildArchive } from '../export/archive';
import { createZip, readZip } from '../export/zip';
import type { DraftForm } from '../types';
import { loadSections } from '../app/sections';

/*
 * The divisions, through the loader the application itself uses.
 *
 * DataView genuinely needs them — the archive carries division ids and an
 * import resolves them — so it suspends until they are here. Awaiting the real
 * loader once, at module scope, is what lets these tests render it directly,
 * and it keeps the data they assert against the data the product serves.
 */
await loadSections();


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
    findEntriesForExactAnchor: fail,
    putEntries: fail,
    replaceEntries: fail,
    clearEntries: fail,
    putDraft: fail,
    getDraft: fail,
    getDraftForEntry: fail,
    listDrafts: fail,
    deleteDraft: fail,
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

const EMPTY_FORM: DraftForm = {
  kind: 'sermon',
  title: '',
  date: '2026-05-01',
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
};

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

  it('names unfinished drafts in the preview, without showing any of their words', async () => {
    renderView();
    await screen.findByRole('heading', { level: 1 });

    const payload: JourneyExport = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-05-01T00:00:00.000Z',
      entries: [GRACE, QUIET],
      drafts: [
        {
          id: 'd1',
          createdAt: '2026-05-01T09:00:00.000Z',
          updatedAt: '2026-05-01T09:05:00.000Z',
          form: { ...EMPTY_FORM, notes: 'DRAFT-PROSE-nobody else should read this' },
        },
      ],
    };
    const file = new File([JSON.stringify(payload)], 'journey.json', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('Journal file to read'), { target: { files: [file] } });

    const preview = await screen.findByRole('heading', { name: 'What this would do' });
    const card = preview.closest('div') as HTMLElement;

    // During a migration "2 entries" on a file that also carries unfinished
    // writing leaves the drafts to turn up unannounced afterwards.
    expect(within(card).getByText(/holds/).textContent).toMatch(
      /2 entries, and 1 unfinished draft\./,
    );

    // A count, and only a count. The words stay out of it.
    expect(document.body.textContent).not.toContain('DRAFT-PROSE');
  });

  it('says a damaged backup could not be VERIFIED, and blames nobody', async () => {
    renderView();
    await screen.findByRole('heading', { level: 1 });

    // A real archive, altered inside a still-valid zip, manifest untouched.
    const built = await buildArchive({
      entries: [GRACE, QUIET],
      outlineBooks: [],
      topics: [],
      profile: 'public',
    });
    const files = (await readZip(built.bytes)).map((one) => ({ path: one.path, content: one.bytes }));
    const canonical = files.find((one) => one.path === 'data/journey.json')!;
    canonical.content = new TextEncoder().encode(
      new TextDecoder().decode(canonical.content).replace(GRACE.title, 'SOMETHING ELSE'),
    );
    const damaged = await createZip(files);

    const file = new File([damaged as BlobPart], 'backup.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByLabelText('Journal file to read'), { target: { files: [file] } });

    const told = await screen.findAllByText(/could not be verified and was not restored/i);
    expect(told.length).toBeGreaterThan(0);
    const said = told[0].textContent ?? '';
    expect(said).toMatch(/Nothing was changed/);

    // Not merely "the words appear somewhere". The generic failure path
    // interpolates this error's own message, so a test that only looked for
    // "could not be verified" passed with the integrity branch disabled —
    // which is how this assertion came to be written this way.
    expect(said).toMatch(/The file may be damaged or incomplete/);
    expect(said, 'it read perfectly well; that is the problem').not.toMatch(/could not be read/);

    // Corruption produces this too, so the wording may not accuse anyone, and
    // the failing checksums are not a reader's problem.
    for (const word of ['hacked', 'malicious', 'compromised', 'tampered']) {
      expect(said.toLowerCase()).not.toContain(word);
    }
    expect(said).not.toMatch(/[0-9a-f]{16}/);

    expect(screen.queryByRole('heading', { name: 'What this would do' })).toBeNull();
    expect(await db.listEntries()).toHaveLength(0);
  }, 30_000);

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

  /**
   * The race that made the test above fail about one CI run in forty.
   *
   * The page counts the journal through `useStorageQuery`, which cannot even
   * start until the provider has opened AND read settings — three round-trips
   * and a render. The import preview needs one `listEntries()`, issued straight
   * at the provider. When the preview won, the destructive option quoted the
   * count's *initial* value and said "Deletes all 0 entries in this journal
   * first. There is no undo." beside a button that was about to delete one.
   *
   * Driven rather than waited for: settings never resolve here, so the page's
   * own count is provably unread — no sleep, no interval, no luck. The preview
   * must still state the truth, because it carries the list it was computed
   * from.
   */
  it('says how many entries replace would delete before the page has counted any', async () => {
    await db.putEntries([GRACE]);

    // Everything real except settings, which hang. `ready` never flips, so
    // useStorageQuery never issues its read and entryCount stays at its
    // initial 0 for the whole test.
    const neverSettles = new Promise<never>(() => {});
    const uncounted: StorageProvider = Object.assign(Object.create(db) as StorageProvider, {
      getSettings: () => neverSettles,
    });

    render(
      <RouterProvider>
        <StorageContextProvider provider={uncounted}>
          <DataView />
        </StorageContextProvider>
      </RouterProvider>,
    );
    await screen.findByRole('heading', { level: 1 });
    // The page itself admits it has not counted; the preview may not pretend to.
    expect(screen.getByText('Counting your entries…')).toBeInTheDocument();

    const payload: JourneyExport = {
      format: 'journey-export',
      version: 1,
      exportedAt: '2026-05-01T00:00:00.000Z',
      entries: [QUIET],
    };
    const file = new File([JSON.stringify(payload)], 'journey.json', { type: 'application/json' });

    fireEvent.change(screen.getByLabelText('Journal file to read'), { target: { files: [file] } });
    await screen.findByRole('heading', { name: 'What this would do' });

    // Still uncounted, and the destructive option still tells the truth.
    expect(screen.getByText('Counting your entries…')).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /Deletes all 1 entry in this journal first/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Deletes all 0 entries/)).not.toBeInTheDocument();
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
