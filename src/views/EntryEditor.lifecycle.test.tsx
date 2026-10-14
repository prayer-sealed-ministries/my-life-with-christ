import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({
  listener: null as ((active: boolean) => void) | null,
}));

vi.mock('../platform/app-state', () => ({
  capacitorAppState: () => ({
    subscribe(listener: (active: boolean) => void) {
      lifecycle.listener = listener;
      return () => {
        if (lifecycle.listener === listener) lifecycle.listener = null;
      };
    },
  }),
}));

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import EntryEditor from './EntryEditor';

let counter = 0;

afterEach(() => {
  cleanup();
});

describe('editor durability on app lifecycle changes', () => {
  it('flushes the newest snapshot immediately when the app backgrounds', async () => {
    const db = new DexieStorageProvider(`editor-background-${(counter += 1)}`);
    await db.open();

    let written = () => {};
    const writeFinished = new Promise<void>((resolve) => {
      written = resolve;
    });
    const original = db.putDraft.bind(db);
    vi.spyOn(db, 'putDraft').mockImplementation(async (...args) => {
      await original(...args);
      written();
    });

    window.location.hash = '#/entry/new';
    render(
      <RouterProvider>
        <StorageContextProvider provider={db}>
          <EntryEditor />
        </StorageContextProvider>
      </RouterProvider>,
    );

    const notes = await screen.findByLabelText('Notes');
    fireEvent.change(notes, { target: { value: 'Keep this last sentence.' } });
    expect(await db.listDrafts()).toHaveLength(0);

    // This signal is delivered synchronously, well inside the ordinary 400ms
    // debounce. A write observed before that timer expires therefore came from
    // the lifecycle flush rather than from waiting out the settle window.
    act(() => lifecycle.listener?.(false));
    await writeFinished;

    const [draft] = await db.listDrafts();
    expect(draft.form.notes).toBe('Keep this last sentence.');
  });
});
