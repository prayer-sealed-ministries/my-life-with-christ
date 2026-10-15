/**
 * Who a waiting photograph belongs to, and how long it may wait.
 *
 * These are the rules that decide whether a page somebody photographed for one
 * entry can be presented over another. They are pure, so every case that
 * matters — including the ones that only happen when a lock interrupts a scan
 * halfway — can be driven directly instead of staged through two mounts and a
 * camera.
 *
 * Every id and route here is fictional.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  expiredPendingScan,
  forgetPendingScan,
  peekPendingScan,
  pendingScanIsFresh,
  PENDING_SCAN_TTL_MS,
  rememberPendingScan,
  resumablePendingScan,
  sameScanOwner,
  type PendingScan,
  type ScanOwner,
} from './pending';
import type { ScannedPage } from '../platform/ports';

const page = (handle = 'fictional-handle'): ScannedPage => ({
  handle,
  preview: 'data:image/png;base64,iVBORw0KGgo=',
  width: 1200,
  height: 1600,
});

const NOW = 1_800_000_000_000;

const waiting = (owner: ScanOwner, over: Partial<PendingScan> = {}): PendingScan => ({
  page: page(),
  source: 'camera',
  owner,
  acquiredAt: NOW,
  ...over,
});

afterEach(() => {
  forgetPendingScan();
});

describe('which editor a waiting page belongs to', () => {
  it('matches a saved entry only by its id', () => {
    const owner = { entryId: 'fictional-entry', route: '#/entry/fictional-entry' };
    expect(sameScanOwner(owner, { ...owner })).toBe(true);
    // The same entry reached from a different address is still that entry.
    expect(sameScanOwner(owner, { entryId: 'fictional-entry', route: '#/entry/fictional-entry?focus=1' })).toBe(true);
    // A different entry never matches, however alike the address.
    expect(sameScanOwner(owner, { entryId: 'fictional-other', route: '#/entry/fictional-entry' })).toBe(false);
  });

  it('never lets a saved entry and an unsaved draft stand in for each other', () => {
    const saved = { entryId: 'fictional-entry', route: '#/entry/new?kind=sermon' };
    const unsaved = { draftId: 'fictional-draft', route: '#/entry/new?kind=sermon' };
    // Identical addresses, and still not the same journal record.
    expect(sameScanOwner(saved, unsaved)).toBe(false);
    expect(sameScanOwner(unsaved, saved)).toBe(false);
  });

  it('matches unsaved writing by its draft record when both have one', () => {
    const route = '#/entry/new?kind=sermon';
    expect(sameScanOwner({ draftId: 'fictional-a', route }, { draftId: 'fictional-a', route })).toBe(true);
    expect(sameScanOwner({ draftId: 'fictional-a', route }, { draftId: 'fictional-b', route })).toBe(false);
  });

  it('falls back to the address only while one side has written no draft yet', () => {
    /*
      The real case: somebody opens a new sermon note, types a sentence (which
      autosaves a draft), and scans. The lock unmounts the editor; it comes
      back with no draft id in hand, because that id lived in the subtree that
      went away. The address is what both sides still agree on, and the editor
      reopens the very draft named in the record.
    */
    const atScanTime = { draftId: 'fictional-draft', route: '#/entry/new?kind=sermon' };
    const afterUnlock = { route: '#/entry/new?kind=sermon' };
    expect(sameScanOwner(atScanTime, afterUnlock)).toBe(true);

    // A different screen is a different screen.
    expect(sameScanOwner(atScanTime, { route: '#/entry/new?kind=reading' })).toBe(false);
  });
});

describe('how long a page may wait', () => {
  it('is fresh up to the limit and stale after it', () => {
    const pending = waiting({ route: '#/entry/new' });
    expect(pendingScanIsFresh(pending, NOW)).toBe(true);
    expect(pendingScanIsFresh(pending, NOW + PENDING_SCAN_TTL_MS - 1)).toBe(true);
    expect(pendingScanIsFresh(pending, NOW + PENDING_SCAN_TTL_MS)).toBe(false);
    expect(pendingScanIsFresh(pending, NOW + PENDING_SCAN_TTL_MS * 10)).toBe(false);
  });

  it('treats a clock that went backwards as stale rather than as forever fresh', () => {
    // A timezone change or an NTP correction must not produce a photograph
    // that can never expire.
    expect(pendingScanIsFresh(waiting({ route: '#/x' }), NOW - 1)).toBe(false);
  });

  it('is not offered once it has gone stale, and is reported for deletion', () => {
    const owner = { route: '#/entry/new?kind=sermon' };
    rememberPendingScan(waiting(owner));

    expect(resumablePendingScan(owner, NOW + 1000)?.page.handle).toBe('fictional-handle');
    expect(expiredPendingScan(NOW + 1000)).toBeNull();

    const late = NOW + PENDING_SCAN_TTL_MS + 1;
    expect(resumablePendingScan(owner, late)).toBeNull();
    expect(expiredPendingScan(late)?.page.handle).toBe('fictional-handle');
  });
});

describe('the registry holds one page', () => {
  it('hands back what a new page displaced, so its file can be deleted', () => {
    const owner = { route: '#/entry/new' };
    expect(rememberPendingScan(waiting(owner))).toBeNull();

    const second = waiting(owner, { page: page('fictional-second') });
    const displaced = rememberPendingScan(second);
    // Never a queue: two pages waiting is how one ends up in the wrong entry.
    expect(displaced?.page.handle).toBe('fictional-handle');
    expect(peekPendingScan()?.page.handle).toBe('fictional-second');
  });

  it('forgets on request and says what it was holding', () => {
    rememberPendingScan(waiting({ route: '#/entry/new' }));
    expect(forgetPendingScan()?.page.handle).toBe('fictional-handle');
    expect(peekPendingScan()).toBeNull();
    expect(forgetPendingScan()).toBeNull();
  });

  it('holds no recognised text and no journal content', () => {
    const owner = { entryId: 'fictional-entry', route: '#/entry/fictional-entry' };
    rememberPendingScan(waiting(owner));
    const held = peekPendingScan()!;

    /*
      The shape is the privacy claim. Recognition does not run while the app is
      locked, so there is never a transcription of anybody's notes sitting
      behind the lock screen — and there is nowhere here to put one.
    */
    expect(Object.keys(held).sort()).toEqual(['acquiredAt', 'owner', 'page', 'source']);
    expect(Object.keys(held.owner).sort()).toEqual(['entryId', 'route']);
    const serialised = JSON.stringify(held);
    for (const forbidden of ['notes', 'reflection', 'prayer', 'title', 'text', 'recognition']) {
      expect(serialised.toLowerCase()).not.toContain(`"${forbidden}"`);
    }
  });
});
