import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DexieStorageProvider } from '../storage/db';
import type { StorageProvider } from '../storage/StorageProvider';
import type { Entry } from '../types';
import { StorageContextProvider, useStorage, useStorageQuery } from './storage';

let counter = 0;

afterEach(cleanup);

function Probe() {
  const { error: globalError } = useStorage();
  const result = useStorageQuery<Entry[]>((storage) => storage.listEntries(), [], []);
  return (
    <div>
      <p>{result.complete ? `${result.data.length} complete` : 'incomplete'}</p>
      {result.error ? <p>{result.error}</p> : null}
      {globalError ? <p>{globalError}</p> : null}
    </div>
  );
}

const boundProxy = (target: DexieStorageProvider, fail: boolean): StorageProvider =>
  new Proxy(target, {
    get(provider, prop, receiver) {
      if (fail && prop === 'listEntries') {
        return async () => {
          throw new Error('simulated read interruption');
        };
      }
      const value = Reflect.get(provider, prop, receiver);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(provider)
        : value;
    },
  }) as StorageProvider;

describe('post-open storage read failures', () => {
  it('reports an incomplete read instead of the initial empty value', async () => {
    const db = new DexieStorageProvider(`read-failure-${(counter += 1)}`);
    await db.open();
    await db.createEntry({ notes: 'Still here.' });

    render(
      <StorageContextProvider provider={boundProxy(db, true)}>
        <Probe />
      </StorageContextProvider>,
    );

    expect(await screen.findByText('incomplete')).toBeInTheDocument();
    expect((await screen.findAllByText(/simulated read interruption/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText('0 complete')).toBeNull();
    expect(await db.listEntries()).toHaveLength(1);
  });

  it('marks a successful empty read complete as a positive control', async () => {
    const db = new DexieStorageProvider(`read-empty-${(counter += 1)}`);
    await db.open();

    render(
      <StorageContextProvider provider={db}>
        <Probe />
      </StorageContextProvider>,
    );

    expect(await screen.findByText('0 complete')).toBeInTheDocument();
    expect(screen.queryByText('incomplete')).toBeNull();
  });
});
