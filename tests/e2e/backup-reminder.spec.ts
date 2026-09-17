/**
 * The backup reminder interval, in a real browser.
 *
 * The unit tests prove the decision and the wiring. What only a running app can
 * answer is whether the choice survives leaving the page and closing the app —
 * a preference held in React state alone would pass every unit test and be gone
 * by morning.
 *
 * The second test is the behavioural one: the same journal, the same export
 * date, and the reminder appears or does not according to the interval alone.
 * It moves the export date rather than the clock, so no test waits a month.
 */

import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome, seedEntries, seedSettings, SEED_ENTRIES } from './seed';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const interval = (page: Page, days: number) =>
  page.getByRole('radio', { name: new RegExp(`^${days} days`) });

/**
 * Choose an interval and wait for it to stick.
 *
 * `check()` asserts the state in the same tick as the click, and these radios
 * are controlled by a value that comes back from storage — so for a frame the
 * click is undone and `check()` calls it a failure. Clicking and then waiting
 * is both closer to what a person does and the only honest way to watch an
 * asynchronous write land.
 */
async function choose(page: Page, days: number) {
  await interval(page, days).click();
  await expect(interval(page, days)).toBeChecked();
}

const FOOTER_WARNING = /The copy on this device is not a backup — export your journal/;

/**
 * The timed banner on the journal page — not the footer.
 *
 * Located by its own heading and its Dismiss button. A regex for "not a
 * backup" looked right and matched the permanent footer link on every page,
 * so it could never be absent and the test could never have failed.
 */
const reminderBanner = (page: Page) =>
  page.getByText('Back up your journal', { exact: true });

async function openSettings(page: Page) {
  await page.goto('/#/settings');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
}

test('remembers the chosen interval across navigation and a restart', async ({ page }) => {
  await dismissWelcome(page);
  await openSettings(page);

  // The default, before anyone has chosen anything.
  await expect(interval(page, 30), 'the default is not 30 days').toBeChecked();
  for (const days of [7, 14, 60, 90]) {
    await expect(interval(page, days)).not.toBeChecked();
  }

  await choose(page, 7);

  // Away, and back.
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1, name: 'Life With Christ' })).toBeVisible();
  await openSettings(page);
  await expect(interval(page, 7), 'the choice was lost on navigating away').toBeChecked();

  // And a full reload — the app closing and opening again.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(interval(page, 7), 'the choice did not survive a reload').toBeChecked();
  await expect(interval(page, 30)).not.toBeChecked();

  // Whatever was chosen, the permanent warning is untouched. It is the one
  // sentence no preference may quiet.
  await expect(page.getByText(FOOTER_WARNING)).toBeVisible();
});

test('the chosen interval decides whether the reminder is due', async ({ page }) => {
  await dismissWelcome(page);
  await page.goto('/');
  await seedEntries(page, SEED_ENTRIES.slice(0, 3));

  // Twenty days since an export: inside the default window, outside a 14-day one.
  await seedSettings(page, { lastExportAt: daysAgo(20), backupReminderDays: 30 });

  await page.goto('/#/timeline');
  await expect(page.getByRole('heading', { level: 1, name: 'My journey' })).toBeVisible();
  await expect(
    reminderBanner(page),
    'the reminder appeared inside the chosen interval',
  ).toBeHidden();

  // Nothing about the journal changes — only how often the reader asked to be told.
  await openSettings(page);
  await choose(page, 14);

  await page.goto('/#/timeline');
  await expect(page.getByRole('heading', { level: 1, name: 'My journey' })).toBeVisible();
  await expect(
    reminderBanner(page),
    'the shorter interval did not bring the reminder forward',
  ).toBeVisible();

  // And back out again, the other way.
  await openSettings(page);
  await choose(page, 60);
  await page.goto('/#/timeline');
  await expect(page.getByRole('heading', { level: 1, name: 'My journey' })).toBeVisible();
  await expect(
    reminderBanner(page),
    'the longer interval did not send the reminder away',
  ).toBeHidden();

  // The footer says the same thing throughout, at the longest interval offered.
  await expect(page.getByText(FOOTER_WARNING)).toBeVisible();
});

test('stays usable at 320px with text doubled', async ({ page }) => {
  await dismissWelcome(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await openSettings(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

  // Every option reachable, and the page not pushed sideways by the widest one.
  for (const days of [7, 14, 30, 60, 90]) {
    await interval(page, days).scrollIntoViewIfNeeded();
    await expect(interval(page, days)).toBeVisible();
  }

  await choose(page, 90);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the reminder options pushed the page sideways').toBeLessThanOrEqual(1);
});
