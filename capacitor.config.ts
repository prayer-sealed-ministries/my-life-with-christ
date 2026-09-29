/**
 * Capacitor configuration.
 *
 * THE IMPORTANT PART IS WHAT IS ABSENT
 *
 * There is no `server` block, and there must never be one committed. A
 * `server.url` turns the installed application into a viewer pointed at a web
 * site, which would break the product's first promise — that the journal works
 * with no network, no server and no account — and would make the app depend on
 * a domain staying up. The shipped assets come from `webDir` below, built from
 * this repository.
 *
 * `scripts/__tests__/native-policy.test.mjs` enforces that, because a
 * `server.url` is exactly the sort of thing that gets added for an afternoon of
 * live-reload debugging and then committed by accident.
 *
 * The identifiers here are durable decisions. A bundle identifier cannot be
 * changed after release without shipping what the stores treat as a different
 * application — losing reviews, purchases and installs — so they are recorded
 * in docs/ADR-NATIVE-APP-ARCHITECTURE.md as well.
 */

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.myjourneywithchrist.lifewithchrist',
  appName: 'My Life With Christ',

  /**
   * The built web assets. `npm run native:assets` is the only supported way to
   * produce them: it builds with DATA_PROFILE=public and then runs the bundle
   * verifier over the result, so nothing unverified reaches a native project.
   * Running `vite build` directly skips that check.
   */
  webDir: 'dist',

  /**
   * The bridge does not narrate what crosses it.
   *
   * Capacitor's default ('debug') logs every plugin call's arguments to
   * logcat on debug builds. Measured on the emulator, that meant lines like
   *
   *   V Capacitor: ... methodName: setPin, methodData: {"pin":"135792"}
   *
   * and it is not only the PIN: the same logging carries whatever else crosses
   * the bridge, which for this app is archive bytes and sermon-note text. A
   * release build would not log it, but the phone in actual use is debug-signed
   * and USB-debuggable, so "it is fine in production" is not the situation to
   * design for.
   *
   * There is no per-plugin opt-out, and a PIN has no other way to reach native
   * code. So the logging goes. What is lost is Capacitor's own call tracing
   * during development; what is kept is a journal that does not narrate itself
   * to anything holding an adb cable.
   */
  loggingBehavior: 'none',

  ios: {
    // Anything the page cannot render gets the page's own background rather
    // than a white flash on a dark theme.
    backgroundColor: '#14161a',
    // Scroll belongs to the document, not to a native bounce over it.
    scrollEnabled: true,
  },

  android: {
    backgroundColor: '#14161a',
    // Web debugging stays off by default. Turning it on exposes the webview —
    // and therefore the journal — to anything that can reach the debug bridge.
    webContentsDebuggingEnabled: false,
  },
};

export default config;
