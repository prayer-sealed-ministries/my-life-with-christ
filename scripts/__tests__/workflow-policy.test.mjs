import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Policy tests over the CI workflows themselves.
 *
 * The data gate is enforced by scripts/verify-bundle.mjs, but the gate is only
 * as good as the workflow that runs it. The realistic path to an accidental
 * publication of the purchased compilation is not a bug in the verifier — it is
 * a one-line edit to .github/workflows/pages.yml: someone changes
 * DATA_PROFILE to `full`, or moves the verify step after the deploy, or adds a
 * second deploy path that skips it.
 *
 * Nothing else catches that, so these assertions do.
 */

// Resolved from the repo root: vitest runs with cwd there.
const read = (path) => parse(readFileSync(resolve(process.cwd(), path), 'utf8'));

const pages = read('.github/workflows/pages.yml');
const ci = read('.github/workflows/ci.yml');

/** Every step of every job, flattened, in order. */
const stepsOf = (workflow, jobName) => workflow.jobs[jobName]?.steps ?? [];

const stepText = (step) =>
  [step.run ?? '', step.uses ?? '', JSON.stringify(step.env ?? {}), JSON.stringify(step.with ?? {})].join(' ');

describe('the workflows were actually read', () => {
  // Every assertion below is "no step does X", which an empty workflow
  // satisfies perfectly. These floors are what make the rest mean anything.
  it('parsed a Pages workflow with real jobs and steps', () => {
    expect(pages, 'pages.yml did not parse').toBeTruthy();
    expect(Object.keys(pages.jobs ?? {}).length).toBeGreaterThanOrEqual(2);
    expect(stepsOf(pages, 'build').length).toBeGreaterThanOrEqual(5);
    expect(stepsOf(pages, 'deploy').length).toBeGreaterThanOrEqual(1);
  });

  it('parsed a CI workflow with real jobs and steps', () => {
    expect(ci, 'ci.yml did not parse').toBeTruthy();
    expect(Object.keys(ci.jobs ?? {}).length).toBeGreaterThanOrEqual(3);
    for (const job of Object.keys(ci.jobs)) {
      expect(stepsOf(ci, job).length, `job "${job}" has no steps`).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the Pages workflow can only ever publish a refs-only build', () => {
  it('has exactly the two jobs it is supposed to have', () => {
    expect(Object.keys(pages.jobs).sort()).toEqual(['build', 'deploy']);
  });

  // Both `public` and `refs-only` are publishable; `full` never is. The test
  // pins the exact profile rather than accepting either, so switching the
  // deployed build stays a deliberate edit to this assertion.
  const PUBLISHED_PROFILE = 'public';

  it(`builds with DATA_PROFILE=${PUBLISHED_PROFILE}`, () => {
    const build = stepsOf(pages, 'build');
    const buildStep = build.find((step) => typeof step.run === 'string' && /npm run build/.test(step.run));

    expect(buildStep, 'no build step found in the Pages workflow').toBeDefined();
    expect(buildStep.env?.DATA_PROFILE).toBe(PUBLISHED_PROFILE);
  });

  it('never deploys the purchased outlines, whatever the profile is set to', () => {
    const build = stepsOf(pages, 'build');
    for (const step of build) {
      expect(step.env?.DATA_PROFILE, 'a step pins the purchased profile').not.toBe('full');
    }
  });

  // The single most dangerous edit: flipping the profile.
  it('never sets DATA_PROFILE to full, anywhere', () => {
    const everything = JSON.stringify(pages);
    expect(everything).not.toMatch(/DATA_PROFILE["':\s]+["']?full/i);
  });

  it('never builds without naming a profile, which would default to full', () => {
    for (const jobName of Object.keys(pages.jobs)) {
      for (const step of stepsOf(pages, jobName)) {
        if (typeof step.run !== 'string' || !/npm run build/.test(step.run)) continue;
        expect(
          step.env?.DATA_PROFILE,
          `a build step in job "${jobName}" does not pin DATA_PROFILE; it would default to full`,
        ).toBe(PUBLISHED_PROFILE);
      }
    }
  });

  it('runs the verifier, in refs-only mode', () => {
    const verify = stepsOf(pages, 'build').find((step) => /verify:bundle|verify-bundle/.test(stepText(step)));
    expect(verify, 'the Pages workflow does not run the bundle verifier').toBeDefined();
    // The verifier must be told the same profile the artefact was built with,
    // or it would judge it against the wrong rules.
    expect(stepText(verify)).toMatch(new RegExp(PUBLISHED_PROFILE));
  });

  it('verifies BEFORE it uploads the artefact', () => {
    const steps = stepsOf(pages, 'build');
    const verifyAt = steps.findIndex((step) => /verify:bundle|verify-bundle/.test(stepText(step)));
    const uploadAt = steps.findIndex((step) => /upload-pages-artifact/.test(step.uses ?? ''));

    expect(verifyAt).toBeGreaterThanOrEqual(0);
    expect(uploadAt).toBeGreaterThanOrEqual(0);
    expect(verifyAt, 'verification must happen before the artefact is uploaded').toBeLessThan(uploadAt);
  });

  it('will not deploy unless the build job succeeded', () => {
    const needs = pages.jobs.deploy.needs;
    expect(Array.isArray(needs) ? needs : [needs]).toContain('build');
  });

  it('does not build or upload anything inside the deploy job', () => {
    // A second, unverified path to the artefact would bypass everything above.
    for (const step of stepsOf(pages, 'deploy')) {
      expect(stepText(step)).not.toMatch(/npm run build|upload-pages-artifact/);
    }
  });

  it('never accepts a smaller probe set in CI', () => {
    // That flag exists for a human who has understood the shrink. A workflow
    // passing it would silently accept an eroded gate on every run.
    expect(JSON.stringify(pages)).not.toContain('--accept-smaller-probe-set');
    expect(JSON.stringify(ci)).not.toContain('--accept-smaller-probe-set');
  });
});

describe('CI verifies both profiles', () => {
  it('runs the verifier against a refs-only build', () => {
    const text = JSON.stringify(ci);
    expect(text).toMatch(/refs-only/);
    expect(text).toMatch(/verify:bundle/);
  });

  it('exposes the gate as its own job, so it can be a required status check', () => {
    expect(
      Object.keys(ci.jobs),
      'the data gate needs its own job for branch protection to require it by name',
    ).toContain('data-gate');
  });

  it('keeps the gate job independent of the rest of CI', () => {
    // If the gate only ran after lint and tests, a failure upstream would leave
    // the required check pending rather than failing, which is not a gate.
    expect(ci.jobs['data-gate'].needs).toBeUndefined();
  });
});
