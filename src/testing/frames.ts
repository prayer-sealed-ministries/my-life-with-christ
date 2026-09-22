/**
 * Animation frames, owned by the test rather than by the clock.
 *
 * A frame callback outlives whatever scheduled it. Saving an entry defers its
 * navigation by one frame, so a test that ends between the schedule and the
 * frame leaves a navigation in the air — and it lands in whichever test is
 * running sixteen milliseconds later, rewriting the address out from under it.
 *
 * `save-feedback.wiring.test.tsx` papered over that with a 50ms sleep in its
 * `beforeEach`, which is not isolation: it is a bet that the stray frame fires
 * during the sleep rather than during the test. This makes the harness own the
 * frames instead, so nothing crosses a test boundary whatever the timing.
 *
 * Note what this is NOT for. The product's rule — a deferred navigation stands
 * down when the address has changed — is deliberately unchanged, and
 * deliberately does not detect leaving an address and returning to it. That is
 * a no-op in the product, where the navigation would go where the reader
 * already is. It is only a problem between tests, where an identical address
 * belongs to a different journal, and preventing it is this file's job rather
 * than the router's.
 */

export interface OwnedFrames {
  /** Frames scheduled and not yet run, however they were scheduled. */
  readonly pending: number;
  /** Frames held back by `pause`, specifically. */
  readonly captured: number;
  /**
   * Capture frames instead of scheduling them.
   *
   * For a test that needs to END with work outstanding — which is the only way
   * to prove the next test does not inherit it.
   */
  pause(): void;
  /** Run whatever `pause` held back, oldest first. */
  flush(): void;
  /** Cancel and drop everything outstanding. What teardown owes the next test. */
  settle(): void;
  /** Hand the browser back its own scheduling. */
  restore(): void;
}

/**
 * Take over `requestAnimationFrame` for the lifetime of a test file.
 *
 * Pass-through by default: frames are really scheduled and really run, so no
 * test has to change how it waits. What is added is a record of which ones are
 * still outstanding, so teardown can cancel them.
 */
export function ownAnimationFrames(): OwnedFrames {
  /** Real handles we scheduled that have not fired yet. */
  const live = new Set<number>();
  /** Callbacks withheld by `pause`. Null means pass-through. */
  let held: FrameRequestCallback[] | null = null;

  const realRequest = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);

  // Handles for captured callbacks are negative, so they can never collide
  // with a real one that `cancelAnimationFrame` might be handed.
  let capturedHandle = 0;

  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    if (held) {
      held.push(callback);
      return (capturedHandle -= 1);
    }
    const handle = realRequest((time) => {
      live.delete(handle);
      callback(time);
    });
    live.add(handle);
    return handle;
  };

  window.cancelAnimationFrame = (handle: number): void => {
    live.delete(handle);
    realCancel(handle);
  };

  const settle = () => {
    for (const handle of live) realCancel(handle);
    live.clear();
    held = null;
  };

  return {
    get pending() {
      return live.size + (held?.length ?? 0);
    },
    get captured() {
      return held?.length ?? 0;
    },
    pause() {
      held ??= [];
    },
    flush() {
      // Deliberately does nothing in pass-through: flushing must not be a way
      // to switch modes by accident.
      if (!held) return;
      const queued = held;
      held = [];
      for (const callback of queued) callback(performance.now());
    },
    settle,
    restore() {
      settle();
      window.requestAnimationFrame = realRequest;
      window.cancelAnimationFrame = realCancel;
    },
  };
}
