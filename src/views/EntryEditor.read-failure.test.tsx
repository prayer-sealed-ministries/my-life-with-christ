import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import type { StorageProvider } from '../storage/StorageProvider';
import EntryEditor from './EntryEditor';

let counter = 0;
afterEach(cleanup);

describe('entry read failures', () => {
  it('does not describe an I/O failure as a deleted entry', async () => {
    const db = new DexieStorageProvider(`entry-read-failure-${(counter += 1)}`);
    await db.open();
    const entry = await db.createEntry({ notes: 'This entry still exists.' });

    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'getEntry') {
          return async () => {
            throw new Error('simulated database disconnect');
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    }) as StorageProvider;

    window.location.hash = `#/entry/${entry.id}`;
    render(
      <RouterProvider>
        <StorageContextProvider provider={failing}>
          <EntryEditor entryId={entry.id} />
        </StorageContextProvider>
      </RouterProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be opened.*disconnect/i);
    expect(screen.queryByText('That entry is not here.')).toBeNull();
    expect((await db.getEntry(entry.id))?.notes).toBe('This entry still exists.');
  });
});
