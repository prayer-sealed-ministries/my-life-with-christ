#!/usr/bin/env node
/**
 * Runs the unit suite under every data profile and proves that nothing hides
 * in the gaps between them.
 *
 * Several tests are gated on the shape of the data (`it.skipIf(...)`) because
 * the profiles genuinely differ: `public` has no uncovered spans, `refs-only`
 * has no outline entries to tag. A gate is the honest way to say that. But a
 * gate is also the cheapest way to make a test disappear — a predicate that is
 * wrong in one direction skips everywhere, and the suite still reports green.
 *
 * So this asserts a floor in both directions:
 *   - every profile runs, and runs a minimum number of tests;
 *   - every test that exists runs, and passes, under at least one profile.
 *
 * Usage: node scripts/profile-coverage.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROFILES = ['full', 'public', 'refs-only'];

/**
 * A floor, not a target. The suite is ~715 tests; this only has to be high
 * enough that an empty or half-loaded run cannot slip past. Raise it if it
 * ever starts tracking the real count.
 */
const MINIMUM_TESTS_PER_PROFILE = 600;

const dir = mkdtempSync(join(tmpdir(), 'journey-profiles-'));

/** @type {Map<string, Set<string>>} profile -> test names that passed */
const passedBy = new Map();
/** @type {Set<string>} every test name seen in any profile */
const everySeen = new Set();
/** @type {string[]} */
const failures = [];

try {
  for (const profile of PROFILES) {
    const out = join(dir, `${profile}.json`);
    const run = spawnSync(
      'npx',
      ['vitest', 'run', '--reporter=json', `--outputFile=${out}`],
      { env: { ...process.env, DATA_PROFILE: profile }, encoding: 'utf8', stdio: 'pipe' },
    );

    let report;
    try {
      report = JSON.parse(readFileSync(out, 'utf8'));
    } catch {
      console.error(run.stdout ?? '');
      console.error(run.stderr ?? '');
      throw new Error(`DATA_PROFILE=${profile}: no JSON report was written (exit ${run.status})`);
    }

    const passed = new Set();
    let total = 0;
    for (const file of report.testResults ?? []) {
      for (const assertion of file.assertionResults ?? []) {
        total += 1;
        everySeen.add(assertion.fullName);
        if (assertion.status === 'passed') passed.add(assertion.fullName);
        if (assertion.status === 'failed') failures.push(`${profile}: ${assertion.fullName}`);
      }
    }

    if (total < MINIMUM_TESTS_PER_PROFILE) {
      throw new Error(
        `DATA_PROFILE=${profile}: only ${total} tests were collected, below the floor of ${MINIMUM_TESTS_PER_PROFILE}. ` +
          'The suite did not load, rather than passing.',
      );
    }

    passedBy.set(profile, passed);
    console.log(
      `${profile.padEnd(10)} ${total} collected, ${passed.size} passed, ${total - passed.size} not run or failed`,
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} failing test(s):`);
  for (const name of failures) console.error(`  ${name}`);
  process.exit(1);
}

const neverRan = [...everySeen].filter((name) =>
  PROFILES.every((profile) => !passedBy.get(profile).has(name)),
);

if (neverRan.length > 0) {
  console.error(
    `\n${neverRan.length} test(s) are skipped under every profile, so they measure nothing:`,
  );
  for (const name of neverRan) console.error(`  ${name}`);
  console.error('\nEither the skipIf predicate is wrong, or the test needs a profile that has the shape.');
  process.exit(1);
}

const gated = [...everySeen].filter((name) =>
  PROFILES.some((profile) => !passedBy.get(profile).has(name)),
);

console.log(`\n${everySeen.size} distinct tests; every one passes under at least one profile.`);
if (gated.length > 0) {
  console.log(`\n${gated.length} shape-gated test(s) — each runs where its data exists:`);
  for (const name of gated) {
    const where = PROFILES.filter((profile) => passedBy.get(profile).has(name));
    console.log(`  ${name}\n      runs under: ${where.join(', ')}`);
  }
}
