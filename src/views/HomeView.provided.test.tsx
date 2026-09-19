/**
 * "Recently written", when the reader has not written anything yet.
 *
 * Importing a handout on Sunday morning and writing nothing until the evening
 * is an ordinary way to use this. In between, Home has an entry with provided
 * material and no words of the reader's own — and the one thing it must not do
 * is fill a card headed "Recently written" with a line of somebody else's
 * outline. That would be the app telling a person they wrote something they
 * did not, on the front page, every time they opened it.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import HomeView from './HomeView';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { ThemeProvider } from '../app/theme';
import { PlatformProvider } from '../platform/provider';
import { DexieStorageProvider } from '../storage/db';
import type { SourceMaterial } from '../types';

const MATERIAL: SourceMaterial = {
  format: 'sermon-notes-json',
  filename: 'sermon-notes.json',
  importedAt: '2026-09-20T15:00:00.000Z',
  church: 'City Gate Church',
  body: 'Where your treasure is, your heart follows.',
  parserVersion: 1,
};

let dbCounter = 0;
let db: DexieStorageProvider;

function renderHome() {
  return render(
    <PlatformProvider>
      <ThemeProvider>
        <StorageContextProvider provider={db}>
          <RouterProvider>
            <HomeView />
          </RouterProvider>
        </StorageContextProvider>
      </ThemeProvider>
    </PlatformProvider>,
  );
}

beforeEach(() => {
  window.location.hash = '#/';
  localStorage.setItem('journey:welcomed', '1');
  localStorage.setItem('journey:intro', 'closed');
  db = new DexieStorageProvider(`journey-home-provided-${(dbCounter += 1)}`);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a recent entry that is only a handout so far', () => {
  it('never shows the church’s words as the reader’s recent writing', async () => {
    await db.createEntry({
      kind: 'sermon',
      title: 'Setting Godly Priorities',
      date: '2026-09-20',
      notes: '',
      reflection: '',
      sourceMaterial: MATERIAL,
    });

    renderHome();
    await screen.findByText('Setting Godly Priorities');

    const card = screen.getByText('Setting Godly Priorities').closest('a')!;
    expect(
      card.textContent,
      'a line of the church’s handout is being shown as recent writing',
    ).not.toContain('Where your treasure is');

    // What it says instead: enough to recognise the entry, honest about it.
    expect(card.textContent).toContain('Imported sermon notes');
    expect(card.textContent).toContain('nothing written yet');
  }, 20_000);

  it('shows the reader’s own words the moment there are any', async () => {
    await db.createEntry({
      kind: 'sermon',
      title: 'Setting Godly Priorities',
      date: '2026-09-20',
      notes: 'He said storing up is a way of not trusting.',
      sourceMaterial: MATERIAL,
    });

    renderHome();
    await waitFor(() => {
      const card = screen.getByText('Setting Godly Priorities').closest('a')!;
      expect(card.textContent).toContain('He said storing up is a way of not trusting.');
      expect(card.textContent).not.toContain('Where your treasure is');
    });
  }, 20_000);
});
