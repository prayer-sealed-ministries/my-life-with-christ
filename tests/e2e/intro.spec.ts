/**
 * The home introduction, in a real browser at the sizes that break things.
 *
 * The unit tests cover the disclosure's behaviour. What only a rendered page can
 * answer is whether the toggle is still reachable and the prose still readable
 * when text is doubled on a 320px screen — the width where a control that looks
 * fine on a laptop ends up off the side of the page.
 */

import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome } from './seed';

const NARROW = { width: 320, height: 640 };
const PHONE = { width: 390, height: 780 };

const toggle = (page: Page) => page.getByRole('button', { name: /what is this/i });
const INTRO = /A place to read the Bible and keep what you hear/;

async function arrive(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await dismissWelcome(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

test('is open on a first visit and closed on the next one', async ({ page }) => {
  await arrive(page, PHONE);

  // `arrive` navigates twice — once to record the welcome flag, once to land —
  // so the introduction has already had its first showing by now. Clearing the
  // key and reloading is what makes the next load a genuine first visit rather
  // than the third one.
  await page.evaluate(() => localStorage.removeItem('journey:intro'));
  await page.reload();
  await page.waitForLoadState('networkidle');

  // First arrival: the explanation is there to be read.
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText(INTRO)).toBeVisible();

  await page.reload();
  await page.waitForLoadState('networkidle');

  // Second arrival: out of the way, one tap from returning.
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText(INTRO)).toBeHidden();

  await toggle(page).click();
  await expect(page.getByText(INTRO)).toBeVisible();
});

test('never collapses the durability warning', async ({ page }) => {
  await arrive(page, PHONE);
  await toggle(page).click(); // collapse the introduction

  // The sentence a person must not be able to tidy away lives in the footer of
  // every page, and is not part of this disclosure.
  await expect(
    page.getByText(/The copy on this device is not a backup/i),
  ).toBeVisible();
});

test('stays usable at 320px with text doubled', async ({ page }) => {
  await arrive(page, NARROW);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

  const button = toggle(page);
  await expect(button).toBeVisible();

  // Entirely on screen: a toggle whose label runs off the side cannot be read,
  // and one below an unreachable fold cannot be pressed.
  const box = await button.boundingBox();
  expect(box, 'the toggle did not render').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(NARROW.width + 1);

  await button.click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the introduction pushed the page sideways').toBeLessThanOrEqual(1);
});
