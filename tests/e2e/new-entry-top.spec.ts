/**
 * A new entry opens at its own top.
 *
 * Reported from a real iPhone: tapping "New sermon note" landed the reader in
 * the middle of the form. The cause was fast capture doing its job badly — the
 * notes box is focused on mount so someone in a pew can start typing at once,
 * and `focus()` scrolls its target into view. The notes box sits below the
 * heading, the kind and the title, so the page arrived already scrolled past
 * all three.
 *
 * Only a rendered page can answer this. In jsdom there is no layout and no
 * scrolling, so every unit test would pass either way — which is exactly why
 * this was never caught.
 */

import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome } from './seed';

const PHONE = { width: 390, height: 780 };

/**
 * Short enough that the notes box starts below the fold.
 *
 * This number is not decorative. The notes box sits 552px down the document,
 * so at 600px and taller `focus()` has no reason to scroll and the defect
 * cannot appear — the first version of this test used 390x780 and passed
 * happily against the bug. At 560 the unfixed build scrolls to 298.
 *
 * It is also the realistic case: a phone with the keyboard up has far less
 * visible height than its nominal viewport, which is why this was reported
 * from a real iPhone and not from any test.
 */
const SHORT_PHONE = { width: 390, height: 560 };

const notesBox = (page: Page) => page.getByLabel('Notes', { exact: true });

async function openNewEntry(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await dismissWelcome(page);
  await page.goto('/#/entry/new');
  await page.waitForLoadState('networkidle');
  // `exact` matters: the toolbar above the box is labelled "Formatting for
  // Notes" and getByLabel matches substrings, so a loose match resolves to two
  // elements. keyboard.spec.ts hit the same thing and says so.
  await expect(notesBox(page)).toBeVisible();
}

test('opens at the top, with the heading and the first fields in view', async ({ page }) => {
  await openNewEntry(page, SHORT_PHONE);

  const scrolled = await page.evaluate(() => ({
    window: window.scrollY,
    // Whichever element actually scrolls, if the app scrolls an inner one.
    document: document.scrollingElement?.scrollTop ?? 0,
  }));
  expect(scrolled.window, 'the page opened already scrolled down').toBe(0);
  expect(scrolled.document, 'the scrolling element opened already scrolled down').toBe(0);

  // The three things that were pushed off the top.
  await expect(page.getByRole('heading', { level: 1, name: 'New entry' })).toBeInViewport();
  await expect(page.getByLabel('Kind')).toBeInViewport();
  await expect(page.getByLabel('Title')).toBeInViewport();
});

test('still puts the cursor in the notes box, so writing can start at once', async ({ page }) => {
  // The fix must not cost the thing the focus was there for. A version that
  // simply stopped focusing would satisfy the test above and quietly take away
  // fast capture.
  await openNewEntry(page, PHONE);

  const focusedIsNotes = await notesBox(page).evaluate((el) => el === document.activeElement);
  expect(focusedIsNotes, 'the notes box no longer has the cursor on a new entry').toBe(true);

  // And it is genuinely typable without touching anything first.
  await page.keyboard.type('Straight into the notes.');
  await expect(notesBox(page)).toHaveValue('Straight into the notes.');
});
