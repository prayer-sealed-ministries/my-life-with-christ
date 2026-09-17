/**
 * Android's system back, bound to the Phase 0 decision.
 *
 * Android has a hardware/gesture back that the web does not. Left unbound,
 * Capacitor's default closes the application on every press — so a person three
 * levels into the Bible would be thrown out of the app by the gesture they make
 * fifty times a day.
 *
 * The decision itself is `decideBack` in `back.ts`, which is pure and tested
 * without an emulator. This file is only the binding: it reads the state, asks,
 * and performs. The router and every view stay unaware that Android exists.
 *
 * iOS has no equivalent system event and gets nothing here. Its back gesture is
 * the webview's own, which the hash router already answers.
 */

import { App } from '@capacitor/app';

import { decideBack, type BackContext } from './back';
import { nativePlatform } from './runtime';

/**
 * How the binding learns what it needs to decide.
 *
 * Supplied by the caller rather than read from globals here, so the wiring can
 * be tested by handing it a fake.
 */
export interface BackBindingHost {
  /** Is there an in-app destination behind this one? */
  canGoBack: () => boolean;
  /** Is there edited-but-unsaved work on screen? */
  hasUnsavedWork: () => boolean;
  /** Go back one step in application history. */
  goBack: () => void;
  /** Ask before discarding. Returns true when the reader chose to leave. */
  confirmDiscard: () => boolean;
  /** Close the application. */
  exit: () => void;
}

/**
 * Attach the listener. Returns a function that detaches it.
 *
 * A no-op off Android, including on iOS and on the web, so callers do not need
 * to know where they are.
 */
export async function bindAndroidBack(host: BackBindingHost): Promise<() => void> {
  if (nativePlatform() !== 'android') return () => {};

  const handle = await App.addListener('backButton', () => {
    const context: BackContext = {
      canGoBack: host.canGoBack(),
      hasUnsavedWork: host.hasUnsavedWork(),
    };

    switch (decideBack(context)) {
      case 'navigate-back':
        host.goBack();
        return;

      case 'confirm-discard':
        // Unsaved work outranks everything, including exit. Only if the reader
        // says so does the press do what it would otherwise have done.
        if (!host.confirmDiscard()) return;
        if (context.canGoBack) host.goBack();
        else host.exit();
        return;

      case 'exit':
        host.exit();
    }
  });

  return () => void handle.remove();
}

/** The default host: the browser history the hash router already uses. */
export function browserHistoryHost(overrides: Partial<BackBindingHost> = {}): BackBindingHost {
  return {
    // `history.length > 1` is the honest answer available to a hash router:
    // it cannot distinguish our entries from any the webview created before us,
    // but on a native shell the app IS the whole session, so they are the same.
    canGoBack: () => window.history.length > 1,
    hasUnsavedWork: () => false,
    goBack: () => window.history.back(),
    confirmDiscard: () => true,
    exit: () => void App.exitApp(),
    ...overrides,
  };
}
