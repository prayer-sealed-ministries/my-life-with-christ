import { describe, expect, it } from 'vitest';

import { DexieStorageProvider } from './db';

let stores = 0;

describe('multiple IndexedDB writers', () => {
  it('preserves disjoint overlapping patches when no stale snapshot is supplied', async () => {
    const name = `multi-writer-${(stores += 1)}`;
    const first = new DexieStorageProvider(name);
    const second = new DexieStorageProvider(name);
    await Promise.all([first.open(), second.open()]);
    const original = await first.createEntry({ title: 'Original', notes: 'Original notes' });

    await Promise.all([
      first.updateEntry(original.id, { title: 'Renamed' }),
      second.updateEntry(original.id, { notes: 'Expanded notes' }),
    ]);

    expect(await first.getEntry(original.id)).toMatchObject({
      title: 'Renamed',
      notes: 'Expanded notes',
    });
  });
});
