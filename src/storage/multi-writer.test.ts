import { describe, expect, it } from 'vitest';

import { DexieStorageProvider } from './db';
import { EntryConflictError } from './semantics';

let stores = 0;

describe('multiple IndexedDB writers', () => {
  it('allows exactly one of two stale same-entry revisions to be acknowledged', async () => {
    const name = `multi-writer-${(stores += 1)}`;
    const first = new DexieStorageProvider(name);
    const second = new DexieStorageProvider(name);
    await Promise.all([first.open(), second.open()]);
    const original = await first.createEntry({ title: 'Shared tab', notes: 'original' });
    const [seenFirst, seenSecond] = await Promise.all([
      first.getEntry(original.id),
      second.getEntry(original.id),
    ]);

    const outcomes = await Promise.allSettled([
      first.updateEntry(original.id, { notes: 'first tab' }, seenFirst),
      second.updateEntry(original.id, { notes: 'second tab' }, seenSecond),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toMatchObject({ reason: expect.any(EntryConflictError) });
    const winner = outcomes.find((outcome) => outcome.status === 'fulfilled');
    expect(await first.getEntry(original.id)).toEqual(
      winner && winner.status === 'fulfilled' ? winner.value : undefined,
    );
  });

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

  it('preserves the one acknowledged winner over randomized interleavings', async () => {
    const name = `multi-writer-${(stores += 1)}`;
    const first = new DexieStorageProvider(name);
    const second = new DexieStorageProvider(name);
    await Promise.all([first.open(), second.open()]);
    const created = await first.createEntry({ title: 'Interleavings', notes: 'seed' });
    let seed = 0x5eed1234;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };

    for (let round = 0; round < 32; round += 1) {
      const [left, right] = await Promise.all([
        first.getEntry(created.id),
        second.getEntry(created.id),
      ]);
      if (!left || !right) throw new Error('entry disappeared during the state machine');
      const leftYield = random() % 3;
      const rightYield = random() % 3;
      const yieldTimes = async (count: number) => {
        for (let index = 0; index < count; index += 1) await Promise.resolve();
      };
      const outcomes = await Promise.allSettled([
        yieldTimes(leftYield).then(() =>
          first.updateEntry(created.id, { notes: `left-${round}` }, left),
        ),
        yieldTimes(rightYield).then(() =>
          second.updateEntry(created.id, { notes: `right-${round}` }, right),
        ),
      ]);
      const fulfilled = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof first.updateEntry>>> =>
          outcome.status === 'fulfilled',
      );
      expect(fulfilled, `round ${round} acknowledged more or fewer than one revision`).toHaveLength(1);
      expect(await first.getEntry(created.id)).toEqual(fulfilled[0].value);
    }
  });
});
