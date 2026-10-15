/**
 * Scan notes, reached from the editor and landing in a real entry.
 *
 * The unit tests prove the state machine and the review screen. This file
 * proves the two are actually connected to the journal — the failure mode this
 * repository has shipped before is a correct, well-tested module that nothing
 * calls.
 *
 * It also pins the three things about the journal side that must not drift:
 * approved text is appended rather than overwriting what somebody wrote, the
 * destination the person chose is the field it lands in, and the provenance on
 * provided notes stays true to what is actually in the field.
 *
 * Every page, name and line of text here is fictional.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import EntryEditor from './EntryEditor';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { PlatformProvider } from '../platform/provider';
import { webPlatform } from '../platform/web';
import type { PageScanner, Recognition, ScannedPage } from '../platform/ports';
import { DexieStorageProvider } from '../storage/db';
import { READING } from '../export/fixtures';

const WHEN = '2026-10-11T12:00:00.000Z';
const SCANNED = 'FICTIONAL-SCAN\nThe shepherd goes after the one';

const page: ScannedPage = {
  handle: 'fictional-handle',
  preview: 'data:image/png;base64,iVBORw0KGgo=',
  width: 1200,
  height: 1600,
};

const recognition: Recognition = {
  text: SCANNED,
  lines: SCANNED.split('\n').map((text) => ({ text })),
  imageWidth: 1200,
  imageHeight: 1600,
  engine: 'fictional-engine',
  elapsedMs: 9,
};

const scanner = (supported = true): PageScanner => ({
  supported,
  capture: async () => page,
  choose: async () => page,
  recognise: async () => recognition,
  async discard() {},
});

/** Imported provided notes, with the provenance an import establishes. */
const imported = {
  format: 'markdown' as const,
  filename: 'fictional-handout.md',
  importedAt: WHEN,
  sha256: 'fictionaldigest',
  church: 'Fictional Chapel',
  speaker: 'Fictional Speaker',
  date: '2026-10-04',
  body: 'Fictional handout text',
  parserVersion: 1,
};

let db: DexieStorageProvider;
let counter = 0;
beforeEach(async () => {
  window.location.hash = '#/entry/new';
  db = new DexieStorageProvider(`fictional-editor-scan-${++counter}`);
  await db.open();
});
afterEach(cleanup);

const mount = (props: { entryId?: string } = {}, platformScanner = scanner()) =>
  render(
    <PlatformProvider platform={{ ...webPlatform, scanner: platformScanner }}>
      <RouterProvider>
        <StorageContextProvider provider={db}>
          <EntryEditor {...props} />
        </StorageContextProvider>
      </RouterProvider>
    </PlatformProvider>,
  );

/** Open the sheet, read a page, approve it into `destination`. */
async function scanInto(destination: 'My Notes' | 'Provided notes', text?: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Scan notes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
  await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
  if (text !== undefined) {
    fireEvent.change(screen.getByLabelText('Transcription'), { target: { value: text } });
  }
  fireEvent.click(screen.getByRole('radio', { name: destination }));
  fireEvent.click(screen.getByRole('button', { name: 'Use text' }));
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

describe('the editor only offers scanning where a page can actually be read', () => {
  it('offers it when the device can read a page', async () => {
    mount();
    await screen.findByLabelText('Notes');
    expect(screen.getByRole('button', { name: 'Scan notes' })).toBeTruthy();
  });

  it('says nothing about it on the web, rather than offering what it cannot do', async () => {
    mount({}, scanner(false));
    await screen.findByLabelText('Notes');
    expect(screen.queryByRole('button', { name: 'Scan notes' })).toBeNull();
    // Not disabled, not explained away: absent. A button that cannot work is
    // worse than no button, because it reads as a feature that is broken.
    expect(document.body.textContent).not.toMatch(/Scan notes/);
  });
});

describe('approved text reaches the field the person chose', () => {
  it('appends to notes below what was already written', async () => {
    const existing = { ...READING, notes: 'Fictional note typed by hand' };
    await db.putEntries([existing]);
    window.location.hash = `#/entry/${existing.id}`;
    mount({ entryId: existing.id });
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(existing.notes));

    await scanInto('My Notes');

    // Their own writing first, then the scan, with a blank line between. The
    // scan never lands on top of something a person wrote.
    expect(screen.getByLabelText('Notes')).toHaveValue(`${existing.notes}\n\n${SCANNED}`);

    save();
    await waitFor(async () =>
      expect((await db.getEntry(existing.id))?.notes).toBe(`${existing.notes}\n\n${SCANNED}`),
    );
    // And it went nowhere else. Notes and reflection are different things.
    expect((await db.getEntry(existing.id))?.reflection ?? '').not.toMatch(/FICTIONAL-SCAN/);
  });

  it('puts a photographed handout in provided notes, and not in the reader’s own notes', async () => {
    mount();
    await screen.findByLabelText('Notes');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fictional scan entry' } });

    await scanInto('Provided notes');
    save();

    await waitFor(async () => expect(await db.listEntries()).toHaveLength(1));
    const [saved] = await db.listEntries();
    expect(saved.sourceMaterial?.body).toBe(SCANNED);
    expect(saved.notes).toBe('');
    // A photographed page is not a file, and its provenance says so plainly.
    expect(saved.sourceMaterial?.filename).toBe('Scanned page');
    expect(saved.sourceMaterial?.format).toBe('txt');
    // Nothing was read out of the page about who provided it, or what it cites.
    expect(saved.sourceMaterial?.speaker).toBeUndefined();
    expect(saved.sourceMaterial?.church).toBeUndefined();
    expect(saved.sourceMaterial?.scripture).toBeUndefined();
    expect(saved.scriptureRefs ?? []).toEqual([]);
  });

  it('commits the correction, not the recognised text', async () => {
    mount();
    await screen.findByLabelText('Notes');
    await scanInto('My Notes', 'FICTIONAL-SCAN\nJohn 3:16');
    // "Jhn 3:16" is what a page might say. Expanding it is the person's call,
    // and theirs is the version that is kept.
    expect(screen.getByLabelText('Notes')).toHaveValue('FICTIONAL-SCAN\nJohn 3:16');
  });
});

describe('provenance on provided notes stays true to the field', () => {
  it('keeps an import’s provenance when the scan is added below it', async () => {
    const existing = { ...READING, sourceMaterial: imported };
    await db.putEntries([existing]);
    window.location.hash = `#/entry/${existing.id}`;
    mount({ entryId: existing.id });
    await screen.findByLabelText('Notes');

    await scanInto('Provided notes');
    save();

    await waitFor(async () =>
      expect((await db.getEntry(existing.id))?.sourceMaterial?.body).toBe(
        `${imported.body}\n\n${SCANNED}`,
      ),
    );
    const saved = await db.getEntry(existing.id);
    // The handout's text is still there, so what the file said about it is
    // still true and is kept.
    expect(saved?.sourceMaterial).toMatchObject({
      filename: imported.filename,
      sha256: imported.sha256,
      church: imported.church,
      speaker: imported.speaker,
      date: imported.date,
      format: imported.format,
    });
  });

  it('drops an import’s provenance when the scan replaces it', async () => {
    const existing = { ...READING, sourceMaterial: imported };
    await db.putEntries([existing]);
    window.location.hash = `#/entry/${existing.id}`;
    mount({ entryId: existing.id });
    await screen.findByLabelText('Notes');

    fireEvent.click(screen.getByRole('button', { name: 'Scan notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: 'Provided notes' }));
    fireEvent.click(screen.getByRole('radio', { name: /Replace existing text/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Use text' }));
    save();

    await waitFor(async () =>
      expect((await db.getEntry(existing.id))?.sourceMaterial?.body).toBe(SCANNED),
    );
    const saved = await db.getEntry(existing.id);
    // The handout's text is gone, so a digest of its bytes and the speaker it
    // named no longer describe anything in the field. Keeping them would be a
    // claim a reader could check and find false.
    expect(saved?.sourceMaterial?.sha256).toBeUndefined();
    expect(saved?.sourceMaterial?.speaker).toBeUndefined();
    expect(saved?.sourceMaterial?.church).toBeUndefined();
    expect(saved?.sourceMaterial?.date).toBeUndefined();
    expect(saved?.sourceMaterial?.filename).toBe('Scanned page');
  });
});

describe('nothing reaches the journal without an explicit yes', () => {
  it('leaves the entry untouched when a read page is cancelled', async () => {
    const existing = { ...READING, notes: 'Fictional note typed by hand' };
    await db.putEntries([existing]);
    window.location.hash = `#/entry/${existing.id}`;
    mount({ entryId: existing.id });
    await waitFor(() => expect(screen.getByLabelText('Notes')).toHaveValue(existing.notes));

    fireEvent.click(screen.getByRole('button', { name: 'Scan notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
    // The text is on screen, read and recognised. That is as far as it goes.
    expect(screen.getByLabelText('Transcription')).toHaveValue(SCANNED);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByLabelText('Transcription')).toBeNull());
    expect(screen.getByLabelText('Notes')).toHaveValue(existing.notes);
    save();
    await waitFor(async () => expect((await db.getEntry(existing.id))?.notes).toBe(existing.notes));
    expect((await db.getEntry(existing.id))?.sourceMaterial).toBeUndefined();
  });
});
