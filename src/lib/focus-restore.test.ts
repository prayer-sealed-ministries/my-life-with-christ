import { describe, expect, it } from 'vitest';

import { shouldAbandonRestore, shouldRestoreFocus } from './focus-restore';

const connected = (tag = 'button') => {
  const el = document.createElement(tag);
  document.body.append(el);
  return el;
};

const detached = (tag = 'button') => document.createElement(tag);

describe('shouldRestoreFocus', () => {
  it('restores when focus has fallen to <body>', () => {
    const target = connected();
    expect(shouldRestoreFocus({ active: document.body, target, body: document.body })).toBe(true);
  });

  it('restores when nothing holds focus at all', () => {
    const target = connected();
    expect(shouldRestoreFocus({ active: null, target, body: document.body })).toBe(true);
  });

  // The CI-only failure. A detached node is focus already falling, not a move.
  it('restores when focus is parked on a DETACHED node mid-unmount', () => {
    const target = connected();
    expect(shouldRestoreFocus({ active: detached(), target, body: document.body })).toBe(true);
  });

  it('restores when focus is somehow already on the target', () => {
    const target = connected();
    expect(shouldRestoreFocus({ active: target, target, body: document.body })).toBe(true);
  });

  it('stands down when the user moved to a real, connected element', () => {
    const target = connected();
    expect(shouldRestoreFocus({ active: connected('input'), target, body: document.body })).toBe(false);
  });

  it('does nothing without a target', () => {
    expect(shouldRestoreFocus({ active: document.body, target: null, body: document.body })).toBe(false);
  });

  it('does not chase a target that has itself unmounted', () => {
    expect(shouldRestoreFocus({ active: document.body, target: detached(), body: document.body })).toBe(false);
  });

  it('does not focus a disabled target', () => {
    const target = connected();
    target.setAttribute('disabled', '');
    expect(shouldRestoreFocus({ active: document.body, target, body: document.body })).toBe(false);
  });

  // The second race, which survived the first fix and failed ~1 run in 20: the
  // effect runs BEFORE React detaches the outgoing control, so it is still
  // connected and looks like a destination the user chose.
  it('restores when focus is still on the control that queued the restore', () => {
    const target = connected('input');
    const from = connected('button');
    expect(shouldRestoreFocus({ active: from, target, from, body: document.body })).toBe(true);
  });

  it('still stands down for a connected element that is not the one being left', () => {
    const target = connected('input');
    const from = connected('button');
    const elsewhere = connected('a');
    expect(shouldRestoreFocus({ active: elsewhere, target, from, body: document.body })).toBe(false);
  });
});

describe('shouldAbandonRestore', () => {
  // Not the negation of shouldRestoreFocus. A disabled target means "not yet" —
  // the request must survive until the button is re-enabled.
  it('keeps the request while the target is merely disabled', () => {
    const target = connected();
    target.setAttribute('disabled', '');
    expect(shouldRestoreFocus({ active: document.body, target, body: document.body })).toBe(false);
    expect(shouldAbandonRestore({ active: document.body, target, body: document.body })).toBe(false);
  });

  it('keeps the request while focus is still on the outgoing control', () => {
    const target = connected('input');
    const from = connected('button');
    expect(shouldAbandonRestore({ active: from, target, from, body: document.body })).toBe(false);
  });

  it('abandons only for a connected element the user chose', () => {
    const target = connected('input');
    expect(shouldAbandonRestore({ active: connected('a'), target, body: document.body })).toBe(true);
  });

  it('abandons when there is no target', () => {
    expect(shouldAbandonRestore({ active: document.body, target: null, body: document.body })).toBe(true);
  });
});
