/**
 * The palette itself, measured rather than trusted.
 *
 * This is the cheap half of the contrast story. `tests/e2e/contrast.spec.ts`
 * measures what is actually painted on the page, which is the authority; it
 * needs a browser and a built site and takes minutes. This reads the tokens
 * out of the stylesheet and does the arithmetic in milliseconds, so a palette
 * edit that would fail AA is caught while somebody is still typing it.
 *
 * WHAT THIS EXISTS TO PREVENT
 *
 * `ink-muted` on `raised` in dark mode is 4.48:1 — under the 4.5 that ordinary
 * text requires, by two hundredths. One line in the app used that pair and
 * nobody saw it for a long time, because the element only renders on an entry
 * that carries a church handout and no fixture had one.
 *
 * The pair is still 4.48. It was fixed by not USING it, not by moving the
 * token, because exactly one rendered context had the problem and repainting a
 * token that is correct everywhere else to suit one label would be the wrong
 * shape of fix. So this file records which pairs are safe, and which one is
 * not — and fails if a palette edit changes either answer.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The tokens, read from the stylesheet rather than copied into this file. */
function palette(block: RegExp): Record<string, string> {
  // Resolved from the project root: vitest runs this file under a jsdom
  // environment where `import.meta.url` is not a file: URL.
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
  const section = css.match(block)?.[0] ?? '';
  const found: Record<string, string> = {};
  for (const [, name, value] of section.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    found[name] = value.toLowerCase();
  }
  return found;
}

const LIGHT = palette(/:root\s*\{[\s\S]*?\n\}/);
const DARK = palette(/:root\[data-theme='dark'\]\s*\{[\s\S]*?\n\}/);

function ratio(foreground: string, background: string): number {
  const channel = (hex: string, at: number): number => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string): number => {
    const h = hex.replace('#', '');
    return 0.2126 * channel(h, 0) + 0.7152 * channel(h, 2) + 0.0722 * channel(h, 4);
  };
  const a = luminance(foreground) + 0.05;
  const b = luminance(background) + 0.05;
  return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
}

/** WCAG 1.4.3 for ordinary text. Large text is 3:1 and is not what these are. */
const AA_SMALL = 4.5;

const SURFACES = ['app', 'surface', 'raised', 'sunken'] as const;

describe('the tokens were read at all', () => {
  it('found both palettes', () => {
    // Every assertion below passes vacuously against an empty object.
    for (const [name, tokens] of [['light', LIGHT], ['dark', DARK]] as const) {
      expect(Object.keys(tokens).length, `${name} tokens`).toBeGreaterThan(10);
      for (const key of ['ink', 'ink-soft', 'ink-muted', ...SURFACES]) {
        expect(tokens[key], `${name} --${key}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});

describe('ordinary text clears AA on every surface', () => {
  for (const [theme, tokens] of [['light', LIGHT], ['dark', DARK]] as const) {
    for (const ink of ['ink', 'ink-soft'] as const) {
      for (const surface of SURFACES) {
        it(`${theme}: ${ink} on ${surface}`, () => {
          expect(ratio(tokens[ink], tokens[surface])).toBeGreaterThanOrEqual(AA_SMALL);
        });
      }
    }
  }
});

describe('muted text — where it may be used, and where it may not', () => {
  for (const [theme, tokens] of [['light', LIGHT], ['dark', DARK]] as const) {
    for (const surface of SURFACES) {
      // The one pair that does not clear AA, in the one theme where it does not.
      const hazardous = theme === 'dark' && surface === 'raised';
      it(`${theme}: ink-muted on ${surface} ${hazardous ? 'is BELOW AA' : 'clears AA'}`, () => {
        const measured = ratio(tokens['ink-muted'], tokens[surface]);
        if (hazardous) {
          // Asserted as a fact, not waved through. If a palette change ever
          // lifts this above 4.5 the test fails and somebody deletes the
          // special case — which is the right outcome, not a nuisance.
          expect(measured).toBeLessThan(AA_SMALL);
        } else {
          expect(measured).toBeGreaterThanOrEqual(AA_SMALL);
        }
      });
    }
  }

  /**
   * The number itself, pinned.
   *
   * Two hundredths under is the whole story here, and it is the kind of
   * detail that gets rounded away in a retelling. 4.48, not "about 4.5".
   */
  it('dark ink-muted on raised is 4.48:1', () => {
    expect(ratio(DARK['ink-muted'], DARK.raised)).toBe(4.48);
  });
});
