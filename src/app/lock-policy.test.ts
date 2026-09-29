/**
 * The App Lock decisions, as predicates.
 *
 * These are the cases that are wretched to stage through a UI and exact here:
 * a resume landing exactly on the timeout boundary, a penalty that must outlive
 * a force-stop, and a reboot that sends the monotonic clock back to zero.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TIMEOUT_MS,
  MAX_PENALTY_MS,
  PIN_MAX_DIGITS,
  PIN_MIN_DIGITS,
  TIMEOUT_CHOICES_MS,
  normaliseTimeout,
  penaltyForFailures,
  penaltyMessage,
  pinProblemMessage,
  remainingPenaltyMs,
  shouldLockOnResume,
  timeoutLabel,
  validateNewPin,
} from './lock-policy';

const boot = (elapsedMs: number, bootId = 'boot-1') => ({ elapsedMs, bootId });

describe('what counts as a PIN', () => {
  it('accepts the allowed lengths', () => {
    expect(validateNewPin('1'.repeat(PIN_MIN_DIGITS))).toBeNull();
    expect(validateNewPin('1'.repeat(PIN_MAX_DIGITS))).toBeNull();
    expect(validateNewPin('135792', '135792')).toBeNull();
  });

  it('refuses blank, short, long, and non-numeric', () => {
    expect(validateNewPin('')).toBe('blank');
    expect(validateNewPin('1'.repeat(PIN_MIN_DIGITS - 1))).toBe('too-short');
    expect(validateNewPin('1'.repeat(PIN_MAX_DIGITS + 1))).toBe('too-long');
    expect(validateNewPin('12345a')).toBe('not-numeric');
    expect(validateNewPin('123 456')).toBe('not-numeric');
  });

  it('refuses a confirmation that does not match', () => {
    expect(validateNewPin('135792', '135793')).toBe('mismatch');
  });

  it('reports the length problem before the mismatch', () => {
    // Told "those do not match" for two identical four-digit entries, a person
    // would retype them and be refused again for a reason nobody named.
    expect(validateNewPin('1234', '1234')).toBe('too-short');
  });

  it('never repeats the digits back in a message', () => {
    const problems = ['blank', 'not-numeric', 'too-short', 'too-long', 'mismatch'] as const;
    for (const problem of problems) {
      const message = pinProblemMessage(problem);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/\d{4,}/);
    }
  });
});

describe('the background timeout', () => {
  it('defaults to locking immediately', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(0);
    expect(TIMEOUT_CHOICES_MS).toContain(DEFAULT_TIMEOUT_MS);
  });

  it('offers exactly the four documented choices, labelled', () => {
    expect([...TIMEOUT_CHOICES_MS]).toEqual([0, 60_000, 300_000, 900_000]);
    expect(TIMEOUT_CHOICES_MS.map(timeoutLabel)).toEqual([
      'Immediately',
      'After 1 minute',
      'After 5 minutes',
      'After 15 minutes',
    ]);
  });

  it('treats anything unrecognised as the safest option', () => {
    expect(normaliseTimeout(3_600_000)).toBe(DEFAULT_TIMEOUT_MS);
    expect(normaliseTimeout('5 minutes')).toBe(DEFAULT_TIMEOUT_MS);
    expect(normaliseTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS);
    expect(normaliseTimeout(null)).toBe(DEFAULT_TIMEOUT_MS);
    // Not "the largest we have seen", which is how a stored 15 minutes from a
    // previous install would quietly outlive the setting being removed.
    expect(normaliseTimeout(900_001)).toBe(0);
  });

  it('locks when there is no record of ever having been backgrounded', () => {
    // Cold launch and process death both look like this.
    expect(
      shouldLockOnResume({ backgroundedAt: null, now: boot(10_000), timeoutMs: 900_000 }),
    ).toBe(true);
  });

  it('locks on any backgrounding at all when the timeout is Immediately', () => {
    expect(
      shouldLockOnResume({ backgroundedAt: boot(5_000), now: boot(5_001), timeoutMs: 0 }),
    ).toBe(true);
  });

  it('stays unlocked inside the grace period, and locks on the boundary', () => {
    expect(
      shouldLockOnResume({ backgroundedAt: boot(1_000), now: boot(60_999), timeoutMs: 60_000 }),
    ).toBe(false);
    // Exactly the timeout is expired, not "nearly".
    expect(
      shouldLockOnResume({ backgroundedAt: boot(1_000), now: boot(61_000), timeoutMs: 60_000 }),
    ).toBe(true);
  });

  it('locks when the device rebooted while the app was away', () => {
    // elapsedRealtime restarts at zero, so the difference is meaningless and
    // would otherwise read as a huge negative — or, worse, a small positive.
    expect(
      shouldLockOnResume({
        backgroundedAt: boot(900_000, 'boot-1'),
        now: boot(30_000, 'boot-2'),
        timeoutMs: 900_000,
      }),
    ).toBe(true);
  });

  it('locks when the clock appears to run backwards', () => {
    expect(
      shouldLockOnResume({ backgroundedAt: boot(90_000), now: boot(89_000), timeoutMs: 900_000 }),
    ).toBe(true);
  });
});

describe('the penalty after failed attempts', () => {
  it('lets ordinary mistyping through unpunished', () => {
    expect(penaltyForFailures(0)).toBe(0);
    expect(penaltyForFailures(1)).toBe(0);
    expect(penaltyForFailures(4)).toBe(0);
  });

  it('increases, then stops increasing', () => {
    expect(penaltyForFailures(5)).toBe(5_000);
    expect(penaltyForFailures(6)).toBe(15_000);
    expect(penaltyForFailures(7)).toBe(30_000);
    expect(penaltyForFailures(8)).toBe(MAX_PENALTY_MS);
  });

  it('is bounded, however many times someone guesses', () => {
    for (const failures of [9, 20, 100, 10_000]) {
      expect(penaltyForFailures(failures)).toBe(MAX_PENALTY_MS);
      expect(penaltyForFailures(failures)).toBeLessThanOrEqual(MAX_PENALTY_MS);
    }
    // An hour-long lockout punishes the owner far more reliably than anyone
    // else, so the ceiling is deliberately a minute.
    expect(MAX_PENALTY_MS).toBeLessThanOrEqual(60_000);
  });

  it('derives the wait from the stored count, so a relaunch cannot shed it', () => {
    // The force-stop case: the process is gone, so nothing in memory survives.
    // What comes back is the count, and the penalty follows from it.
    const afterRelaunch = remainingPenaltyMs({
      failures: 8,
      lastFailureAt: null,
      now: boot(1_000),
    });
    expect(afterRelaunch).toBe(MAX_PENALTY_MS);
  });

  it('counts down while the app stays up', () => {
    expect(
      remainingPenaltyMs({ failures: 5, lastFailureAt: boot(10_000), now: boot(12_000) }),
    ).toBe(3_000);
    expect(
      remainingPenaltyMs({ failures: 5, lastFailureAt: boot(10_000), now: boot(15_000) }),
    ).toBe(0);
  });

  it('restarts rather than expires when the device reboots', () => {
    // Power-cycling must not be a reset button.
    expect(
      remainingPenaltyMs({
        failures: 8,
        lastFailureAt: boot(500_000, 'boot-1'),
        now: boot(2_000, 'boot-2'),
      }),
    ).toBe(MAX_PENALTY_MS);
  });

  it('does not announce a countdown that ticks every second', () => {
    expect(penaltyMessage(800)).toBe('Too many attempts. Try again in a moment.');
    expect(penaltyMessage(5_000)).toBe('Too many attempts. Try again in 5 seconds.');
  });
});
