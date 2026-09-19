/**
 * The focus handoff for controls that do not exist yet, with the interleaving
 * pinned instead of hoped for.
 *
 * `EntryEditor — details moves focus into a new link row, and back out of a
 * removed one` failed about 2 runs in 300 of the full suite (0.67%) — a rate
 * nothing can be hunted at, since ~780 runs would be needed for real
 * confidence. So the ordering that produced it was captured with an in-process
 * trap and is reproduced here directly.
 *
 * The captured failure, from a real full-suite run:
 *
 *   CLAIM.schedule   gen=30  listMountedNow=false  active=BODY
 *   FASTCAP.schedule gen=31  pendingExplicitClaim=YES  active=BODY
 *   CLAIM.exec.start gen=30  listMounted=FALSE  urlInputsInDom=0
 *   CLAIM.run        gen=30  found=FALSE  target=null
 *
 * against the same run's passing case:
 *
 *   CLAIM.schedule   gen=29  listMountedNow=false  active=BODY
 *   CLAIM.exec.start gen=29  listMounted=TRUE  urlInputsInDom=1
 *   CLAIM.run        gen=29  found=true
 *   FASTCAP.exec     gen=28  activeBefore=input[url]  decision=stand-down
 *
 * The difference is which commit consumed the request. The old code ran it on
 * whatever render came next and discarded it either way; when an unrelated
 * commit landed first, the request was spent against a DOM with no link row in
 * it, focus stayed on <body>, and the still-pending default claim took the
 * caret to Notes — which is exactly what the failing assertion reported.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

import EntryEditor from './EntryEditor';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';

let counter = 0;

function setup(ui: ReactElement = <EntryEditor />) {
  window.location.hash = '#/entry/new';
  const storage = new DexieStorageProvider(`focus-intent-${(counter += 1)}`);
  render(
    <RouterProvider>
      <StorageContextProvider provider={storage}>{ui}</StorageContextProvider>
    </RouterProvider>,
  );
  return storage;
}

const notes = () => screen.findByLabelText('Notes');
const addLink = () => screen.getByRole('button', { name: 'Add a link' });
const url = (n: number) => screen.getByLabelText(`Web address for link ${n}`);

/**
 * Frames held, and cancellation honoured.
 *
 * `cancelAnimationFrame` must really drop the callback. A no-op stub cannot
 * tell a frame that was properly cancelled from one that leaked, which is the
 * distinction several of these tests turn on.
 */
function holdFrames() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    pending.delete(id);
  });
  return {
    pending: () => pending.size,
    /**
     * Wait until the deferred claim has actually queued its frame.
     *
     * The textarea being in the DOM is NOT the moment React has run the effect
     * that schedules the frame, and under a loaded machine those two instants
     * separate. Flushing before the frame exists flushes nothing, and the test
     * then passes or fails on luck — which is exactly what happened here: three
     * of these tests failed across 100 full-suite runs before this was added.
     * EntryEditor.focus-race.test.tsx carries the same helper for the same
     * reason; this file should have used it from the start.
     */
    queued: async () => {
      await waitFor(() => expect(pending.size).toBeGreaterThan(0));
    },
    flush: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb();
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('focus intent — a requested destination is not lost to an unrelated render', () => {
  // A. The ordinary path still works.
  it('puts focus in the new link row when it is asked for', async () => {
    setup();
    await notes();

    fireEvent.click(addLink());
    expect(url(1)).toHaveFocus();
  });

  /**
   * The captured failure, driven.
   *
   * React batches the click's state update with the ref write, so simply
   * clicking never separates them — the row always arrives on the very next
   * commit and the bug cannot appear. What the full-suite run produced was a
   * commit BETWEEN the request and the row: the trace shows the intent being
   * consumed while `listMounted=false` and `urlInputsInDom=0`.
   *
   * That is what is staged here, at the exact seam the trace names — the
   * lookup the intent performs. The first resolution finds nothing, as it did
   * in the failing run; a later commit (an ordinary keystroke) finds the row.
   *
   * Staging it this way rather than hoping for it is the point: the natural
   * rate was 2 in 300 full-suite runs.
   */
  it('survives a commit that cannot yet honour the request', async () => {
    const frames = holdFrames();

    // Exactly one lookup fails — the commit the trace caught.
    const real = Element.prototype.querySelector;
    let blanked = false;
    vi.spyOn(Element.prototype, 'querySelector').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      if (!blanked && selector === 'li:last-child input[type="url"]') {
        blanked = true;
        return null;
      }
      return real.call(this, selector) as Element | null;
    });

    setup();
    await notes();
    await frames.queued();
    expect(frames.pending(), 'the default claim should still be on a frame').toBeGreaterThan(0);

    fireEvent.click(addLink());

    // The request could not be honoured on that commit. It must not have been
    // thrown away, and the default claim must not have been left free to fire.
    expect(blanked, 'the failing lookup was never staged').toBe(true);
    frames.flush();
    expect(
      screen.getByLabelText('Notes'),
      'the default claim took the caret after the request went unhonoured',
    ).not.toHaveFocus();

    // The next commit can honour it, and does.
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'a word' } });
    expect(url(1), 'the request was dropped instead of being retried').toHaveFocus();
  });

  /**
   * C. The stale-frame case, stated as the rule rather than the symptom.
   *
   * Focus is deliberately dropped to <body> while the row is mounted — the
   * state the default claim reads as "nothing holds focus, I may act". It must
   * not act, because the reader asked for somewhere specific.
   */
  it('will not let a stale default claim take focus once a row has been requested', async () => {
    const frames = holdFrames();
    setup();
    await notes();
    // There is a default claim in flight to be stale, so this is not vacuous.
    await frames.queued();

    fireEvent.click(addLink());
    expect(url(1)).toHaveFocus();

    (document.activeElement as HTMLElement).blur();
    expect(document.body).toHaveFocus();

    frames.flush();
    expect(
      screen.getByLabelText('Notes'),
      'the default claim fired into a focus the reader had already directed',
    ).not.toHaveFocus();
  });

  // B. Removing the focused row hands focus to the surviving control.
  it('hands focus back to Add a link when the focused row is removed', async () => {
    setup();
    await notes();

    fireEvent.click(addLink());
    expect(url(1)).toHaveFocus();

    const remove = screen.getByRole('button', { name: 'Remove link 1' });
    remove.focus();
    fireEvent.click(remove);

    expect(screen.queryByLabelText('Web address for link 1')).not.toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
    expect(addLink()).toHaveFocus();
  });

  // D. Rapid transitions resolve to the latest intent, never to <body>.
  it('resolves rapid add/remove/add to the newest destination', async () => {
    const frames = holdFrames();
    setup();
    await notes();
    await frames.queued();

    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(addLink());
      expect(url(1), `round ${round}: the new row did not take focus`).toHaveFocus();

      const remove = screen.getByRole('button', { name: 'Remove link 1' });
      remove.focus();
      fireEvent.click(remove);
      expect(addLink(), `round ${round}: focus did not come back`).toHaveFocus();
      expect(document.body, `round ${round}: focus fell to body`).not.toHaveFocus();
    }

    fireEvent.click(addLink());
    frames.flush();
    expect(url(1), 'the newest request lost to an older claim').toHaveFocus();
  });

  it('keeps the second row when two are added in one tick', async () => {
    setup();
    await notes();

    const button = addLink();
    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.getByLabelText('Web address for link 2')).toBeInTheDocument();
    expect(url(2), 'the later request should win').toHaveFocus();
  });

  /**
   * The deferral still exists for the reason it was written: on opening, the
   * caret belongs in the notes box. Removing that would "fix" the race by
   * deleting the behaviour.
   */
  it('still puts the caret in the notes box when nothing else was asked for', async () => {
    const frames = holdFrames();
    setup();
    await notes();
    await frames.queued();

    expect(screen.getByLabelText('Notes')).not.toHaveFocus();
    frames.flush();
    expect(screen.getByLabelText('Notes')).toHaveFocus();
  });
});
