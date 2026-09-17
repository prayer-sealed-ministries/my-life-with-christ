/**
 * Just enough assertion to state the persistence contract without a test runner.
 *
 * The contract has to run in two places: Vitest on a laptop against Dexie, and
 * inside a real iOS or Android application against SQLite, where there is no
 * Vitest and no Node. Importing `expect` would have tied the only description of
 * the contract to one of those two places, and the usual outcome of that is a
 * second, hand-written set of assertions for the other — which then drifts.
 *
 * So the assertions are these functions, and both runners use them unchanged.
 *
 * `deepEqual` deliberately ignores keys whose value is `undefined`, matching
 * Vitest's `toEqual`. That is not cosmetic: Dexie stores an entry by structured
 * clone and keeps `prayer: undefined` as a present key, while SQLite stores JSON
 * and `JSON.stringify` drops it. Both are correct — the field is absent either
 * way — and an equality that disagreed would fail one provider for a difference
 * the product does not have.
 */

export class ContractAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractAssertionError';
  }
}

const fail = (message: string): never => {
  throw new ContractAssertionError(message);
};

const show = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** Structural equality, ignoring keys explicitly set to undefined. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = (value: Record<string, unknown>) =>
    Object.keys(value).filter((key) => value[key] !== undefined);

  const leftKeys = keys(left);
  const rightKeys = keys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every(
    (key) => rightKeys.includes(key) && deepEqual(left[key], right[key]),
  );
}

export const assert = {
  /** Strict equality, for primitives. */
  is(actual: unknown, expected: unknown, what: string): void {
    if (!Object.is(actual, expected)) {
      fail(`${what}: expected ${show(expected)}, got ${show(actual)}`);
    }
  },

  equal(actual: unknown, expected: unknown, what: string): void {
    if (!deepEqual(actual, expected)) {
      fail(`${what}:\n  expected ${show(expected)}\n  got      ${show(actual)}`);
    }
  },

  notEqual(actual: unknown, expected: unknown, what: string): void {
    if (deepEqual(actual, expected)) fail(`${what}: expected not to equal ${show(expected)}`);
  },

  true(value: boolean, what: string): void {
    if (value !== true) fail(`${what}: expected true`);
  },

  undefined(value: unknown, what: string): void {
    if (value !== undefined) fail(`${what}: expected undefined, got ${show(value)}`);
  },

  length(value: { length: number }, expected: number, what: string): void {
    if (value.length !== expected) {
      fail(`${what}: expected length ${expected}, got ${value.length}`);
    }
  },

  matches(value: string, pattern: RegExp, what: string): void {
    if (!pattern.test(value)) fail(`${what}: ${show(value)} does not match ${pattern}`);
  },

  contains(haystack: string, needle: string, what: string): void {
    if (!haystack.includes(needle)) fail(`${what}: ${show(haystack)} does not contain ${needle}`);
  },

  omits(haystack: string, needle: string, what: string): void {
    if (haystack.includes(needle)) fail(`${what}: ${show(haystack)} unexpectedly contains ${needle}`);
  },

  /**
   * A floor on what was examined.
   *
   * Mirrors `examinedAtLeast` from the testing helpers: a check that passes
   * while looking at nothing is the failure this repository is built around
   * avoiding, and the contract runs in a harness where that is easy to do.
   */
  atLeast(actual: number, minimum: number, what: string): void {
    if (actual < minimum) fail(`${what}: expected at least ${minimum}, examined ${actual}`);
  },

  /** The promise must reject. Returns the error, for further inspection. */
  async rejects(work: () => Promise<unknown>, what: string): Promise<unknown> {
    try {
      await work();
    } catch (error) {
      return error;
    }
    return fail(`${what}: expected a rejection, but it resolved`);
  },

  /** The promise must resolve, and to undefined. */
  async resolvesUndefined(work: () => Promise<unknown>, what: string): Promise<void> {
    const value = await work();
    if (value !== undefined) fail(`${what}: expected undefined, got ${show(value)}`);
  },
};

/**
 * Narrowing assertion, standalone rather than a method on `assert`.
 *
 * TypeScript only honours an `asserts` signature when the call target is a
 * plain identifier or an explicitly typed reference, so this cannot be an
 * object method without losing the narrowing that makes it worth having.
 */
export function assertDefined<T>(
  value: T | undefined | null,
  what: string,
): asserts value is T {
  if (value === undefined || value === null) {
    throw new ContractAssertionError(`${what}: expected a value, got ${show(value)}`);
  }
}
