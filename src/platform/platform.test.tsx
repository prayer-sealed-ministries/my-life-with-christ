/**
 * The platform boundary, tested from the product surface.
 *
 * A perfectly tested `FileSaver` that no screen calls is not progress, so the
 * assertions that matter here render the real view, hand it a fake platform
 * through the real provider, and check that pressing the real button reaches
 * the port. That is the wiring; the adapters are tested separately below.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';
import { examinedAtLeast } from '../testing/floor';
import DataView from '../views/DataView';
import LegacyView from '../views/LegacyView';
import { decideBack } from './back';
import {
  CANNOT_DECOMPRESS,
  canCompress,
  canDecompress,
  hasNativeDecompression,
  requireDecompression,
} from './compression';
import { PlatformProvider } from './provider';
import { webAppLock } from './app-lock';
import type { OutgoingFile, Platform } from './ports';
import { StorageUnavailableError, selectStorageProvider } from './storage';
import { webFileSaver, webPrinter, webUnsavedWorkGuard } from './web';
import { loadSections } from '../app/sections';

/*
 * The divisions, through the loader the application itself uses.
 *
 * DataView genuinely needs them — the archive carries division ids and an
 * import resolves them — so it suspends until they are here. Awaiting the real
 * loader once, at module scope, is what lets these tests render it directly,
 * and it keeps the data they assert against the data the product serves.
 */
await loadSections();


let counter = 0;

/**
 * A platform that records rather than acts.
 *
 * `printed` is a getter over a closed-over counter, not a copied number. A
 * first version spread a `{ printed: 0 }` object into the result and then
 * incremented the original — so the counter the test read never moved, and the
 * test failed against perfectly correct wiring. `saved` survived that mistake
 * only because an array is a shared reference.
 */
function fakePlatform(): Platform & { saved: OutgoingFile[]; printed: number } {
  const saved: OutgoingFile[] = [];
  let printed = 0;

  return {
    saved,
    get printed() {
      return printed;
    },
    // Unsupported, which is what a platform with no App Lock reports. The
    // gate must start the app unchanged when this is the answer.
    scanner: { supported: false, capture: async () => ({ reason: 'unsupported' } as const), choose: async () => ({ reason: 'unsupported' } as const), recognise: async () => ({ reason: 'unsupported' } as const), recognisePrepared: async () => ({ reason: 'unsupported' } as const), discard: async () => {} },
    appLock: webAppLock,
    files: {
      save: async (file) => {
        saved.push(file);
        return { status: 'committed' };
      },
    },
    picker: { pick: async () => null },
    // These tests are about the other ports; a stub that claimed to share
    // would be claiming it for a host that has no share sheet.
    sharer: { canShare: false, share: async () => ({ shared: false }) },
    printer: {
      print: () => {
        printed += 1;
      },
    },
    unsavedWork: { protect: () => () => {} },
  };
}

function renderWith(ui: React.ReactElement, platform: Platform) {
  const storage = new DexieStorageProvider(`platform-test-${(counter += 1)}`);
  return {
    storage,
    ...render(
      <PlatformProvider platform={platform}>
        <StorageContextProvider provider={storage}>
          <RouterProvider>{ui}</RouterProvider>
        </StorageContextProvider>
      </PlatformProvider>,
    ),
  };
}

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('export reaches the file port, not the DOM', () => {
  it('hands the archive to the platform when Export everything is pressed', async () => {
    const platform = fakePlatform();
    const { storage } = renderWith(<DataView />, platform);
    await storage.open();
    await storage.createEntry({ title: 'A note', notes: 'Something written.' });

    const button = await screen.findByRole('button', { name: /^Export everything$/ });
    fireEvent.click(button);

    await waitFor(() => expect(platform.saved).toHaveLength(1));

    const [file] = platform.saved;
    // The archive itself is unchanged: same name shape, same media type, and
    // real zip bytes rather than a placeholder.
    expect(file.suggestedName).toMatch(/^journey-export-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(file.mimeType).toBe('application/zip');
    examinedAtLeast(file.bytes.byteLength, 5_000, 'bytes handed to the platform');
    // "PK", the zip magic. Proof these are the built archive, not a stub.
    expect([file.bytes[0], file.bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it('does not download through the DOM when a platform is supplied', async () => {
    // The old path created an anchor and clicked it. If any of that survives,
    // a native edition would download into the webview instead of the Files app.
    const clicks = vi.fn();
    const created = vi.spyOn(document, 'createElement');

    const platform = fakePlatform();
    const { storage } = renderWith(<DataView />, platform);
    await storage.open();
    await storage.createEntry({ title: 'A note' });

    fireEvent.click(await screen.findByRole('button', { name: /^Export everything$/ }));
    await waitFor(() => expect(platform.saved).toHaveLength(1));

    // Narrowed to DOWNLOAD anchors: the view legitimately creates ordinary
    // <Link> anchors for navigation, and an assertion against every <a> would
    // fail on those while proving nothing about downloads.
    const downloadAnchors = created.mock.results
      .map((result) => result.value as HTMLElement)
      .filter((element) => element?.tagName === 'A' && element.hasAttribute('download'));
    expect(downloadAnchors, 'the view still creates a download anchor').toHaveLength(0);
    expect(clicks).not.toHaveBeenCalled();
  });
});

describe('printing reaches the printer port', () => {
  it('asks the platform to print rather than calling window.print', async () => {
    const platform = fakePlatform();
    const printSpy = vi.fn();
    vi.stubGlobal('print', printSpy);

    // Seeded BEFORE rendering: the view reads the journal on mount, and an
    // empty one renders "nothing to print yet" with no button at all.
    const storage = new DexieStorageProvider(`platform-test-${(counter += 1)}`);
    await storage.open();
    await storage.createEntry({ title: 'For the book', notes: 'Something to print.' });

    render(
      <PlatformProvider platform={platform}>
        <StorageContextProvider provider={storage}>
          <RouterProvider>
            <LegacyView />
          </RouterProvider>
        </StorageContextProvider>
      </PlatformProvider>,
    );

    const button = await screen.findByRole('button', { name: /print/i });
    fireEvent.click(button);

    expect(platform.printed).toBe(1);
    expect(printSpy, 'the view called window.print directly').not.toHaveBeenCalled();
  });
});

describe('the web adapters still behave as they always did', () => {
  it('saves by creating a download anchor and clicking it', async () => {
    const clicked: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const element = realCreate(tag);
      if (tag === 'a') {
        element.addEventListener('click', (event) => {
          event.preventDefault();
          clicked.push((element as HTMLAnchorElement).download);
        });
      }
      return element;
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });

    await webFileSaver.save({
      suggestedName: 'my-archive.zip',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/zip',
    });

    expect(clicked).toEqual(['my-archive.zip']);
  });

  it('prints through window.print', () => {
    const printSpy = vi.fn();
    vi.stubGlobal('print', printSpy);
    webPrinter.print();
    expect(printSpy).toHaveBeenCalledTimes(1);
  });

  it('registers and removes a beforeunload handler', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    const stop = webUnsavedWorkGuard.protect(() => true);
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    stop();
    expect(remove).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });

  it('does not block the unload when there is nothing unsaved', () => {
    const stop = webUnsavedWorkGuard.protect(() => false);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    stop();
  });

  it('blocks the unload when there is', () => {
    const stop = webUnsavedWorkGuard.protect(() => true);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    stop();
  });
});

describe('storage selection fails closed', () => {
  it('returns Dexie for the web edition', () => {
    const selection = selectStorageProvider();
    expect(selection.kind).toBe('indexeddb');
    expect(selection.provider.constructor.name).toBe('DexieStorageProvider');
  });

  it('returns SQLite — not Dexie — when the native store is required', () => {
    // Phase 2 registered SQLite. The wiring matters as much as the refusal: a
    // native edition that asked for `sqlite` and received Dexie would be the
    // exact failure the rest of this block exists to prevent.
    const selection = selectStorageProvider('sqlite');
    expect(selection.kind).toBe('sqlite');
    expect(selection.provider.constructor.name).toBe('SqliteStorageProvider');
  });

  it('refuses to substitute when the required store has no implementation', () => {
    // The rule this encodes: a native build that cannot obtain SQLite must NOT
    // silently write a paid user's journal into webview IndexedDB. It throws.
    //
    // Stated against a factory set that has no `sqlite` rather than against the
    // real one. Until Phase 2 those were the same thing, and the test happened
    // to pass because SQLite did not exist yet — which tested the absence of an
    // implementation, not the refusal to substitute. Dexie is offered here
    // precisely so a substitution would succeed if the rule were broken.
    expect(() => selectStorageProvider('sqlite', { indexeddb: () => new DexieStorageProvider() }))
      .toThrow(StorageUnavailableError);
  });

  it('never hands back a kind other than the one asked for', () => {
    let selection;
    try {
      selection = selectStorageProvider('sqlite', { indexeddb: () => new DexieStorageProvider() });
    } catch {
      selection = undefined;
    }
    expect(selection, 'a fallback provider was substituted').toBeUndefined();
  });

  it('surfaces a construction failure as unavailability, not as a fallback', () => {
    expect(() =>
      selectStorageProvider('sqlite', {
        sqlite: () => {
          throw new Error('plugin missing');
        },
      }),
    ).toThrow(/could not be opened/i);
  });

  it('says nothing was written, because nothing was', () => {
    try {
      selectStorageProvider('sqlite', { indexeddb: () => new DexieStorageProvider() });
      expect.unreachable('selection should have thrown');
    } catch (cause) {
      expect((cause as Error).message).toMatch(/Nothing has been written/);
      expect((cause as Error).message).toMatch(/archives are unaffected/);
    }
  });
});

describe('back, when the menu is on top', () => {
  // The rule: an open menu is the thing the person is looking at, so back puts
  // it away. Without this the gesture navigates the page underneath — or, at
  // the root of the app, closes the application while the menu sits over it.
  it('closes the overlay before anything else', () => {
    expect(decideBack({ overlayOpen: true, canGoBack: true, hasUnsavedWork: false })).toBe(
      'close-overlay',
    );
    expect(decideBack({ overlayOpen: true, canGoBack: false, hasUnsavedWork: false })).toBe(
      'close-overlay',
    );
  });

  it('outranks even unsaved work, because dismissing a menu loses nothing', () => {
    // The menu holds no state of its own; closing it cannot discard an entry.
    // Asking "are you sure?" for a menu would train people to dismiss the
    // prompt that DOES matter.
    expect(decideBack({ overlayOpen: true, canGoBack: false, hasUnsavedWork: true })).toBe(
      'close-overlay',
    );
  });

  it('goes back to the ordinary rules once the menu is shut', () => {
    expect(decideBack({ overlayOpen: false, canGoBack: true, hasUnsavedWork: false })).toBe(
      'navigate-back',
    );
    expect(decideBack({ overlayOpen: false, canGoBack: false, hasUnsavedWork: false })).toBe('exit');
    expect(decideBack({ overlayOpen: false, canGoBack: false, hasUnsavedWork: true })).toBe(
      'confirm-discard',
    );
  });
});

describe('compression capability', () => {
  it('reports what this runtime can do', () => {
    // Both present in the test environment; the point is that the answer comes
    // from one place rather than from a `typeof` in two files.
    expect(canDecompress()).toBe(true);
    expect(canCompress()).toBe(true);
  });

  it('can still read an archive where the platform has no inflate', () => {
    // This asserted the opposite until Phase 3, and the change is deliberate.
    //
    // The supported range declares iOS 15.0 and minSdk 24, and part of it has
    // no `DecompressionStream` — so the old behaviour meant a person could
    // export a journal for years on such a device and then be unable to restore
    // it. A bundled inflate is carried for exactly that reason, so the answer
    // is now yes everywhere. `compression.test.ts` exercises both paths against
    // real archives; this only pins the capability.
    vi.stubGlobal('DecompressionStream', undefined);
    expect(hasNativeDecompression()).toBe(false);
    expect(canDecompress(), 'a runtime with no platform inflate must still read archives').toBe(
      true,
    );
    expect(() => requireDecompression()).not.toThrow();
  });

  it('says "device", never "browser" — this string is reachable inside an app', () => {
    expect(CANNOT_DECOMPRESS).toMatch(/device/i);
    expect(CANNOT_DECOMPRESS).not.toMatch(/browser|tab|webpage|website/i);
  });
});

describe('back navigation decision', () => {
  it('goes back when there is somewhere to go', () => {
    expect(decideBack({ overlayOpen: false, canGoBack: true, hasUnsavedWork: false })).toBe('navigate-back');
  });

  it('exits only when there is nothing left', () => {
    expect(decideBack({ overlayOpen: false, canGoBack: false, hasUnsavedWork: false })).toBe('exit');
  });

  it('asks before discarding unsaved work, even at the root', () => {
    // The ordering that matters: a gesture made fifty times a day must not be
    // able to throw away a half-written entry.
    expect(decideBack({ overlayOpen: false, canGoBack: false, hasUnsavedWork: true })).toBe('confirm-discard');
    expect(decideBack({ overlayOpen: false, canGoBack: true, hasUnsavedWork: true })).toBe('confirm-discard');
  });
});
