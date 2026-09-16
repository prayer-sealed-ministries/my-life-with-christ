import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import EntryEditor from './EntryEditor';
import { RouterProvider } from '../app/router';
import { Shell } from '../app/Shell';
import { ThemeProvider } from '../app/theme';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';

/**
 * The fast-capture focus claim, with the frame boundary pinned.
 *
 * This view puts the cursor in the notes box on open, deferred by one animation
 * frame so it lands after the shell has focused the page heading. A deferred
 * claim can arrive late, and on a slow machine it arrived after the reader had
 * already clicked something — yanking the cursor out of wherever they had gone.
 *
 * It surfaced as a test failing about once in 115 full-suite runs, which is not
 * a rate anything can be hunted down at: 150 clean runs would still leave a 27%
 * chance it survived, and matching real confidence would take ~780. So the race
 * is driven here instead of waited for. `requestAnimationFrame` is held, the
 * interleaving is chosen, and BOTH orderings are asserted.
 */

let counter = 0;

/**
 * Rendered inside the real Shell, not bare.
 *
 * The claim exists to win against the shell's own post-navigation focus, and
 * the fix reads `main [tabindex="-1"]` to know what it may take focus from.
 * A bare render has no <main> at all, so the interaction under test would
 * simply not exist — the harness has to supply the thing being raced.
 */
function setup() {
  // A returning visitor. jsdom has no <dialog>.showModal, and the first-visit
  // notice is not what is under test here.
  localStorage.setItem('journey:welcomed', '1');
  const storage = new DexieStorageProvider(`focus-race-${++counter}`);
  render(
    <ThemeProvider>
      <StorageContextProvider provider={storage}>
        <RouterProvider>
          <Shell title="New entry">
            <EntryEditor />
          </Shell>
        </RouterProvider>
      </StorageContextProvider>
    </ThemeProvider>,
  );
  return storage;
}

/** Capture animation frames instead of running them, so the test decides when. */
function holdFrames() {
  const pending: Array<() => void> = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => pending.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return {
    count: () => pending.length,
    /**
     * Wait until the claim has actually queued its frame.
     *
     * `findByLabelText` resolves the moment the textarea is in the DOM, which is
     * NOT the moment React has finished running the effect that schedules the
     * frame. Those are two different instants, and under load they separate:
     * this file began failing about one run in four purely because a 48th test
     * file changed how vitest distributes work across workers, widening the gap.
     * Nothing about the component changed.
     *
     * Waiting for the frame is not a weaker assertion than asserting it is
     * already there — the claim under test is "the focus claim is deferred by a
     * frame", and that is still exactly what is required and then flushed. What
     * is dropped is an assumption about effect ordering that was never the
     * subject.
     */
    queued: async () => {
      await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    },
    flush: () => {
      for (const cb of pending.splice(0)) cb();
    },
  };
}

async function openDetails() {
  const details = document.querySelector('details') as HTMLDetailsElement | null;
  if (!details) throw new Error('the details disclosure is missing');
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

afterEach(() => {
  // Explicit: auto-cleanup only registers when vitest runs with globals, and
  // without it a second EntryEditor mounts over the first and every query
  // becomes ambiguous.
  cleanup();
  vi.unstubAllGlobals();
});

describe('fast-capture focus claim, frame boundary pinned', () => {
  it('takes focus when the frame lands first — fast capture still works', async () => {
    const frames = holdFrames();
    setup();
    await screen.findByLabelText('Notes');

    await frames.queued();
    frames.flush();

    const notes = screen.getByLabelText('Notes');
    expect(notes).toHaveFocus();
  });

  // The race, driven rather than waited for.
  it('does NOT take focus when the frame lands after the reader has moved', async () => {
    const frames = holdFrames();
    setup();
    await screen.findByLabelText('Notes');
    await openDetails();

    const addLink = await screen.findByRole('button', { name: 'Add a link' });
    fireEvent.click(addLink);
    await waitFor(() => expect(screen.getByLabelText('Web address for link 1')).toHaveFocus());

    await frames.queued();

    const remove = screen.getByRole('button', { name: 'Remove link 1' });
    remove.focus();
    fireEvent.click(remove);

    // Focus has landed where removing a row should leave it.
    expect(addLink).toHaveFocus();

    // Now the held mount frame arrives, late. It must stand down.
    frames.flush();
    expect(addLink, 'the late frame stole focus from where the reader was').toHaveFocus();
    expect(screen.getByLabelText('Notes')).not.toHaveFocus();
  });

  it('still takes focus from the shell, which is what the deferral is for', async () => {
    // The claim is deliberately allowed to take focus back from the shell's own
    // post-navigation target. Only a reader-chosen element stops it.
    const frames = holdFrames();
    setup();
    await screen.findByLabelText('Notes');

    await frames.queued();

    const shellTarget = document.querySelector('main [tabindex="-1"]') as HTMLElement | null;
    expect(shellTarget, 'the shell focus target is missing').not.toBeNull();
    shellTarget!.focus();
    expect(shellTarget).toHaveFocus();

    frames.flush();
    expect(screen.getByLabelText('Notes'), 'the claim should win against the shell').toHaveFocus();
  });
});
