/**
 * Focus writing mode, in a real browser.
 *
 * The unit suite owns what focus mode does: the chrome goes, the state survives
 * the remount a save causes, Back dismisses it before it navigates. None of
 * that needs a browser. What does is the question the mode exists to answer —
 * whether the writing surface actually GOT the space — and the two ways a
 * chrome-less page can quietly fail a reader: an accessibility tree with no
 * landmark left in it, and a layout that scrolls sideways once the reader's own
 * text size is larger than the one it was designed at.
 *
 * Measured against the built site, like everything else here.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { assertRendered, examinedAtLeast } from './floor';
import { dismissWelcome, forceTheme } from './seed';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** The writing surface and the page around it, as the browser has laid it out. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const notes = document.querySelector('textarea') as HTMLTextAreaElement | null;
    const box = notes?.getBoundingClientRect();
    return {
      header: !!document.querySelector('header'),
      footer: !!document.querySelector('footer'),
      nav: !!document.querySelector('nav'),
      main: !!document.querySelector('main'),
      h1s: document.querySelectorAll('h1').length,
      notesTop: box ? Math.round(box.top + window.scrollY) : -1,
      notesHeight: box ? Math.round(box.height) : -1,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewport: window.innerHeight,
    };
  });

async function openEditor(page: Page, width: number, height = 844) {
  await page.setViewportSize({ width, height });
  await dismissWelcome(page);
  await page.addInitScript(() => localStorage.setItem('journey:intro', 'closed'));
  await page.goto('/#/entry/new');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 15_000 });
}

const enterFocus = async (page: Page) => {
  await page.getByRole('button', { name: 'Focus' }).click();
  await expect(page.getByRole('button', { name: 'Leave focus mode' })).toBeVisible();
  await page.waitForTimeout(200);
};

test.describe('what focus mode is for', () => {
  test('gives the writing surface the space the chrome was using', async ({ page }) => {
    await openEditor(page, 390);
    const before = await measure(page);

    expect(before.header, 'there was no chrome to reclaim').toBe(true);
    expect(before.notesTop, 'the editor did not render').toBeGreaterThan(0);

    await enterFocus(page);
    const after = await measure(page);

    expect(after.header, 'the header survived focus mode').toBe(false);
    expect(after.footer, 'the footer survived focus mode').toBe(false);
    expect(after.nav, 'the navigation survived focus mode').toBe(false);

    // The claim, as a number rather than an impression: the notes box starts
    // higher up the page and is visibly bigger than it was.
    expect(after.notesTop, 'the writing surface did not move up').toBeLessThan(before.notesTop);
    expect(
      after.notesHeight,
      'the writing surface did not grow into the space the chrome gave up',
    ).toBeGreaterThan(before.notesHeight);

    // And what it is really about: how much of one phone screen is writing.
    const visible = Math.min(after.notesHeight, after.viewport - after.notesTop);
    expect(
      visible,
      `only ${visible}px of the writing box is on screen in focus mode`,
    ).toBeGreaterThan(before.notesHeight);
  });

  test('is still a page, not a rectangle', async ({ page }) => {
    await openEditor(page, 390);
    await enterFocus(page);
    const after = await measure(page);

    // Removing the header removes a landmark and the banner. `main` and exactly
    // one h1 are what a screen-reader user has left to navigate by, so they are
    // not optional.
    expect(after.main, 'focus mode has no main landmark').toBe(true);
    expect(after.h1s, 'focus mode does not have exactly one h1').toBe(1);

    // The way out, the kind, and Save — all three, all reachable.
    await expect(page.getByRole('button', { name: 'Leave focus mode' })).toBeVisible();
    await expect(page.getByLabel('Kind', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

    // And it is not Notes only.
    await expect(page.getByLabel('Reflection', { exact: true })).toBeVisible();
    await page.getByText('Details', { exact: true }).click();
    await expect(page.getByLabel('Prayer', { exact: true })).toBeVisible();
  });
});

test.describe('it holds together when squeezed', () => {
  for (const width of [320, 390, 768, 1280]) {
    test(`at ${width}px`, async ({ page }) => {
      await openEditor(page, width);
      await enterFocus(page);
      const after = await measure(page);
      expect(after.overflow, `focus mode scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
      expect(after.notesHeight, `no writing box at ${width}px`).toBeGreaterThan(100);
    });
  }

  test('at the reader’s own doubled text size', async ({ page }) => {
    // The real mechanism, not `html { font-size: 200% }` — media queries cannot
    // see that. See nav-breakpoint.spec.ts for what this cost to learn.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 32 } });

    await openEditor(page, 320);
    await expect(page.locator('html')).toHaveCSS('font-size', '32px');
    await enterFocus(page);

    const after = await measure(page);
    expect(after.overflow, 'focus mode scrolls sideways at doubled text').toBeLessThanOrEqual(1);
  });
});

test.describe('axe-core in focus mode, WCAG 2.1 AA', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`no violations — ${theme}`, async ({ page }) => {
      await forceTheme(page, theme);
      await openEditor(page, 390);
      await enterFocus(page);
      await assertRendered(page, `focus mode (${theme})`);

      // The details panel is where most of this view's controls live, including
      // Prayer. A scan that left it closed would report the mode clean having
      // measured two textareas and a select.
      await page.getByText('Details', { exact: true }).click();
      await page.waitForTimeout(200);

      const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      examinedAtLeast(result.passes.length, 10, 'axe checks that passed in focus mode');
      expect(
        result.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`).join('\n'),
      ).toBe('');
    });
  }
});
