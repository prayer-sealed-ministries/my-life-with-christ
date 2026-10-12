/**
 * Durability work begun by a view that is no longer mounted.
 *
 * React cannot await an effect cleanup. The write still has to outlive the
 * editor, and any backup or destructive import opened next must wait for it so
 * it cannot certify a snapshot taken just before the draft landed.
 */

export class PendingJournalWriteError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error && cause.message ? `: ${cause.message}` : '';
    super(`Recent writing could not be saved before continuing${detail}`);
    this.name = 'PendingJournalWriteError';
    this.cause = cause;
  }
}

const pending = new Set<Promise<void>>();
const failures: unknown[] = [];

/** Keep observing a write after the component that began it unmounts. */
export function trackPendingJournalWrite(write: Promise<void>): void {
  const observed = write
    .catch((cause) => {
      failures.push(cause);
    })
    .finally(() => {
      pending.delete(observed);
    });
  pending.add(observed);
}

/** Wait until every route-leave write is durable, or fail closed once. */
export async function settlePendingJournalWrites(): Promise<void> {
  // A completion callback may enqueue another write, so take snapshots until
  // the set really is empty rather than assuming one Promise.all is enough.
  while (pending.size > 0) await Promise.all([...pending]);
  if (failures.length === 0) return;
  const cause = failures.shift();
  failures.length = 0;
  throw new PendingJournalWriteError(cause);
}
