import { describe, expect, it } from 'vitest';

import { shouldRestoreFocus } from './focus-restore';

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
});
