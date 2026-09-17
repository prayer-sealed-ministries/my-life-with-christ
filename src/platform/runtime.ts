/**
 * The one place that knows what this build is running on.
 *
 * Phase 0 deliberately kept `isIOS` / `isAndroid` out of the application, and
 * that stands. This module exists because exactly one decision genuinely needs
 * the answer — which storage kind to require — and a handful of native bindings
 * need to know whether to attach at all.
 *
 * Ordinary views must not import this. They ask for a capability through
 * `src/platform/context.ts` and receive one; they never ask where they are.
 * `scripts/__tests__/native-policy.test.mjs` enforces that boundary, because the
 * cost of getting it wrong is not a lint violation — it is journal behaviour
 * quietly forking three ways.
 *
 * Capacitor is imported statically rather than probed through globals. On the
 * web build it tree-shakes to a constant `false`, and `getPlatform()` answers
 * `'web'`; there is no runtime sniffing and nothing to spoof.
 */

import { Capacitor } from '@capacitor/core';

import type { StorageKind } from './storage';

/**
 * Which edition this is.
 *
 * `native` covers both iOS and Android on purpose: almost nothing in this
 * application should care which, and a type that offered the distinction freely
 * would invite code that used it.
 */
export type Edition = 'web' | 'native';

/** The specific platform. For native bindings only — never for product logic. */
export type NativePlatform = 'ios' | 'android';

export function edition(): Edition {
  return Capacitor.isNativePlatform() ? 'native' : 'web';
}

// Deliberately NOT exported. A generic `isNative()` available to the whole
// application is the convenient shape that ends with journal behaviour forking
// three ways. The exported answers below are purpose-specific: each names the
// decision it exists to make, so a caller cannot pick it up "just to check".
const isNative = (): boolean => edition() === 'native';

/**
 * Which platform, when a native binding truly needs it.
 *
 * Returns null on the web. Used by native-only integrations — the Android back
 * button has no iOS equivalent, for instance — and by nothing else.
 */
export function nativePlatform(): NativePlatform | null {
  if (!isNative()) return null;
  const platform = Capacitor.getPlatform();
  return platform === 'ios' || platform === 'android' ? platform : null;
}

/**
 * The storage this edition requires.
 *
 * This is the whole reason the module exists, and the mapping is deliberately
 * not negotiable at the call site:
 *
 *   web    -> indexeddb   (Dexie, as it has always been)
 *   native -> sqlite      (Phase 2; absent today, which is the point)
 *
 * In Phase 1 there is no SQLite provider registered, so a native build asks for
 * one, cannot have one, and `selectStorageProvider` throws. That is the correct
 * and intended outcome: a native shell that showed a working journal backed by
 * webview IndexedDB would be a demonstration of something we are not building.
 */
export function requiredStorageKind(): StorageKind {
  return isNative() ? 'sqlite' : 'indexeddb';
}
