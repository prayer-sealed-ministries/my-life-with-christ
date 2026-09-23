/**
 * The startup verifier's own logic, proven able to fail.
 *
 * `verify-startup.mjs` answers one question — is the Scripture payload still
 * reached only by `import()` — and it answers it by reading minified bundles.
 * The reading is the part that can be quietly wrong: a regex that matches
 * nothing reports a clean build, which is assertion-shaped decoration and
 * exactly the failure this repository has shipped twice.
 *
 * So the classifier is exported and tested against the forms Vite actually
 * emits, in both directions: a static import must be SEEN as static, or the
 * verifier would pass a build that loads a megabyte before first paint.
 */

import { describe, expect, it } from 'vitest';

import { referenceKind, STARTUP_CEILING } from '../verify-startup.mjs';

/** Where the chunk name sits in a line of output, as the verifier finds it. */
const at = (source, name) => referenceKind(source, source.indexOf(name));

const CHUNK = '_virtual_journey-outlines-BeFJvkyO.js';

describe('referenceKind', () => {
  it('calls a bare dynamic import dynamic', () => {
    expect(at(`const m=await import("./${CHUNK}")`, CHUNK)).toBe('dynamic');
  });

  it('calls a preloaded dynamic import dynamic', () => {
    // What Vite actually writes for a code-split dependency.
    expect(at(`__vitePreload(()=>import("./${CHUNK}"),[])`, CHUNK)).toBe('dynamic');
  });

  /**
   * Copied off a real build, not imagined.
   *
   * Vite writes the specifier in BACKTICKS. The first version of the verifier
   * allowed only quotes, ran green against the classifier's hand-written
   * cases, and then called the one true dynamic import in the bundle an
   * `unknown` one. It failed closed, so nothing would have shipped — but the
   * message would have sent somebody hunting a bug that was in the ruler.
   */
  it('calls a backtick dynamic import dynamic, as Vite writes it', () => {
    expect(at('var Pe=()=>u(()=>import(`./' + CHUNK + '`),[])', CHUNK)).toBe('dynamic');
  });

  it('calls a named static import static', () => {
    expect(at(`import{outlines as o}from"./${CHUNK}";`, CHUNK)).toBe('static');
  });

  it('calls a side-effect static import static', () => {
    expect(at(`import"./${CHUNK}";`, CHUNK)).toBe('static');
  });

  it('calls a re-export static', () => {
    expect(at(`export{outlines}from"./${CHUNK}";`, CHUNK)).toBe('static');
  });

  /**
   * The direction that matters most.
   *
   * Every other case here would still pass if `referenceKind` simply returned
   * 'dynamic' for everything — and so would the whole verifier, on every build
   * forever. This is the one that proves it can say no.
   */
  it('never reports a static import as dynamic', () => {
    const staticForms = [
      `import{outlines}from"./${CHUNK}"`,
      `import o from"./${CHUNK}"`,
      `import"./${CHUNK}"`,
      `export*from"./${CHUNK}"`,
    ];
    for (const form of staticForms) {
      expect(at(form, CHUNK)).not.toBe('dynamic');
    }
  });

  it('does not mistake an unrecognised mention for an import', () => {
    // A bare string in a manifest is not an import of anything, and must not
    // be waved through as one.
    expect(at(`const manifest={"${CHUNK}":{}}`, CHUNK)).toBe('unknown');
  });
});

describe('the startup ceiling', () => {
  it('is set below a build that carries the sections', () => {
    // The public startup chunk measured 1,158,369 bytes with the divisions in
    // it. A ceiling that did not exclude that number would permit the exact
    // regression this lane exists to prevent.
    for (const profile of Object.keys(STARTUP_CEILING)) {
      expect(STARTUP_CEILING[profile]).toBeLessThan(1_158_369);
    }
  });

  it('covers both shipped profiles', () => {
    expect(Object.keys(STARTUP_CEILING).sort()).toEqual(['public', 'refs-only']);
  });
});
