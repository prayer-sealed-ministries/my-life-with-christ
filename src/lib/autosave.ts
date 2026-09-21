/**
 * The thing that stands between an hour of typing and a process death.
 *
 * Deliberately small, and deliberately not a React hook: the ordering rules
 * here are the part that must be exactly right, and they are easier to be sure
 * of when they can be driven directly by a test rather than through a render.
 *
 * Two rules, and they are both about ordering rather than timing:
 *
 *   - the newest snapshot wins, always;
 *   - once a draft is retired, nothing still in flight may bring it back.
 *
 * Anything resting on "the later timer will fire last" is a race. A write that
 * knows it is carrying stale content declines, whatever order the timers
 * actually fire in.
 */

import { DRAFT_DEBOUNCE_MS, resolveDraftWrite } from './drafts';

export interface AutosaveOptions<T> {
  /** Persist one snapshot. Rejecting means the write did not happen. */
  write: (snapshot: T) => Promise<void>;
  /** Called after every attempt, so the editor can show or clear a warning. */
  onResult?: (result: AutosaveResult) => void;
  delayMs?: number;
  /** Injected so tests drive the clock instead of waiting on it. */
  schedule?: (run: () => void, ms: number) => () => void;
}

export type AutosaveResult =
  | { status: 'saved' }
  /** The write threw. The caller still holds the text; nothing was persisted. */
  | { status: 'failed'; error: Error; consecutiveFailures: number };

const defaultSchedule = (run: () => void, ms: number): (() => void) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

export class Autosaver<T> {
  private readonly options: Required<Pick<AutosaveOptions<T>, 'write' | 'delayMs' | 'schedule'>> &
    AutosaveOptions<T>;

  /** Bumped on every queued change; the ordering authority. */
  private generation = 0;
  /** The highest generation that has actually reached storage. */
  private persisted = 0;
  private pending: { generation: number; snapshot: T } | null = null;
  private cancelTimer: (() => void) | null = null;
  private inFlight: Promise<void> = Promise.resolve();
  private retired = false;
  private consecutiveFailures = 0;

  constructor(options: AutosaveOptions<T>) {
    this.options = {
      delayMs: DRAFT_DEBOUNCE_MS,
      schedule: defaultSchedule,
      ...options,
    };
  }

  /**
   * Record the current state and start (or restart) the settle window.
   *
   * Every call supersedes the last, which is what makes a burst of typing one
   * write rather than one per keystroke.
   */
  queue(snapshot: T): void {
    if (this.retired) return;
    this.generation += 1;
    this.pending = { generation: this.generation, snapshot };
    this.cancelTimer?.();
    this.cancelTimer = this.options.schedule(() => {
      this.cancelTimer = null;
      void this.run();
    }, this.options.delayMs);
  }

  /**
   * Write whatever is outstanding, now, and wait for it.
   *
   * Used by explicit Save, which must not race the settle window: the canonical
   * write has to happen against the same text the reader can see.
   */
  async flush(): Promise<void> {
    this.cancelTimer?.();
    this.cancelTimer = null;
    await this.run();
    await this.inFlight;
  }

  /**
   * The draft is finished with — saved, or discarded.
   *
   * Fences everything still in flight. Without this, a write queued before an
   * explicit Save could land after it and recreate the draft that the save had
   * just retired, putting old text back under a finished entry.
   */
  retire(): void {
    this.retired = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.pending = null;
  }

  /** Is there text that has not reached storage yet? */
  get hasPendingWork(): boolean {
    return this.pending !== null;
  }

  /**
   * Resolves once nothing this writer started is still in flight.
   *
   * `retire()` fences everything that has not begun, but a write already
   * awaiting storage is past every fence and will land. A caller about to
   * DELETE the draft has to wait for that one, or the delete runs first and the
   * write puts the record straight back — a draft nobody can account for,
   * holding text the reader has already taken back.
   *
   * Swallows the failure on purpose: a write that threw persisted nothing,
   * which is exactly the state the caller wanted anyway.
   */
  async settled(): Promise<void> {
    await this.inFlight.catch(() => {});
  }

  private async run(): Promise<void> {
    const queued = this.pending;
    if (!queued) return;

    const outcome = resolveDraftWrite({
      generation: queued.generation,
      latest: this.generation,
      retired: this.retired,
    });
    if (outcome !== 'write') return;

    // Serialise: two overlapping writes could land out of order, and the later
    // one is not necessarily the newer one.
    const previous = this.inFlight;
    this.inFlight = (async () => {
      await previous.catch(() => {});
      // Re-check on the way in. The queue may have moved while waiting, and a
      // retire may have happened — both mean this snapshot is no longer the
      // one to write.
      const now = resolveDraftWrite({
        generation: queued.generation,
        latest: this.generation,
        retired: this.retired,
      });
      if (now !== 'write') return;

      try {
        await this.options.write(queued.snapshot);
        // A write that lands out of order must not roll the record backwards.
        if (queued.generation > this.persisted) this.persisted = queued.generation;
        if (this.pending?.generation === queued.generation) this.pending = null;
        this.consecutiveFailures = 0;
        this.options.onResult?.({ status: 'saved' });
      } catch (cause) {
        // Deliberately leaves `pending` set: the text is not in storage, so the
        // editor must keep treating it as unsaved rather than being told all is
        // well.
        this.consecutiveFailures += 1;
        this.options.onResult?.({
          status: 'failed',
          error: cause instanceof Error ? cause : new Error(String(cause)),
          consecutiveFailures: this.consecutiveFailures,
        });
      }
    })();

    await this.inFlight;
  }
}
