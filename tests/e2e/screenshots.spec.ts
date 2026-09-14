/**
 * Pass A: look at it.
 *
 * Captures every view at phone and desktop width, in both themes, empty and
 * populated, against the BUILT site. Output goes to screenshots/ as files a
 * human can open, named so they sort into a sensible reading order.
 *
 * These assert almost nothing on purpose — their job is to produce evidence.
 * The checks that hold the line live in a11y.spec.ts and keyboard.spec.ts.
 * The one thing asserted here is that a page rendered at all and did not throw,
 * because a screenshot of a blank page is easy to skim past.
 */

import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome, forceTheme, seedEntries } from './seed';

const WIDTHS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 900 },
] as const;

const THEMES = ['light', 'dark'] as const;

/** Every view, in the order a person would meet them. */
const VIEWS = [
  { key: '01-home', hash: '#/', heading: 'Journey' },
  { key: '02-browse', hash: '#/browse', heading: 'The Bible' },
  { key: '03-book', hash: '#/book/matthew', heading: 'Matthew' },
  { key: '04-passage', hash: '#/passage/matthew/matthew-5-1-12', heading: null },
  { key: '05-topics', hash: '#/topics', heading: 'Topics' },
  { key: '06-topic', hash: '#/topic/anxiety', heading: 'Anxiety' },
  { key: '07-timeline', hash: '#/timeline', heading: null },
  { key: '08-search', hash: '#/search?q=whitfield', heading: 'Search' },
  { key: '09-entry-edit', hash: '#/entry/seed-01', heading: null },
  { key: '10-entry-new', hash: '#/entry/new', heading: null },
  { key: '11-data', hash: '#/data', heading: null },
  { key: '12-legacy', hash: '#/legacy', heading: null },
] as const;

const shot = (page: Page, path: string) =>
  page.screenshot({ path: `screenshots/${path}`, fullPage: true, animations: 'disabled' });

/** Wait until the view has actually painted its content, not just its shell. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });
  // Scripture and entry lists arrive a tick after the heading.
  await page.waitForTimeout(500);
}

test.describe('populated', () => {
  for (const theme of THEMES) {
    for (const size of WIDTHS) {
      test(`every view — ${theme} @ ${size.name}px`, async ({ page }) => {
        test.setTimeout(180_000);
        await page.setViewportSize({ width: size.width, height: size.height });
        await dismissWelcome(page);
        await forceTheme(page, theme);

        await page.goto('#/');
        await page.waitForLoadState('networkidle');
        await seedEntries(page);

        const problems: string[] = [];
        page.on('pageerror', (error) => problems.push(`${error.message}`));

        for (const view of VIEWS) {
          await page.goto(view.hash);
          await settle(page);

          if (view.key === '10-entry-new') {
            // Mid-write, which is the state this view is actually used in.
            await page.getByLabel(/^Notes/i).fill(
              'He said the parable turns on the father running — an old man did not run, and he ran anyway.',
            );
            await page.getByLabel(/^Reflection/i).fill('I have been the older brother more often than I admit.');
            await page.waitForTimeout(200);
          }

          await shot(page, `${theme}/${size.name}/${view.key}.png`);

          if (view.heading) {
            await expect(page.locator('main h1').first()).toContainText(view.heading);
          }
        }

        expect(problems, `page errors: ${problems.join(' | ')}`).toEqual([]);
      });
    }
  }
});

test.describe('empty state — a first visit with nothing written', () => {
  for (const size of WIDTHS) {
    test(`first visit — light @ ${size.name}px`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: size.width, height: size.height });
      await forceTheme(page, 'light');

      // Deliberately NOT dismissing the notice: this is what a stranger sees.
      await page.goto('#/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(600);
      await shot(page, `empty/${size.name}/00-first-visit-notice.png`);

      await dismissWelcome(page);
      for (const view of [
        { key: '01-home', hash: '#/' },
        { key: '02-browse', hash: '#/browse' },
        { key: '07-timeline', hash: '#/timeline' },
        { key: '08-search', hash: '#/search?q=money' },
        { key: '11-data', hash: '#/data' },
        { key: '12-legacy', hash: '#/legacy' },
      ]) {
        await page.goto(view.hash);
        await settle(page);
        await shot(page, `empty/${size.name}/${view.key}.png`);
      }
    });
  }
});
