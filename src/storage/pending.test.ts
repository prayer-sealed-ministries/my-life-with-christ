import { describe, expect, it } from 'vitest';

import {
  PendingJournalWriteError,
  settlePendingJournalWrites,
  trackPendingJournalWrite,
} from './pending';

describe('journal writes that outlive their editor', () => {
  it('holds a snapshot operation until the write has finished', async () => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    trackPendingJournalWrite(held);

    let settled = false;
    const waiting = settlePendingJournalWrites().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    release();
    await waiting;
    expect(settled).toBe(true);
  });

  it('fails closed once when a route-leave write did not become durable', async () => {
    trackPendingJournalWrite(Promise.reject(new Error('disk is full')));

    await expect(settlePendingJournalWrites()).rejects.toBeInstanceOf(PendingJournalWriteError);
    // The failure has been reported. A retry is allowed to inspect storage
    // again rather than being permanently poisoned by one old attempt.
    await expect(settlePendingJournalWrites()).resolves.toBeUndefined();
  });
});
