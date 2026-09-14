/**
 * Floors for the end-to-end suite.
 *
 * Same reasoning as src/testing/floor.ts — kept separate because Playwright
 * tests use its own `expect`, not vitest's, and importing the wrong one gives
 * an assertion that never reports.
 */

import { expect, type Page } from '@playwright/test';

export function examinedAtLeast(count: number, minimum: number, what: string): void {
  expect(
    count,
    `NULL MEASUREMENT: examined ${count} ${what}, expected at least ${minimum}. ` +
      `This check would have passed without looking at anything.`,
  ).toBeGreaterThanOrEqual(minimum);
}

/**
 * Assert a view actually rendered, rather than merely having an <h1>.
 *
 * An error boundary, a not-found page and a half-mounted view all satisfy
 * "an h1 is visible". The text floor is what separates a rendered view from
 * a rendered apology.
 */
export async function assertRendered(page: Page, view: string, minChars = 120): Promise<number> {
  const text = await page.locator('main').innerText();
  const length = text.replace(/\s+/g, ' ').trim().length;

  expect(
    length,
    `NULL MEASUREMENT: ${view} rendered ${length} characters of text (expected >= ${minChars}). ` +
      `An error page satisfies every structural check while containing nothing.`,
  ).toBeGreaterThanOrEqual(minChars);

  expect(text, `${view} rendered an error state`).not.toMatch(/not found|went wrong|failed to load/i);
  return length;
}
