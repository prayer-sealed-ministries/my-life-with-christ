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
 *
 * Evidence has to say what it is evidence OF. These used to land in
 * `screenshots/<theme>/<width>/` with nothing recording which data profile the
 * build carried, so a folder of sixty-two images could show `public` or
 * `refs-only` and there was no way to tell after the fact — the same defect as
 * the e2e suite reporting one profile while testing another. The profile is now
 * read from the running build, not from the environment, and it is in the path
 * of every file and in a `CAPTURED.json` beside them.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { assertRendered, examinedAtLeast } from './floor';
import { dismissWelcome, forceTheme, seedEntries } from './seed';
import { detectProfile, resolvePassageHash, type DataProfile } from './views';

const WIDTHS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 900 },
] as const;

const THEMES = ['light', 'dark'] as const;

/** Every view, in the order a person would meet them. */
const VIEWS = [
  { key: '01-home', hash: '#/', heading: 'My Life With Christ' },
  { key: '02-browse', hash: '#/browse', heading: 'The Bible' },
  { key: '03-book', hash: '#/book/matthew', heading: 'Matthew' },
  // Replaced at runtime with a passage that exists in the build under test.
  { key: '04-passage', hash: '', heading: null },
  { key: '05-topics', hash: '#/topics', heading: 'Topics' },
  { key: '06-topic', hash: '#/topic/anxiety', heading: 'Anxiety' },
  { key: '07-timeline', hash: '#/timeline', heading: null },
  { key: '08-search', hash: '#/search?q=whitfield', heading: 'Search' },
  { key: '09-entry-edit', hash: '#/entry/seed-01', heading: null },
  { key: '10-entry-new', hash: '#/entry/new', heading: null },
  { key: '11-data', hash: '#/data', heading: null },
  { key: '12-legacy', hash: '#/legacy', heading: null },
] as const;

const shot = (page: Page, profile: DataProfile, path: string) =>
  page.screenshot({
    path: `screenshots/${profile}/${path}`,
    fullPage: true,
    animations: 'disabled',
  });

/**
 * Record what this run captured, beside the images rather than in a log.
 *
 * A reviewer opening the folder in a month should not have to reconstruct which
 * build these came from. Written on every run so it cannot go stale relative to
 * the images sitting next to it.
 */
function stampCapture(profile: DataProfile, baseURL: string | undefined) {
  mkdirSync(`screenshots/${profile}`, { recursive: true });
  writeFileSync(
    `screenshots/${profile}/CAPTURED.json`,
    `${JSON.stringify(
      {
        profile,
        capturedAt: new Date().toISOString(),
        servedFrom: baseURL ?? null,
        note: 'Profile was read from the running build (data-data-profile on <html>), not from DATA_PROFILE.',
      },
      null,
      2,
    )}\n`,
  );
}

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
      test(`every view — ${theme} @ ${size.name}px`, async ({ page, baseURL }) => {
        test.setTimeout(180_000);
        await page.setViewportSize({ width: size.width, height: size.height });
        await dismissWelcome(page);
        await forceTheme(page, theme);

        await page.goto('#/');
        await page.waitForLoadState('networkidle');
        await seedEntries(page);

        const profile = await detectProfile(page);
        console.log(`  data profile under test: ${profile}`);
        stampCapture(profile, baseURL);
        const passage = await resolvePassageHash(page);
        const views = VIEWS.map((view) =>
          view.key === '04-passage' ? { ...view, hash: passage } : view,
        );

        const problems: string[] = [];
        page.on('pageerror', (error) => problems.push(`${error.message}`));

        let totalText = 0;

        for (const view of views) {
          await page.goto(view.hash);
          await settle(page);

          // A screenshot of a blank page is easy to skim past in a folder of
          // sixty. Assert each view actually rendered before capturing it.
          totalText += await assertRendered(page, view.key);

          if (view.key === '10-entry-new') {
            // Mid-write, which is the state this view is actually used in.
            await page.getByLabel(/^Notes/i).fill(
              'He said the parable turns on the father running — an old man did not run, and he ran anyway.',
            );
            await page.getByLabel(/^Reflection/i).fill('I have been the older brother more often than I admit.');
            await page.waitForTimeout(200);
          }

          await shot(page, profile, `${theme}/${size.name}/${view.key}.png`);

          if (view.heading) {
            await expect(page.locator('main h1').first()).toContainText(view.heading);
          }
        }

        examinedAtLeast(totalText, views.length * 120, 'characters rendered across all views');
        expect(problems, `page errors: ${problems.join(' | ')}`).toEqual([]);
      });
    }
  }
});

test.describe('empty state — a first visit with nothing written', () => {
  for (const size of WIDTHS) {
    test(`first visit — light @ ${size.name}px`, async ({ page, baseURL }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: size.width, height: size.height });
      await forceTheme(page, 'light');

      // Deliberately NOT dismissing the notice: this is what a stranger sees.
      await page.goto('#/');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(600);

      // The profile is stamped on <html> by the build, so it can be read here
      // without navigating — and navigating would dismiss or reset the very
      // notice this test exists to photograph.
      const profile = (await page
        .locator('html')
        .getAttribute('data-data-profile')) as DataProfile | null;
      expect(profile, 'the build did not stamp data-data-profile on <html>').toBeTruthy();
      console.log(`  data profile under test: ${profile}`);
      stampCapture(profile!, baseURL);

      await shot(page, profile!, `empty/${size.name}/00-first-visit-notice.png`);

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
        await shot(page, profile!, `empty/${size.name}/${view.key}.png`);
      }
    });
  }
});
