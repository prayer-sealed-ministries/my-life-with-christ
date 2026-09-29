/**
 * App Lock as a capability, so no view has to know where it is running.
 *
 * The native implementation talks to the Android plugin; the web one reports
 * `supported: false` and offers nothing. That is not a stub waiting to be
 * filled in — it is the honest answer. A browser has no Keystore and no device
 * credential, so a web "App Lock" would be a verifier in ordinary storage
 * guarding a journal in ordinary storage, which is a gesture rather than a
 * protection. Settings hides the section entirely rather than showing a
 * promise this edition cannot keep.
 */

import { registerPlugin } from '@capacitor/core';

import type { Monotonic } from '../app/lock-policy';

export interface AppLockState {
  enabled: boolean;
  timeoutMs: number;
  failures: number;
  lastFailureAt: Monotonic | null;
  /** Whether the device has a screen lock, and so whether recovery exists. */
  recoveryAvailable: boolean;
  now: Monotonic;
}

export interface VerifyResult {
  ok: boolean;
  failures: number;
  lastFailureAt: Monotonic | null;
  now: Monotonic;
}

export interface AppLock {
  /** False on the web, where none of this can be done honestly. */
  readonly supported: boolean;

  getState(): Promise<AppLockState>;
  now(): Promise<Monotonic>;

  verifyPin(pin: string): Promise<VerifyResult>;

  /**
   * Set or replace the PIN.
   *
   * `currentPin` is required by the NATIVE side whenever a PIN already exists;
   * passing it is not this layer's choice to skip. The alternative proof is a
   * device-credential authentication performed moments earlier, which the
   * native side remembers briefly and consumes here.
   */
  setPin(pin: string, currentPin?: string): Promise<void>;

  disable(currentPin?: string): Promise<void>;
  setTimeout(timeoutMs: number): Promise<void>;

  /** The device's own screen lock, as the only recovery route. */
  authenticateDeviceCredential(): Promise<boolean>;

  /** Ask the system to keep the journal out of the app switcher. */
  setRecentsPrivacy(enabled: boolean): Promise<void>;
}

interface AppLockNativePlugin {
  getState(): Promise<{
    enabled: boolean;
    timeoutMs: number;
    failures: number;
    lastFailureElapsedMs: number;
    lastFailureBootId: string | null;
    recoveryAvailable: boolean;
    elapsedMs: number;
    bootId: string;
  }>;
  now(): Promise<{ elapsedMs: number; bootId: string }>;
  verifyPin(options: { pin: string }): Promise<{
    ok: boolean;
    failures?: number;
    lastFailureElapsedMs?: number;
    lastFailureBootId?: string | null;
    elapsedMs?: number;
    bootId?: string;
  }>;
  setPin(options: { pin: string; currentPin?: string }): Promise<{ ok: boolean }>;
  disable(options: { currentPin?: string }): Promise<{ ok: boolean }>;
  setTimeout(options: { timeoutMs: number }): Promise<void>;
  authenticateDeviceCredential(): Promise<{ ok: boolean }>;
  setRecentsPrivacy(options: { enabled: boolean }): Promise<void>;
}

export const AppLockNative = registerPlugin<AppLockNativePlugin>('AppLock');

const monotonic = (elapsedMs: number | undefined, bootId: string | undefined): Monotonic => ({
  elapsedMs: typeof elapsedMs === 'number' ? elapsedMs : 0,
  bootId: bootId ?? '',
});

/** A stored failure reading, or nothing if there has never been one. */
const failureAt = (elapsedMs: number | undefined, bootId: string | null | undefined) =>
  typeof elapsedMs === 'number' && elapsedMs >= 0 && bootId
    ? { elapsedMs, bootId }
    : null;

export const nativeAppLock: AppLock = {
  supported: true,

  async getState() {
    const state = await AppLockNative.getState();
    return {
      enabled: state.enabled === true,
      timeoutMs: typeof state.timeoutMs === 'number' ? state.timeoutMs : 0,
      failures: typeof state.failures === 'number' ? state.failures : 0,
      lastFailureAt: failureAt(state.lastFailureElapsedMs, state.lastFailureBootId),
      recoveryAvailable: state.recoveryAvailable === true,
      now: monotonic(state.elapsedMs, state.bootId),
    };
  },

  async now() {
    const reading = await AppLockNative.now();
    return monotonic(reading.elapsedMs, reading.bootId);
  },

  async verifyPin(pin) {
    const result = await AppLockNative.verifyPin({ pin });
    return {
      ok: result.ok === true,
      failures: typeof result.failures === 'number' ? result.failures : 0,
      lastFailureAt: failureAt(result.lastFailureElapsedMs, result.lastFailureBootId),
      now: monotonic(result.elapsedMs, result.bootId),
    };
  },

  async setPin(pin, currentPin) {
    await AppLockNative.setPin({ pin, currentPin });
  },

  async disable(currentPin) {
    await AppLockNative.disable({ currentPin });
  },

  async setTimeout(timeoutMs) {
    await AppLockNative.setTimeout({ timeoutMs });
  },

  async authenticateDeviceCredential() {
    const result = await AppLockNative.authenticateDeviceCredential();
    return result.ok === true;
  },

  async setRecentsPrivacy(enabled) {
    await AppLockNative.setRecentsPrivacy({ enabled });
  },
};

/**
 * The web answer: there is no App Lock here.
 *
 * `getState` reports disabled rather than throwing, so the gate has a cheap,
 * definite answer and the app starts exactly as it did before this feature
 * existed. Everything that would change state refuses, so no code path can
 * half-enable something the edition cannot enforce.
 */
export const webAppLock: AppLock = {
  supported: false,

  async getState() {
    return {
      enabled: false,
      timeoutMs: 0,
      failures: 0,
      lastFailureAt: null,
      recoveryAvailable: false,
      now: { elapsedMs: 0, bootId: 'web' },
    };
  },

  async now() {
    return { elapsedMs: 0, bootId: 'web' };
  },

  async verifyPin() {
    return { ok: false, failures: 0, lastFailureAt: null, now: { elapsedMs: 0, bootId: 'web' } };
  },

  async setPin() {
    throw new Error('App Lock is not available in this edition.');
  },

  async disable() {
    throw new Error('App Lock is not available in this edition.');
  },

  async setTimeout() {
    /* nothing to store */
  },

  async authenticateDeviceCredential() {
    return false;
  },

  async setRecentsPrivacy() {
    /* no app switcher to hide from */
  },
};
