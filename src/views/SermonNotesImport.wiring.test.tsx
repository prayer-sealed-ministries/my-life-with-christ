/**
 * Church notes, from a chosen file to a saved entry, through the real app.
 *
 * The parser tests prove a file reads. They cannot prove the thing this whole
 * lane is about: that what comes out of a church's handout lands beside the
 * reader's writing and never in it. That is a fact about the editor, the form,
 * the save and the storage row — so it is asserted against all four, through
 * the real router and the real Shell.
 *
 * It also holds the line that a unit test cannot: that a script tag in a
 * handout is characters on a page. The renderer is the only thing that can
 * answer that, and only against a real DOM.
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
import {
  JSON_HOSTILE,
  JSON_NOTES,
  MD_WITH_HTML,
  TXT_NOTES,
} from '../import/sermon-notes-fixtures';
import { PlatformProvider } from '../platform/provider';
import { webAppLock } from '../platform/app-lock';
import type { Platform } from '../platform/ports';
import { DexieStorageProvider } from '../storage/db';
import type { Entry } from '../types';

let dbCounter = 0;
let db: DexieStorageProvider;

function renderApp(platform?: Platform) {
  return render(
    <PlatformProvider platform={platform}>
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
const reflectionBox = () => screen.getByLabelText('Reflection', { exact: true });

/**
 * Choose a file, the way a person does.
 *
 * jsdom's File has no usable arrayBuffer in every version, so the DOM file is
 * built from bytes and the input is driven directly. The component under test
 * is unchanged: it receives whatever the platform's picker hands it.
 */
async function chooseFile(name: string, text: string) {
  const input = screen.getByLabelText('Sermon notes file') as HTMLInputElement;
  const file = new File([text], name, { type: 'text/plain' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
}

async function openImport() {
  await notesBox();
  fireEvent.click(screen.getByRole('button', { name: 'Import church notes' }));
  await screen.findByLabelText('Sermon notes file');
}

/** Choose a file and accept what it proposes. */
async function importNotes(name: string, text: string) {
  await openImport();
  await chooseFile(name, text);
  const use = await screen.findByRole('button', { name: 'Use these notes' }, { timeout: 5_000 });
  fireEvent.click(use);
  await screen.findByRole('heading', { name: 'Provided notes' });
}

const savedEntry = async (): Promise<Entry> => {
  const entries = await db.listEntries();
  expect(entries).toHaveLength(1);
  return entries[0];
};

beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.location.hash = '#/entry/new';
  localStorage.setItem('journey:welcomed', '1');
  db = new DexieStorageProvider(`journey-sermon-notes-${(dbCounter += 1)}`);
});

afterEach(() => {
  cleanup();
  registerOverlay(null);
  localStorage.clear();
});

describe('before anything is chosen', () => {
  it('offers the way in on a new entry, and changes nothing by opening it', async () => {
    renderApp();
    await openImport();
    expect(await db.listEntries(), 'opening the importer wrote to the journal').toHaveLength(0);
  });

  it('leaves the journal alone when the person backs out', async () => {
    renderApp();
    await openImport();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]);

    await waitFor(() =>
      expect(screen.queryByLabelText('Sermon notes file')).toBeNull(),
    );
    expect(await db.listEntries()).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Provided notes' })).toBeNull();
  });

  it('says what is wrong with a bad file, and writes nothing', async () => {
    renderApp();
    await openImport();
    await chooseFile('notes.json', '{ not json');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not valid JSON/i);
    expect(await db.listEntries(), 'a failed read created an entry').toHaveLength(0);
    // Still on the choose step: nothing was proposed, so nothing can be used.
    expect(screen.queryByRole('button', { name: 'Use these notes' })).toBeNull();
  });

  it('reports a browser read failure instead of treating it as cancellation', async () => {
    renderApp();
    await openImport();

    const input = screen.getByLabelText('Sermon notes file') as HTMLInputElement;
    const file = new File(['unreadable'], 'unreadable.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(new Error('provider disconnected')),
    });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be opened or read/i);
    expect(await db.listEntries(), 'a failed file read changed the journal').toHaveLength(0);
  });

  it('reports a native picker failure instead of treating it as cancellation', async () => {
    const platform: Platform = {
      scanner: { supported: false, capture: async () => ({ reason: 'unsupported' } as const), choose: async () => ({ reason: 'unsupported' } as const), recognise: async () => ({ reason: 'unsupported' } as const), recognisePrepared: async () => ({ reason: 'unsupported' } as const), discard: async () => {} },
      appLock: webAppLock,
      files: { save: async () => ({ status: 'cancelled' }) },
      picker: {
        presentsOwnUI: true,
        pick: async () => {
          throw new Error('provider disconnected');
        },
      },
      printer: { print: () => undefined },
      unsavedWork: { protect: () => () => undefined },
      sharer: { canShare: false, share: async () => ({ shared: false }) },
    };
    renderApp(platform);
    await openImport();
    fireEvent.click(screen.getByRole('button', { name: 'Sermon notes file' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be opened or read/i);
    expect(await db.listEntries(), 'a failed native pick changed the journal').toHaveLength(0);
  });

  it('shows a preview before anything is applied', async () => {
    renderApp();
    await openImport();
    await chooseFile('sermon-notes.json', JSON_NOTES);

    await screen.findByRole('button', { name: 'Use these notes' });
    expect(screen.getByText('City Gate Church')).toBeTruthy();
    expect(screen.getByText('Pastor John Smith')).toBeTruthy();
    expect(screen.getByText('sermon-notes.json')).toBeTruthy();
    // Proposed, not applied: the entry's own heading is not there yet.
    expect(screen.queryByRole('heading', { name: 'Provided notes' })).toBeNull();
    expect(await db.listEntries()).toHaveLength(0);
  });
});

describe('what an import does to the entry', () => {
  it('puts the church’s words under their own heading and nowhere else', async () => {
    renderApp();
    await importNotes('handout.txt', TXT_NOTES);

    // The binding rule of this whole feature, asserted on the form itself.
    expect((await notesBox() as HTMLTextAreaElement).value, 'the handout landed in Notes').toBe('');
    expect((reflectionBox() as HTMLTextAreaElement).value).toBe('');

    // And it is on screen, as provided material.
    const section = screen.getByRole('heading', { name: 'Provided notes' }).closest('section');
    expect(section, 'the provided notes have no section of their own').toBeTruthy();
    expect(section!.textContent).toContain('Seek first the kingdom.');
    expect(section!.textContent).toContain('Not your own writing.');
    expect(section!.textContent).toContain('Imported sermon notes');
  }, 20_000);

  it('names the church when the file named one, and never otherwise', async () => {
    renderApp();
    await importNotes('sermon-notes.json', JSON_NOTES);
    const section = screen.getByRole('heading', { name: 'Provided notes' }).closest('section');
    expect(section!.textContent).toContain('Provided by City Gate Church');
  }, 20_000);

  it('fills the entry’s own metadata, and only where it was empty', async () => {
    renderApp();
    await importNotes('sermon-notes.json', JSON_NOTES);

    expect((screen.getByLabelText('Title', { exact: true }) as HTMLInputElement).value).toBe(
      'Setting Godly Priorities',
    );
  }, 20_000);

  it('does not overwrite a title the reader already typed', async () => {
    renderApp();
    await notesBox();
    fireEvent.change(screen.getByLabelText('Title', { exact: true }), {
      target: { value: 'My own title' },
    });
    await importNotes('sermon-notes.json', JSON_NOTES);

    expect((screen.getByLabelText('Title', { exact: true }) as HTMLInputElement).value).toBe(
      'My own title',
    );
  }, 20_000);

  it('cannot be executed, whatever the file contains', async () => {
    const globals = globalThis as unknown as Record<string, unknown>;
    delete globals.__pwned;

    renderApp();
    await importNotes('notes.md', MD_WITH_HTML);

    const section = screen.getByRole('heading', { name: 'Provided notes' }).closest('section')!;
    // No element was created from the file's markup…
    expect(section.querySelector('script'), 'a script element was built from a handout').toBeNull();
    expect(section.querySelector('img'), 'an img element was built from a handout').toBeNull();
    // …the markup is visible as characters instead…
    expect(section.textContent).toContain('<script>');
    // …and nothing ran.
    expect(globals.__pwned).toBeUndefined();
  }, 20_000);
});

describe('saving', () => {
  it('writes the provided material beside the reader’s writing, not into it', async () => {
    renderApp();
    await importNotes('sermon-notes.json', JSON_NOTES);

    fireEvent.change(await notesBox(), { target: { value: 'He said mercy is not owed.' } });
    fireEvent.change(reflectionBox(), { target: { value: 'I have been the older brother.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));
    const entry = await savedEntry();

    expect(entry.notes).toBe('He said mercy is not owed.');
    expect(entry.reflection).toBe('I have been the older brother.');
    expect(entry.notes, 'the handout leaked into the reader’s notes').not.toContain(
      'Where your treasure is',
    );

    expect(entry.sourceMaterial, 'the provided notes were not saved').toBeTruthy();
    expect(entry.sourceMaterial!.church).toBe('City Gate Church');
    expect(entry.sourceMaterial!.speaker).toBe('Pastor John Smith');
    expect(entry.sourceMaterial!.filename).toBe('sermon-notes.json');
    expect(entry.sourceMaterial!.format).toBe('sermon-notes-json');
    expect(entry.sourceMaterial!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.sourceMaterial!.body).toContain('Where your treasure is');
    expect(entry.scriptureRefs).toEqual(['Matthew 6:19-34']);
  }, 30_000);

  it('saves a handout with nothing written yet, and keeps the writing blank', async () => {
    renderApp();
    await importNotes('handout.txt', TXT_NOTES);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));
    const entry = await savedEntry();
    expect(entry.notes).toBe('');
    expect(entry.reflection).toBe('');
    expect(entry.prayer ?? '').toBe('');
    expect(entry.sourceMaterial!.body).toContain('Seek first the kingdom.');
  }, 30_000);

  it('brings the provided notes back when the entry is opened again', async () => {
    renderApp();
    await importNotes('handout.txt', TXT_NOTES);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));

    const entry = await savedEntry();
    cleanup();
    window.location.hash = `#/entry/${entry.id}`;
    renderApp();

    await screen.findByRole('heading', { name: 'Provided notes' });
    expect(
      screen.getByRole('heading', { name: 'Provided notes' }).closest('section')!.textContent,
    ).toContain('Seek first the kingdom.');
  }, 30_000);

  it('stores nothing a hostile file asked for', async () => {
    renderApp();
    await importNotes('hostile.json', JSON_HOSTILE);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));
    const entry = await savedEntry();

    expect(entry.kind, 'a file chose the entry’s kind').toBe('sermon');
    expect(entry.notes, 'a file wrote the reader’s notes').toBe('');
    expect(entry.reflection).toBe('');
    expect(entry.sourceMaterial!.body).toBe('The only real field here.');
    expect(entry.sourceMaterial!.church).toBeUndefined();
    expect((entry.sourceMaterial as unknown as Record<string, unknown>).polluted).toBeUndefined();
  }, 30_000);
});

describe('taking it back out', () => {
  it('removes the provided notes, and leaves the reader’s writing alone', async () => {
    renderApp();
    await importNotes('handout.txt', TXT_NOTES);
    fireEvent.change(await notesBox(), { target: { value: 'Mine.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Remove provided notes' }));
    // Destructive, so it asks first.
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, remove them' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Provided notes' })).toBeNull(),
    );
    expect((await notesBox() as HTMLTextAreaElement).value).toBe('Mine.');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));
    const entry = await savedEntry();
    expect(entry.sourceMaterial).toBeUndefined();
    expect(entry.notes).toBe('Mine.');
  }, 30_000);

  it('asks before replacing provided notes that are already there', async () => {
    renderApp();
    await importNotes('handout.txt', TXT_NOTES);

    fireEvent.click(screen.getByRole('button', { name: 'Import different notes' }));
    await chooseFile('sermon-notes.json', JSON_NOTES);

    // Not "Use these notes" this time: replacing is a different decision.
    const replace = await screen.findByRole('button', { name: 'Replace the provided notes' });
    expect(screen.getByText(/already has provided notes/i)).toBeTruthy();

    fireEvent.click(replace);
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, replace them' }));

    await waitFor(() => {
      const section = screen.getByRole('heading', { name: 'Provided notes' }).closest('section')!;
      expect(section.textContent).toContain('Provided by City Gate Church');
    });
  }, 30_000);
});
