/**
 * The review screen, driven the way a person drives it.
 *
 * `session.test.ts` proves the state machine. This file proves the screen is
 * wired to it: that pressing the real buttons reaches the port, that the text
 * which leaves is the text on screen, and — the assertion the whole feature
 * rests on — that nothing leaves at all until somebody presses Use text.
 *
 * Every page and every line of text here is fictional.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScanNotes } from './ScanNotes';
import { forgetPendingScan, peekPendingScan } from '../scan/pending';
import { PlatformProvider } from '../platform/provider';
import { webPlatform } from '../platform/web';
import type { PageScanner, Recognition, ScannedPage } from '../platform/ports';

const FICTIONAL_TEXT = 'FICTIONAL-SCAN\nTrust and obey\nJhn 3:16';

/** One editor, for the tests that are not about which editor. */
const OWNER = { entryId: 'fictional-entry', route: '#/entry/fictional-entry' };

const page = (over: Partial<ScannedPage> = {}): ScannedPage => ({
  handle: 'fictional-handle',
  preview: 'data:image/png;base64,iVBORw0KGgo=',
  width: 1200,
  height: 1600,
  ...over,
});

const recognition = (text = FICTIONAL_TEXT): Recognition => ({
  text,
  lines: text.split('\n').map((line) => ({ text: line })),
  imageWidth: 1200,
  imageHeight: 1600,
  engine: 'fictional-engine',
  elapsedMs: 12,
});

/** A promise a test resolves when it wants to, so a race can be staged. */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

interface FakeScanner extends PageScanner {
  discarded: string[];
}

const fakeScanner = (over: Partial<PageScanner> = {}): FakeScanner => {
  const discarded: string[] = [];
  return {
    supported: true,
    capture: async () => page(),
    choose: async () => page({ handle: 'fictional-chosen' }),
    recognise: async () => recognition(),
    async discard(scanned: ScannedPage) {
      discarded.push(scanned.handle);
    },
    ...over,
    discarded,
  };
};

const mount = (scanner: PageScanner, props: Partial<Parameters<typeof ScanNotes>[0]> = {}) => {
  const onAccept = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <PlatformProvider platform={{ ...webPlatform, scanner }}>
      <ScanNotes
        owner={OWNER}
        onAccept={onAccept}
        onClose={onClose}
        existing={{ notes: false, providedNotes: false }}
        {...props}
      />
    </PlatformProvider>,
  );
  return { onAccept, onClose, view };
};

const takePhoto = () => fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
const transcription = () => screen.getByLabelText('Transcription') as HTMLTextAreaElement;
const reviewReady = () => waitFor(() => expect(transcription()).toBeTruthy());

afterEach(() => {
  cleanup();
  // The pending page lives outside React on purpose, so it outlives a render.
  // Each test starts from nothing waiting.
  forgetPendingScan();
});

describe('scanning a page and reviewing it', () => {
  it('shows the photograph and the recognised text, and nothing has been accepted', async () => {
    const { onAccept } = mount(fakeScanner());
    takePhoto();
    await reviewReady();

    expect(transcription().value).toBe(FICTIONAL_TEXT);
    // The page itself, so the words can be checked against it.
    expect(screen.getByRole('img', { name: /scanned page/i })).toBeTruthy();
    // The assertion the feature exists for: recognition alone changes nothing.
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('does not choose a destination for the reader', async () => {
    mount(fakeScanner());
    takePhoto();
    await reviewReady();

    for (const name of ['My Notes', 'Provided notes']) {
      expect((screen.getByRole('radio', { name }) as HTMLInputElement).checked).toBe(false);
    }
    // And so the one button that writes anything cannot be pressed yet.
    expect((screen.getByRole('button', { name: 'Use text' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('accepts the edited text, not the recognised text', async () => {
    const scanner = fakeScanner();
    const { onAccept, onClose, view } = mount(scanner);
    takePhoto();
    await reviewReady();

    // "Jhn" is what the page says. Correcting it is the person's decision, and
    // the recogniser is never allowed to make it for them.
    fireEvent.change(transcription(), { target: { value: 'FICTIONAL-SCAN\nJohn 3:16' } });
    fireEvent.click(screen.getByRole('radio', { name: 'My Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use text' }));

    // Exactly one deletion for one photograph, counting the unmount too.
    await waitFor(() => expect(scanner.discarded).toEqual(['fictional-handle']));
    view.unmount();
    expect(scanner.discarded).toEqual(['fictional-handle']);

    expect(onAccept).toHaveBeenCalledWith({
      destination: 'notes',
      text: 'FICTIONAL-SCAN\nJohn 3:16',
      placement: 'append',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('accepts once, however many times the button is pressed', async () => {
    const { onAccept } = mount(fakeScanner());
    takePhoto();
    await reviewReady();
    fireEvent.click(screen.getByRole('radio', { name: 'Provided notes' }));

    const use = screen.getByRole('button', { name: 'Use text' });
    fireEvent.click(use);
    fireEvent.click(use);
    fireEvent.click(use);

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0][0].destination).toBe('providedNotes');
  });

  it('offers placement only where there is already writing, and warns about replacing', async () => {
    mount(fakeScanner(), { existing: { notes: true, providedNotes: false } });
    takePhoto();
    await reviewReady();

    expect(screen.queryByRole('radio', { name: /Replace existing text/ })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'My Notes' }));
    fireEvent.click(screen.getByRole('radio', { name: /Replace existing text/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/Replacing removes what’s there now/);

    // Switching to the empty destination takes the choice away again.
    fireEvent.click(screen.getByRole('radio', { name: 'Provided notes' }));
    expect(screen.queryByRole('radio', { name: /Replace existing text/ })).toBeNull();
  });

  it('throws its temporary copy away on cancel, and tells the editor to close', async () => {
    const scanner = fakeScanner();
    const { onClose, onAccept } = mount(scanner);
    takePhoto();
    await reviewReady();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(scanner.discarded).toEqual(['fictional-handle']));
    expect(onClose).toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('throws the previous copy away when another page is taken', async () => {
    const scanner = fakeScanner();
    mount(scanner);
    takePhoto();
    await reviewReady();

    fireEvent.click(screen.getByRole('button', { name: 'Choose another' }));
    await waitFor(() => expect(transcription()).toBeTruthy());
    expect(scanner.discarded).toEqual(['fictional-handle']);
  });
});

describe('a photograph that outlives the screen', () => {
  it('waits for the person rather than being deleted with the sheet', async () => {
    const scanner = fakeScanner();
    const view = render(
      <PlatformProvider platform={{ ...webPlatform, scanner }}>
        <ScanNotes
          owner={OWNER}
          onAccept={() => {}}
          onClose={() => {}}
          existing={{ notes: false, providedNotes: false }}
        />
      </PlatformProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());

    /*
      Nobody pressed Cancel and nobody pressed Use text — the tree simply went
      away. On Android that is what App Lock does: the camera backgrounds the
      app, and with a timeout of "Immediately" the gate unmounts everything
      before the person is back with their photograph.

      Deleting it here is what used to happen, and it is what made the feature
      unusable with App Lock on. The page waits instead.
    */
    view.unmount();
    expect(scanner.discarded).toEqual([]);
    expect(peekPendingScan()?.page.handle).toBe('fictional-handle');
  });

  it('is offered back to the same editor, and read only then', async () => {
    const scanner = fakeScanner();
    const first = render(
      <PlatformProvider platform={{ ...webPlatform, scanner }}>
        <ScanNotes
          owner={OWNER}
          onAccept={() => {}}
          onClose={() => {}}
          existing={{ notes: false, providedNotes: false }}
        />
      </PlatformProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
    first.unmount();

    // The sheet comes back the way it does after an unlock: a fresh mount,
    // with nothing in React state, finding the page waiting outside it.
    const { onAccept } = mount(scanner);
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
    expect((screen.getByLabelText('Transcription') as HTMLTextAreaElement).value).toBe(
      FICTIONAL_TEXT,
    );
    expect(screen.getByRole('img', { name: /scanned page/i })).toBeTruthy();
    // Resuming is not accepting. Nothing has been written anywhere.
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('is not offered to a different entry', async () => {
    const scanner = fakeScanner();
    const first = render(
      <PlatformProvider platform={{ ...webPlatform, scanner }}>
        <ScanNotes
          owner={OWNER}
          onAccept={() => {}}
          onClose={() => {}}
          existing={{ notes: false, providedNotes: false }}
        />
      </PlatformProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
    first.unmount();

    // A different entry entirely. A page photographed for one entry must never
    // be presented over another, even though nothing could be written without
    // somebody choosing a destination and pressing Use text.
    mount(scanner, {
      owner: { entryId: 'fictional-other-entry', route: '#/entry/fictional-other-entry' },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' })).toBeTruthy());
    expect(screen.queryByLabelText('Transcription')).toBeNull();
  });

  it('is deleted once the person has answered', async () => {
    const scanner = fakeScanner();
    mount(scanner);
    fireEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() => expect(screen.getByLabelText('Transcription')).toBeTruthy());
    expect(peekPendingScan()).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(scanner.discarded).toEqual(['fictional-handle']));
    expect(peekPendingScan()).toBeNull();
  });
});

describe('when the device cannot read the page', () => {
  it('says so, and offers no cloud alternative', async () => {
    mount(fakeScanner({ recognise: async () => ({ reason: 'no-text' as const }) }));
    takePhoto();

    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert.textContent).toMatch(/find readable text on this page/i);

    /*
      Honest, and silent about anywhere else to try, because there is nowhere
      else. The assertion is scoped to the failure message and to what is on
      offer afterwards: the standing line above it says the page "isn’t
      uploaded for recognition", so a blanket search of the screen for the word
      "upload" fails on the very sentence that makes the promise.
    */
    expect(alert.textContent).not.toMatch(/cloud|server|upload|online|internet|try again later/i);
    const offered = screen.getAllByRole('button').map((button) => button.textContent ?? '');
    expect(offered).toEqual(['Take photo', 'Choose photo', 'Cancel']);
  });

  it('keeps choosing a photo available when the camera is refused', async () => {
    mount(fakeScanner({ capture: async () => ({ reason: 'permission-denied' as const }) }));
    takePhoto();

    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert.textContent).toMatch(/camera access/i);
    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeTruthy();
  });

  it('says nothing at all when the person simply backed out', async () => {
    mount(fakeScanner({ capture: async () => ({ reason: 'cancelled' as const }) }));
    takePhoto();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' })).toBeTruthy());
    // A cancellation is not an error and must not be reported as one.
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('a blurry photograph', () => {
  it('warns, and lets the person decide anyway', async () => {
    mount(fakeScanner({ capture: async () => page({ blurWarning: true }) }));
    takePhoto();
    await reviewReady();

    expect(screen.getByRole('alert').textContent).toMatch(/too blurry/i);
    fireEvent.click(screen.getByRole('button', { name: 'Use anyway' }));
    expect(screen.queryByText(/too blurry/i)).toBeNull();
    // The warning is advice about a photograph, never a verdict on the text.
    expect(transcription().value).toBe(FICTIONAL_TEXT);
  });
});

describe('a result that arrives after the page it belongs to is gone', () => {
  it('is discarded rather than shown', async () => {
    const slow = deferred<Recognition>();
    const { onAccept } = mount(
      fakeScanner({ recognise: async () => slow.promise }),
    );
    takePhoto();
    await waitFor(() => expect(screen.getByText(/Reading your page/)).toBeTruthy());

    // The person gives up while the device is still reading.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take photo' })).toBeTruthy());

    // …and the recognition lands afterwards, belonging to a session that no
    // longer exists. Without the generation check it would open a review
    // screen over a photograph the person had already dismissed.
    slow.settle(recognition('FICTIONAL-SCAN stale text'));
    await Promise.resolve();

    expect(screen.queryByLabelText('Transcription')).toBeNull();
    expect(document.body.textContent).not.toMatch(/stale text/);
    expect(onAccept).not.toHaveBeenCalled();
  });
});
