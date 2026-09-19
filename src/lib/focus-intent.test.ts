import { describe, expect, it } from 'vitest';

import { resolveFocusIntent } from './focus-intent';

/**
 * The three states, stated exactly, because the interleaving that produced the
 * middle one happened about twice in three hundred full-suite runs and cannot
 * be summoned on demand.
 */

const body = document.createElement('body');

const connected = (tag = 'input'): Element => {
  const el = document.createElement(tag);
  document.body.append(el);
  return el;
};

const detached = (tag = 'input'): Element => document.createElement(tag);

describe('resolveFocusIntent', () => {
  it('focuses a destination that is present and usable', () => {
    const target = connected();
    expect(resolveFocusIntent({ target, active: document.body, body: document.body })).toBe('focus');
  });

  /**
   * The captured failure, as a state.
   *
   * The trace read: CLAIM.run found=false target=null, with activeElement on
   * <body>. The old code treated that as "done" and dropped the request, which
   * left focus free for the deferred default claim to take to the notes box.
   * It must mean "not yet".
   */
  it('waits when the destination does not exist yet and nothing holds focus', () => {
    expect(resolveFocusIntent({ target: null, active: document.body, body: document.body })).toBe(
      'wait',
    );
    expect(resolveFocusIntent({ target: undefined, active: null, body: document.body })).toBe(
      'wait',
    );
  });

  it('waits when focus is sitting on a node already detached mid-transition', () => {
    // Focus falling is not the reader choosing to be somewhere.
    expect(
      resolveFocusIntent({ target: null, active: detached(), body: document.body }),
    ).toBe('wait');
  });

  it('treats a disabled destination as not ready rather than as a refusal', () => {
    const target = connected('button');
    target.setAttribute('disabled', '');
    expect(resolveFocusIntent({ target, active: document.body, body: document.body })).toBe('wait');
  });

  it('abandons the request once the reader has put focus somewhere real', () => {
    // Their newer action outranks the older request; taking it back would be
    // worse than never honouring it.
    expect(
      resolveFocusIntent({ target: null, active: connected(), body: document.body }),
    ).toBe('abandon');
  });

  it('still focuses the destination even if the reader moved, once it arrives', () => {
    // The destination winning here is deliberate: it is what the reader asked
    // for, and it has now appeared.
    const target = connected();
    expect(resolveFocusIntent({ target, active: connected(), body: document.body })).toBe('focus');
  });

  it('does not confuse another document body with this one', () => {
    // `body` is passed in rather than read, so the predicate stays pure.
    expect(resolveFocusIntent({ target: null, active: body, body })).toBe('wait');
  });
});
