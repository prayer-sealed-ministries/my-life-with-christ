/**
 * The notice itself: it appears, it announces, and it goes away.
 *
 * Kept separate from the wiring test because this needs fake timers and that
 * one needs a working database, and fake-indexeddb does not run on a stopped
 * clock. Splitting them keeps each honest: the wiring test proves the message
 * survives a route change, this proves it does not outstay its welcome.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NoticeProvider } from './notice';
import { NOTICE_MS, useNotice } from './notice-context';

function Harness() {
  const { notice, showNotice } = useNotice();
  return (
    <div>
      <button onClick={() => showNotice('Saved')}>say it</button>
      <div aria-live="polite">{notice ? <p>{notice.text}</p> : null}</div>
    </div>
  );
}

const shown = () => screen.queryByText('Saved');

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a notice', () => {
  it('is not there until something happens', () => {
    render(
      <NoticeProvider>
        <Harness />
      </NoticeProvider>,
    );
    expect(shown()).toBeNull();
  });

  it('appears when shown and clears itself after the display time', () => {
    vi.useFakeTimers();
    render(
      <NoticeProvider>
        <Harness />
      </NoticeProvider>,
    );

    act(() => void screen.getByRole('button', { name: 'say it' }).click());
    expect(shown(), 'the notice never appeared').toBeTruthy();

    // Still readable most of the way through: a confirmation that vanishes
    // before it can be read is the same as no confirmation.
    act(() => void vi.advanceTimersByTime(NOTICE_MS - 500));
    expect(shown(), 'the notice went too early to be read').toBeTruthy();

    act(() => void vi.advanceTimersByTime(600));
    expect(shown(), 'the notice never went away').toBeNull();
  });

  it('restarts the clock when shown again rather than inheriting the old one', () => {
    vi.useFakeTimers();
    render(
      <NoticeProvider>
        <Harness />
      </NoticeProvider>,
    );
    const say = screen.getByRole('button', { name: 'say it' });

    act(() => void say.click());
    act(() => void vi.advanceTimersByTime(NOTICE_MS - 200));
    act(() => void say.click()); // a second save, almost at the end of the first
    act(() => void vi.advanceTimersByTime(400));

    expect(shown(), 'the second notice inherited the first one’s remaining time').toBeTruthy();
  });

  it('does nothing and throws nothing outside a provider', () => {
    // A view rendered on its own in a test must not fail for want of feedback.
    render(<Harness />);
    expect(() => screen.getByRole('button', { name: 'say it' }).click()).not.toThrow();
    expect(shown()).toBeNull();
  });
});
