import { describe, expect, it } from 'vitest';
import { examinedAtLeast, sentinelFound } from '/path/redacted';

describe('the floors themselves fail when they should', () => {
  it('examinedAtLeast throws on zero', () => {
    expect(() => examinedAtLeast(0, 1, 'things')).toThrow(/NULL MEASUREMENT/);
  });
  it('examinedAtLeast throws below the floor', () => {
    expect(() => examinedAtLeast(3, 10, 'things')).toThrow(/examined 3 things, expected at least 10/);
  });
  it('examinedAtLeast passes at the floor', () => {
    expect(() => examinedAtLeast(10, 10, 'things')).not.toThrow();
  });
  it('sentinelFound throws when absent', () => {
    expect(() => sentinelFound(false, 'Journey', 'dist/')).toThrow(/was not found in dist\//);
  });
});
