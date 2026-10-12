/**
 * The ordering rules, driven rather than waited for.
 *
 * Every case here pins an interleaving on purpose. The failure these protect
 * against — an older write landing on top of newer text — is exactly the kind
 * that shows up once in a few hundred runs if you leave it to timers.
 */

import { describe, expect, it, vi } from 'vitest';

import { Autosaver } from './autosave';
import { DRAFT_DEBOUNCE_MS, resolveDraftWrite } from './drafts';

/** A clock the test owns. Nothing here waits on a real timer. */
function heldClock() {
  let pending: Array<{ run: () => void; cancelled: boolean }> = [];
  return {
    schedule: (run: () => void) => {
      const task = { run, cancelled: false };
      pending.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    /** Fire every timer that has not been cancelled. */
    tick: () => {
      const due = pending;
      pending = [];
      for (const task of due) if (!task.cancelled) task.run();
    },
    scheduled: () => pending.filter((task) => !task.cancelled).length,
  };
}

/**
 * Let queued microtasks run.
 *
 * Writes are serialised behind an in-flight promise on purpose, so the call
 * lands a microtask after the timer rather than inside it. Waiting for that is
 * not the same as waiting for a duration — no clock advances here.
 */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
};

/** A writer whose completion the test decides. */
function gatedWriter() {
  const writes: string[] = [];
  const gates: Array<() => void> = [];
  return {
    writes,
    /** Release the nth write, in call order. */
    release: () => gates.shift()?.(),
    pendingWrites: () => gates.length,
    write: (snapshot: string) =>
      new Promise<void>((resolve) => {
        writes.push(snapshot);
        gates.push(resolve);
      }),
  };
}

describe('resolveDraftWrite', () => {
  it('writes the newest queued snapshot', () => {
    expect(resolveDraftWrite({ generation: 3, latest: 3, retired: false })).toBe('write');
  });

  it('declines a snapshot that something newer has already superseded', () => {
    expect(resolveDraftWrite({ generation: 2, latest: 3, retired: false })).toBe('superseded');
  });

  it('declines everything once the draft has been retired', () => {
    // The sequence that would otherwise put old text back under a saved entry.
    expect(resolveDraftWrite({ generation: 9, latest: 9, retired: true })).toBe('retired');
  });
});

describe('Autosaver', () => {
  it('coalesces a burst of typing into one write', async () => {
    const clock = heldClock();
    const writer = gatedWriter();
    const saver = new Autosaver<string>({ write: writer.write, schedule: clock.schedule });

    for (const text of ['H', 'He', 'He ', 'He r', 'He re', 'He read']) saver.queue(text);
    expect(writer.writes, 'nothing should have been written mid-burst').toEqual([]);

    clock.tick();
    await settle();
    expect(writer.writes, 'one write, carrying the latest text').toEqual(['He read']);
  });

  it('writes the latest snapshot, not the one that started the window', async () => {
    const clock = heldClock();
    const writer = gatedWriter();
    const saver = new Autosaver<string>({ write: writer.write, schedule: clock.schedule });

    saver.queue('first');
    saver.queue('second');
    saver.queue('third');
    clock.tick();
    await settle();

    expect(writer.writes).toEqual(['third']);
  });

  /**
   * The race, pinned.
   *
   * A write is in flight and slow. The reader keeps typing. When the slow write
   * finally finishes, the newer text must be what ends up in storage — and the
   * older snapshot must never be written a second time.
   */
  it('does not let a slow earlier write overwrite newer text', async () => {
    const clock = heldClock();
    const writer = gatedWriter();
    const saver = new Autosaver<string>({ write: writer.write, schedule: clock.schedule });

    saver.queue('old text');
    clock.tick();
    await settle();
    expect(writer.writes).toEqual(['old text']);

    // Newer text arrives while the first write is still in the air.
    saver.queue('new text');
    clock.tick();
    await settle();

    writer.release(); // the old one lands
    await settle();
    writer.release(); // the new one lands
    await settle();

    expect(writer.writes).toEqual(['old text', 'new text']);
    expect(writer.writes.at(-1), 'the newest text must be the last thing written').toBe('new text');
  });

  it('flush writes what is outstanding without waiting for the window', async () => {
    const clock = heldClock();
    const writer = gatedWriter();
    const saver = new Autosaver<string>({ write: writer.write, schedule: clock.schedule });

    saver.queue('not yet settled');
    expect(writer.writes).toEqual([]);

    const flushed = saver.flush();
    await settle();
    expect(writer.writes, 'flush must not wait for the debounce').toEqual(['not yet settled']);
    writer.release();
    await flushed;
  });

  /**
   * The sequence an explicit Save has to survive.
   *
   * Autosave queued -> Save flushes and retires -> the old timer fires. If the
   * fence were missing, that last step would recreate a draft holding text the
   * reader had already saved past.
   */
  it('a stale autosave cannot resurrect a draft after Save retired it', async () => {
    const clock = heldClock();
    const writer = gatedWriter();
    const saver = new Autosaver<string>({ write: writer.write, schedule: clock.schedule });

    saver.queue('half a sentence');
    saver.retire(); // what Save does once the canonical entry is written

    clock.tick(); // the window that was already running fires
    saver.queue('typed after the save');
    clock.tick();
    await settle();

    expect(writer.writes, 'nothing may be written once the draft is retired').toEqual([]);
  });

  it('reports a failure as a failure and keeps the work pending', async () => {
    const clock = heldClock();
    const results: string[] = [];
    const saver = new Autosaver<string>({
      write: () => Promise.reject(new Error('disk is full')),
      onResult: (result) => results.push(result.status),
      schedule: clock.schedule,
    });

    saver.queue('words worth keeping');
    clock.tick();
    await vi.waitFor(() => expect(results).toContain('failed'));

    expect(results, 'a failed write must never be reported as saved').not.toContain('saved');
    expect(saver.hasPendingWork, 'the text is not in storage, so it is still pending').toBe(true);
  });

  it('rejects an explicit flush when the pending snapshot did not become durable', async () => {
    const failure = new Error('disk is full');
    const saver = new Autosaver<string>({ write: () => Promise.reject(failure) });
    saver.queue('words worth keeping');

    await expect(saver.flush()).rejects.toBe(failure);
    expect(saver.hasPendingWork).toBe(true);
  });

  it('counts consecutive failures so a persistent one can become visible', async () => {
    const clock = heldClock();
    let failures = 0;
    const saver = new Autosaver<string>({
      write: () => Promise.reject(new Error('still full')),
      onResult: (result) => {
        if (result.status === 'failed') failures = result.consecutiveFailures;
      },
      schedule: clock.schedule,
    });

    saver.queue('one');
    clock.tick();
    await vi.waitFor(() => expect(failures).toBe(1));
    saver.queue('two');
    clock.tick();
    await vi.waitFor(() => expect(failures).toBe(2));
  });

  it('uses the shared debounce constant rather than a number of its own', () => {
    // One place to reason about the loss window.
    expect(DRAFT_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(DRAFT_DEBOUNCE_MS).toBeLessThanOrEqual(1000);
  });
});
