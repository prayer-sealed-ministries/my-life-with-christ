/**
 * App Lock, as a set of decisions rather than a screen.
 *
 * Everything here is pure: no storage, no clock, no React, no Android. The
 * same reasoning that `src/lib/focus-restore.ts` exists for applies — the
 * interesting cases (a resume exactly on the timeout boundary, a penalty that
 * must survive a force-stop, a reboot that resets the monotonic clock) are
 * miserable to stage through a UI and exact as predicates.
 *
 * WHAT APP LOCK IS
 *
 * Access control for this application's own screens. It is NOT encryption: the
 * journal database is exactly as readable as it was before, to anything that
 * can read the app's private storage. Wording anywhere near this feature has to
 * keep that straight, and `src/platform/wording.test.ts` holds the line.
 */

/** A PIN is numeric and this long. Short enough to type one-handed in a pew. */
export const PIN_MIN_DIGITS = 6;
export const PIN_MAX_DIGITS = 12;

export type PinProblem =
  | 'blank'
  | 'too-short'
  | 'too-long'
  | 'not-numeric'
  | 'mismatch';

/**
 * Is this an acceptable new PIN?
 *
 * `confirm` is checked only once the PIN itself is valid, so a person mistyping
 * a four-digit PIN twice is told the length is wrong rather than that their two
 * identical entries do not match.
 */
export function validateNewPin(pin: string, confirm?: string): PinProblem | null {
  if (pin.length === 0) return 'blank';
  if (!/^\d+$/.test(pin)) return 'not-numeric';
  if (pin.length < PIN_MIN_DIGITS) return 'too-short';
  if (pin.length > PIN_MAX_DIGITS) return 'too-long';
  if (confirm !== undefined && pin !== confirm) return 'mismatch';
  return null;
}

/** What to say about a rejected PIN. Never repeats the digits back. */
export function pinProblemMessage(problem: PinProblem): string {
  switch (problem) {
    case 'blank':
      return 'Enter a PIN.';
    case 'not-numeric':
      return 'A PIN can only contain digits.';
    case 'too-short':
      return `A PIN must be at least ${PIN_MIN_DIGITS} digits.`;
    case 'too-long':
      return `A PIN can be at most ${PIN_MAX_DIGITS} digits.`;
    case 'mismatch':
      return 'Those two PINs are not the same.';
  }
}

/** How long the app may sit in the background before it locks again. */
export const TIMEOUT_CHOICES_MS = [0, 60_000, 300_000, 900_000] as const;

export type TimeoutMs = (typeof TIMEOUT_CHOICES_MS)[number];

/**
 * Immediately, when App Lock is first turned on.
 *
 * Somebody switching this on has asked for privacy, not for convenience. They
 * can choose a grace period afterwards; the default should not decide that for
 * them.
 */
export const DEFAULT_TIMEOUT_MS: TimeoutMs = 0;

export function timeoutLabel(ms: number): string {
  switch (ms) {
    case 0:
      return 'Immediately';
    case 60_000:
      return 'After 1 minute';
    case 300_000:
      return 'After 5 minutes';
    case 900_000:
      return 'After 15 minutes';
    default:
      return 'Immediately';
  }
}

/** Anything unrecognised means the safest option, not the last one stored. */
export function normaliseTimeout(ms: unknown): TimeoutMs {
  return (TIMEOUT_CHOICES_MS as readonly number[]).includes(ms as number)
    ? (ms as TimeoutMs)
    : DEFAULT_TIMEOUT_MS;
}

/**
 * A reading of the device's monotonic clock.
 *
 * `bootId` changes when the device restarts, at which point elapsed-time
 * readings from before the restart mean nothing — `elapsedRealtime` counts from
 * boot. Carrying the boot identity alongside the number is what lets a stored
 * deadline be recognised as stale rather than silently compared against a fresh
 * clock that has just gone backwards.
 */
export interface Monotonic {
  elapsedMs: number;
  bootId: string;
}

/**
 * Should the app lock, given when it went to the background and when it came
 * back?
 *
 * Fails closed in every uncertain case, because the alternative to a spurious
 * lock is an unlocked journal:
 *
 * - No record of going to the background at all → lock. This is the cold-launch
 *   path and the process-death path; neither ever had one.
 * - The device rebooted in between → lock. The two readings are from different
 *   clocks and their difference is meaningless.
 * - The clock appears to have gone backwards → lock.
 *
 * A zero timeout means "Immediately", so any backgrounding at all locks.
 */
export function shouldLockOnResume(options: {
  backgroundedAt: Monotonic | null;
  now: Monotonic;
  timeoutMs: number;
}): boolean {
  const { backgroundedAt, now, timeoutMs } = options;
  if (!backgroundedAt) return true;
  if (backgroundedAt.bootId !== now.bootId) return true;

  const away = now.elapsedMs - backgroundedAt.elapsedMs;
  if (away < 0) return true;

  return away >= timeoutMs;
}

/**
 * How long to refuse another attempt, after this many consecutive failures.
 *
 * Derived from the COUNT rather than from a stored deadline, so that force-stop
 * and relaunch cannot shake off an active penalty: the count is persisted, and
 * the delay follows from it. The first few attempts are free because mistyping
 * a PIN is ordinary, and the ceiling is a minute because this protects a
 * journal from a curious housemate, not a vault from an adversary. An
 * hour-long lockout would punish the owner far more reliably than anybody else.
 */
export const MAX_PENALTY_MS = 60_000;

const SCHEDULE_MS = [0, 0, 0, 0, 5_000, 15_000, 30_000];

export function penaltyForFailures(failures: number): number {
  if (failures <= 0) return 0;
  if (failures > SCHEDULE_MS.length) return MAX_PENALTY_MS;
  return SCHEDULE_MS[failures - 1] ?? MAX_PENALTY_MS;
}

/**
 * How much of a penalty is still outstanding.
 *
 * A reboot makes the stored reading incomparable, and the conservative answer
 * is the full remaining penalty rather than none: restarting the wait can only
 * delay a legitimate owner briefly, while treating it as expired would hand
 * anyone a reset by power-cycling the phone.
 */
export function remainingPenaltyMs(options: {
  failures: number;
  lastFailureAt: Monotonic | null;
  now: Monotonic;
}): number {
  const penalty = penaltyForFailures(options.failures);
  if (penalty === 0) return 0;
  if (!options.lastFailureAt) return penalty;
  if (options.lastFailureAt.bootId !== options.now.bootId) return penalty;

  const since = options.now.elapsedMs - options.lastFailureAt.elapsedMs;
  if (since < 0) return penalty;
  return Math.max(0, penalty - since);
}

/** Whole seconds, for a message that does not tick once a second. */
export function penaltyMessage(remainingMs: number): string {
  const seconds = Math.ceil(remainingMs / 1000);
  return seconds <= 1
    ? 'Too many attempts. Try again in a moment.'
    : `Too many attempts. Try again in ${seconds} seconds.`;
}
