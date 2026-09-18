/**
 * Where the navigation changes shape, and whether it fits when it does.
 *
 * The header switches from the hamburger to the full primary navigation at one
 * width. That switch used to happen at `sm` (640px), where the row does not
 * fit: the brand needs 174px, the actions 238px and the nav 293px, which with
 * gaps and padding comes to about 768. At 640 the nav was handed 125px less
 * than it needs and "Search" was cut off the end — visible, in the DOM, and
 * unreachable.
 *
 * The existing clipping test checked 1280, 1024 and 900 and saw none of it,
 * because the defect lives at the boundary rather than at the wide end. This
 * walks the boundary itself: the last pixel of each layout and the first pixel
 * of the next.
 *
 * One property makes the whole range provable from a few widths: the header row
 * is capped at max-w-3xl, so it can never be wider than 768. If it fits at 768
 * it fits at every width above, and there is no wide end left to go wrong.
 */

import { expect, test, type Page } from '@playwright/test';

import { examinedAtLeast } from './floor';
import { dismissWelcome } from './seed';

/** Tailwind's md. Below it the hamburger is the navigation. */
const DESKTOP_FROM = 768;

/** The last and first pixel of each layout, plus the widths already trusted. */
const WIDTHS = [639, 640, 767, 768, 900, 1024, 1280] as const;

const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const hamburger = (page: Page) => page.locator('button[aria-controls][aria-expanded]').first();

async function arrive(page: Page, width: number) {
  await page.setViewportSize({ width, height: 860 });
  await dismissWelcome(page);
  await page.goto('/#/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main h1').first()).toBeAttached({ timeout: 15_000 });
}

/** What the rendered page actually does at this width — measured, not assumed. */
async function layoutAt(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Main"]');
    const shown = nav ? getComputedStyle(nav).display !== 'none' : false;
    return {
      navShown: shown,
      // scrollWidth beyond clientWidth is content that exists and cannot be
      // reached: exactly how "Search" disappeared while every visibility
      // assertion still passed.
      navOverflow: shown && nav ? nav.scrollWidth - nav.clientWidth : 0,
      navLinks: nav ? nav.querySelectorAll('a').length : 0,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test.describe('the navigation fits wherever it is shown', () => {
  for (const width of WIDTHS) {
    test(`at ${width}px`, async ({ page }) => {
      await arrive(page, width);
      const layout = await layoutAt(page);

      // The boundary itself: which layout is in force here.
      expect(
        layout.navShown,
        width >= DESKTOP_FROM
          ? `the primary nav should be shown from ${DESKTOP_FROM}px`
          : `the primary nav should still be hidden below ${DESKTOP_FROM}px`,
      ).toBe(width >= DESKTOP_FROM);

      if (layout.navShown) {
        // A floor: an empty nav cannot overflow and would pass in silence.
        expect(layout.navLinks, `the main nav is empty at ${width}px`).toBeGreaterThanOrEqual(4);
        expect(layout.navOverflow, `the main nav is cut off at ${width}px`).toBeLessThanOrEqual(0);

        // Every label, and the last one by name — "Search" is the one that went.
        for (const label of ['Bible', 'Topics', 'My journey', 'Search']) {
          await expect(
            mainNav(page).getByRole('link', { name: label, exact: true }),
            `${label} is not visible at ${width}px`,
          ).toBeInViewport();
        }
      }

      // The hamburger is the only navigation below the boundary and stays
      // available above it, so it must be usable at every width.
      await expect(hamburger(page), `no menu button at ${width}px`).toBeVisible();

      expect(layout.pageOverflow, `the page scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
    });
  }

  test('checked both sides of the boundary', () => {
    // Guards the list itself: a table trimmed to only wide widths is how the
    // original defect survived.
    const below = WIDTHS.filter((w) => w < DESKTOP_FROM);
    const atOrAbove = WIDTHS.filter((w) => w >= DESKTOP_FROM);
    examinedAtLeast(below.length, 2, 'widths below the desktop breakpoint');
    examinedAtLeast(atOrAbove.length, 2, 'widths at or above the desktop breakpoint');
    expect(below, 'the last pixel before the switch is not checked').toContain(DESKTOP_FROM - 1);
    expect(atOrAbove, 'the first pixel of the switch is not checked').toContain(DESKTOP_FROM);
  });
});

test.describe('below the boundary the hamburger carries everything', () => {
  for (const width of [639, 640, 767]) {
    test(`all nine destinations are reachable at ${width}px`, async ({ page }) => {
      await arrive(page, width);
      await hamburger(page).click();

      const panel = page.getByRole('dialog', { name: 'Menu' });
      await expect(panel).toBeVisible();

      const labels = [
        'Home', 'Bible', 'Topics', 'My journey', 'Search',
        'Data & Backup', 'Settings', 'Help', 'About',
      ];
      for (const label of labels) {
        await expect(
          panel.getByRole('link', { name: label, exact: true }),
          `${label} is unreachable at ${width}px`,
        ).toBeVisible();
      }
      examinedAtLeast(labels.length, 9, `destinations checked at ${width}px`);

      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    });
  }
});

test.describe('the boundary survives enlarged text', () => {
  // Two different things are called "200% text", and only one of them is a
  // state a reader can actually be in.
  //
  //   - A page-level `html { font-size: 200% }` override, which is what
  //     reflow.spec.ts uses. Media queries deliberately do NOT see it: `rem`
  //     inside a media query resolves against the browser's font size, not the
  //     document's. So this holds the desktop layout in place and doubles the
  //     text inside it — at 768px that pushes the page 119px sideways.
  //   - The browser's own text size, which is what a person changes in
  //     settings. That DOES move a rem breakpoint, and Tailwind emits this one
  //     as `@media (width>=48rem)`.
  //
  // Below the boundary the layout is the same either way, so the cheap override
  // is honest there. At and above it, only the real mechanism tells the truth.
  for (const width of [639, 640, 767]) {
    test(`200% page text at ${width}px, below the boundary`, async ({ page }) => {
      await arrive(page, width);
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.waitForTimeout(200);

      const layout = await layoutAt(page);
      expect(layout.navShown, 'the desktop nav appeared below the boundary').toBe(false);
      await expect(hamburger(page), `no menu button at ${width}px and 200% text`).toBeVisible();
      expect(
        layout.pageOverflow,
        `the page scrolls sideways at ${width}px with text doubled`,
      ).toBeLessThanOrEqual(1);
    });
  }

  for (const width of [768, 900]) {
    test(`a reader's own 200% text size at ${width}px`, async ({ page }) => {
      // Set the browser's font size, not the page's, so the rem breakpoint can
      // respond the way it would for a real reader.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Page.enable');
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 32 } });

      await arrive(page, width);
      await page.waitForTimeout(250);

      const root = await page.evaluate(
        () => getComputedStyle(document.documentElement).fontSize,
      );
      expect(root, 'the browser font size did not take effect').toBe('32px');

      const layout = await layoutAt(page);
      // At double text size a 768px window is 24rem wide — a phone, as far as
      // the layout is concerned — so the hamburger is correct here.
      expect(
        layout.navShown,
        `the desktop nav stayed on at ${width}px with the reader's text doubled`,
      ).toBe(false);
      await expect(hamburger(page), `no menu button at ${width}px`).toBeVisible();
      expect(
        layout.pageOverflow,
        `the page scrolls sideways at ${width}px with the reader's text doubled`,
      ).toBeLessThanOrEqual(1);
    });
  }
});

test('the header still respects the safe area and the view still owns its h1', async ({ page }) => {
  await arrive(page, 768);

  // The safe-area classes are what keep the header out from under a phone's
  // status bar; the breakpoint move must not have dropped them.
  const header = page.locator('header').first();
  const classes = (await header.getAttribute('class')) ?? '';
  expect(classes, 'the header lost its safe-area insets').toContain('safe-top');
  expect(classes, 'the header lost its side insets').toContain('safe-sides');

  // Exactly one h1, inside main, and none in the chrome.
  const headings = await page.evaluate(() => ({
    inMain: document.querySelectorAll('main h1').length,
    inHeader: document.querySelectorAll('header h1').length,
    total: document.querySelectorAll('h1').length,
  }));
  expect(headings.inMain, 'the view does not own exactly one h1').toBe(1);
  expect(headings.inHeader, 'the header grew a heading again').toBe(0);
  expect(headings.total, 'more than one h1 on the page').toBe(1);
});
