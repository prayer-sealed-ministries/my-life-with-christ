/**
 * Floors: the guard against a check that passes because it examined nothing.
 *
 * The oklch contrast bug is why this exists. A regex silently matched zero
 * colours, every loop over "all the violations" ran zero times, and the suite
 * reported a clean pass while measuring nothing at all. It was found only by
 * asserting how many samples had been taken.
 *
 * That failure mode is structural, not incidental: nearly every check in this
 * repo is shaped as "collect problems, assert the list is empty". Every one of
 * them passes trivially when the collection step yields nothing — a build that
 * produced no files, a page that rendered no content, a fixture that loaded no
 * entries.
 *
 * So a check is not finished until it also asserts what it looked at.
 */

import { expect } from 'vitest';

/**
 * Assert a check actually examined something.
 *
 * @param count how many items were inspected
 * @param minimum the fewest that still means the check ran
 * @param what what was being counted, for the failure message
 */
export function examinedAtLeast(count: number, minimum: number, what: string): void {
  expect(
    count,
    `NULL MEASUREMENT: examined ${count} ${what}, expected at least ${minimum}. ` +
      `This check would have passed without looking at anything.`,
  ).toBeGreaterThanOrEqual(minimum);
}

/**
 * Assert a known-present value really is present.
 *
 * A count can be satisfied by the wrong things. Where there is something that
 * must be found for the check to be meaningful, look for it by name.
 */
export function sentinelFound(found: boolean, sentinel: string, where: string): void {
  expect(
    found,
    `NULL MEASUREMENT: sentinel ${JSON.stringify(sentinel)} was not found in ${where}. ` +
      `The check was not looking at what it thinks it was looking at.`,
  ).toBe(true);
}
