import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DexieStorageProvider } from '../storage/db';
import type { StorageProvider } from '../storage/StorageProvider';
import type { Entry } from '../types';
import { StorageContextProvider, useStorage, useStorageQuery } from './storage';

const entry: Entry = {
  id: 'known-good', kind: 'reflection', title: 'Known good', date: '2026-01-01',
  anchors: [], scriptureRefs: [], notes: 'Existing writing.', reflection: '', links: [], tags: [],
  forDescendants: false, visibility: 'private',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

function Probe() {
  const { touch } = useStorage();
  const result = useStorageQuery((storage) => storage.listEntries(), [], [] as Entry[]);
  return (
    <div>
      <p>ids:{result.data.map((item) => item.id).join(',')}</p>
      <p>error:{String(result.error)}</p>
      <p>stale:{String(result.stale)}</p>
      <button type="button" onClick={touch}>Read again</button>
    </div>
  );
}

afterEach(cleanup);

describe('post-open storage read failures', () => {
  it('preserves last-known-good data and marks it stale instead of substituting empty', async () => {
    const db = new DexieStorageProvider('storage-query-last-good');
    await db.open();
    await db.putEntries([entry]);
    let fail = false;
    const provider = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'listEntries') {
          return async () => {
            if (fail) throw new Error('injected read failure');
            return target.listEntries();
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as StorageProvider;

    render(
      <StorageContextProvider provider={provider}>
        <Probe />
      </StorageContextProvider>,
    );

    expect(await screen.findByText('ids:known-good')).toBeInTheDocument();
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not been treated as empty/i);
    expect(screen.getByText('ids:known-good')).toBeInTheDocument();
    expect(screen.getByText('error:true')).toBeInTheDocument();
    expect(screen.getByText('stale:true')).toBeInTheDocument();
  });

  it('exposes an initial read failure as unreadable, not as a successful empty journal', async () => {
    const db = new DexieStorageProvider('storage-query-initial-failure');
    await db.open();
    const provider = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'listEntries') return async () => { throw new Error('injected read failure'); };
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as StorageProvider;

    render(
      <StorageContextProvider provider={provider}>
        <Probe />
      </StorageContextProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be read/i);
    await waitFor(() => expect(screen.getByText('error:true')).toBeInTheDocument());
    expect(screen.getByText('stale:false')).toBeInTheDocument();
  });
});
