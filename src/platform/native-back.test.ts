/**
 * The Android back binding, as wiring rather than as a decision.
 *
 * `decideBack` is a pure function and is tested as one. That proves the rule and
 * nothing about whether anything obeys it: a binding that decided
 * `close-overlay` and then did nothing would pass every existing test while the
 * back gesture navigated the page underneath an open menu.
 *
 * This drives the real listener with a fake host and asserts what was performed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The listener the plugin was given, captured so tests can fire it. */
let backButtonHandler: (() => void) | null = null;

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (event: string, handler: () => void) => {
      if (event === 'backButton') backButtonHandler = handler;
      return { remove: vi.fn() };
    }),
    exitApp: vi.fn(),
  },
}));

// The binding is a no-op off Android, so the edition under test is Android.
vi.mock('./runtime', () => ({
  nativePlatform: () => 'android' as const,
  edition: () => 'native' as const,
  requiredStorageKind: () => 'sqlite' as const,
}));

const { bindAndroidBack } = await import('./native-back');

interface Performed {
  closeOverlay: number;
  goBack: number;
  exit: number;
  confirmDiscard: number;
}

function hostWith(state: { overlayOpen?: boolean; canGoBack?: boolean; hasUnsavedWork?: boolean }) {
  const performed: Performed = { closeOverlay: 0, goBack: 0, exit: 0, confirmDiscard: 0 };
  const host = {
    overlayOpen: () => state.overlayOpen ?? false,
    canGoBack: () => state.canGoBack ?? false,
    hasUnsavedWork: () => state.hasUnsavedWork ?? false,
    closeOverlay: () => {
      performed.closeOverlay += 1;
    },
    goBack: () => {
      performed.goBack += 1;
    },
    confirmDiscard: () => {
      performed.confirmDiscard += 1;
      return true;
    },
    exit: () => {
      performed.exit += 1;
    },
  };
  return { host, performed };
}

beforeEach(() => {
  backButtonHandler = null;
});

describe('the Android back binding performs what was decided', () => {
  it('attaches a back listener at all', async () => {
    const { host } = hostWith({});
    await bindAndroidBack(host);
    // A floor: every assertion below fires this handler, and a binding that
    // never attached would make them all pass vacuously.
    expect(backButtonHandler, 'no backButton listener was registered').toBeTruthy();
  });

  it('closes the menu, and navigates nowhere, when it is open', async () => {
    const { host, performed } = hostWith({ overlayOpen: true, canGoBack: true });
    await bindAndroidBack(host);
    backButtonHandler?.();

    expect(performed.closeOverlay, 'the open menu was not closed').toBe(1);
    expect(performed.goBack, 'back navigated while the menu was open').toBe(0);
    expect(performed.exit, 'back exited while the menu was open').toBe(0);
  });

  it('does not exit at the root while the menu is open', async () => {
    // The worst version of this bug: nothing to go back to, so the app closes
    // out from under a menu the person had just opened.
    const { host, performed } = hostWith({ overlayOpen: true, canGoBack: false });
    await bindAndroidBack(host);
    backButtonHandler?.();

    expect(performed.exit).toBe(0);
    expect(performed.closeOverlay).toBe(1);
  });

  it('navigates back normally once the menu is shut', async () => {
    const { host, performed } = hostWith({ overlayOpen: false, canGoBack: true });
    await bindAndroidBack(host);
    backButtonHandler?.();

    expect(performed.goBack).toBe(1);
    expect(performed.closeOverlay).toBe(0);
  });

  it('exits at the root when nothing is open and nothing is behind', async () => {
    const { host, performed } = hostWith({ overlayOpen: false, canGoBack: false });
    await bindAndroidBack(host);
    backButtonHandler?.();

    expect(performed.exit).toBe(1);
  });

  it('still asks before discarding unsaved work', async () => {
    const { host, performed } = hostWith({ overlayOpen: false, canGoBack: false, hasUnsavedWork: true });
    await bindAndroidBack(host);
    backButtonHandler?.();

    expect(performed.confirmDiscard).toBe(1);
  });
});
