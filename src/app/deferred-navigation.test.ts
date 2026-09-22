/**
 * The decision a late navigation has to make, driven directly.
 *
 * Two states, and the interesting one is the second. See the module for the
 * failure that produced it.
 */

import { describe, expect, it } from 'vitest';

import { resolveDeferredNavigation } from './deferred-navigation';

describe('a navigation waiting for its frame', () => {
  it('goes ahead when the app is still where it was scheduled', () => {
    expect(
      resolveDeferredNavigation({
        scheduledFrom: '#/entry/abc',
        current: '#/entry/abc',
      }),
    ).toBe('navigate');
  });

  it('stands down when something else has navigated since', () => {
    expect(
      resolveDeferredNavigation({
        scheduledFrom: '#/entry/abc',
        current: '#/search?q=heron',
      }),
    ).toBe('superseded');
  });

  it('stands down even when the reader only moved within the same view', () => {
    // A query change is a navigation like any other: the reader chose it, and
    // it is newer than the one waiting.
    expect(
      resolveDeferredNavigation({
        scheduledFrom: '#/search?q=heron',
        current: '#/search?q=kingfisher',
      }),
    ).toBe('superseded');
  });

  it('treats the empty address as an address', () => {
    // A fresh load has no hash at all; a navigation scheduled from there is
    // still overtaken by the first real one.
    expect(resolveDeferredNavigation({ scheduledFrom: '', current: '' })).toBe('navigate');
    expect(resolveDeferredNavigation({ scheduledFrom: '', current: '#/' })).toBe('superseded');
  });
});
