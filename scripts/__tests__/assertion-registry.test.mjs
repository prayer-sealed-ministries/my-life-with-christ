import { describe, expect, it } from 'vitest';

import { createAssertionRegistry } from '../lib/assertion-registry.mjs';

/**
 * The mechanism that makes a false PASS impossible to print.
 *
 * `verify-bundle.mjs` printed five fixed summary lines whatever happened, and
 * one of them — "no .map files that could carry the original modules" — stood
 * for a check that only ran under `refs-only`. These tests are about the shape
 * that replaced it, not about the wording of any particular line.
 */
describe('createAssertionRegistry', () => {
  const REQUIRED = ['A_RAN', 'B_RAN', 'C_RAN'];

  it('offers no line for an assertion that did not run', () => {
    const registry = createAssertionRegistry(REQUIRED);
    registry.ran('A_RAN', 'looked at 3 things');

    const named = registry.passLines().map((line) => line.assertion);
    expect(named).toEqual(['A_RAN']);
    // The whole defect, stated as an assertion: a check that never executed
    // must have nothing to say.
    expect(named).not.toContain('B_RAN');
    expect(named).not.toContain('C_RAN');
  });

  it('names the required assertions that never ran', () => {
    const registry = createAssertionRegistry(REQUIRED);
    registry.ran('B_RAN', 'looked at 7 things');

    expect(registry.missing()).toEqual(['A_RAN', 'C_RAN']);
    expect(registry.didRun('B_RAN')).toBe(true);
    expect(registry.didRun('A_RAN')).toBe(false);
  });

  it('is silent about nothing once every assertion has run', () => {
    const registry = createAssertionRegistry(REQUIRED);
    for (const assertion of REQUIRED) registry.ran(assertion, `checked ${assertion}`);

    expect(registry.missing()).toEqual([]);
    expect(registry.passLines()).toHaveLength(REQUIRED.length);
  });

  it('reports in the declared order, not the order checks happened to run', () => {
    const registry = createAssertionRegistry(REQUIRED);
    registry.ran('C_RAN', 'third');
    registry.ran('A_RAN', 'first');
    registry.ran('B_RAN', 'second');

    expect(registry.passLines().map((line) => line.assertion)).toEqual(REQUIRED);
  });

  it('refuses an assertion nothing requires, rather than recording a stray pass', () => {
    const registry = createAssertionRegistry(REQUIRED);
    // A typo must not quietly register a passing assertion while the real one
    // goes on looking as though it never ran.
    expect(() => registry.ran('A_RANN', 'typo')).toThrow(/unknown assertion/);
    expect(registry.missing()).toEqual(REQUIRED);
  });

  it('refuses a claim that does not say what it checked', () => {
    const registry = createAssertionRegistry(REQUIRED);
    expect(() => registry.ran('A_RAN', '')).toThrow(/must describe/);
    expect(() => registry.ran('A_RAN', '   ')).toThrow(/must describe/);
    expect(() => registry.ran('A_RAN', undefined)).toThrow(/must describe/);
    expect(registry.didRun('A_RAN')).toBe(false);
  });

  it('insists on being given something to require', () => {
    expect(() => createAssertionRegistry([])).toThrow(/non-empty/);
    expect(() => createAssertionRegistry(undefined)).toThrow(/non-empty/);
  });

  it('does not let a caller mutate what is required', () => {
    const registry = createAssertionRegistry(REQUIRED);
    expect(() => {
      registry.required.push('D_RAN');
    }).toThrow();
    expect(registry.required).toEqual(REQUIRED);
  });
});
