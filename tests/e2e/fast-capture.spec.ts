/**
 * Sermon note, now — through the real app.
 *
 * The browser has no launcher shortcut, so what is exercised here is the
 * destination the shortcut selects: the canonical route, opened cold, with
 * nothing between the reader and the first word. The native half is covered by
 * the launch-action tests and by the emulator.
 *
 * Fixtures are per-test: Playwright gives each test its own browser context, so
 * the IndexedDB written here exists only for that test.
 */

import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome } from './seed';

/** The one destination. Written once here; the app reads it from its own table. */
const CAPTURE = '#/entry/new?kind=sermon';

const notes = (page: Page) => page.getByRole('textbox', { name: 'Notes' });

/*
 * Nothing is navigated here on purpose.
 *
 * `dismissWelcome` works by `addInitScript`, which runs on the next document
 * load — and `goto('/')` followed by `goto('/#/entry/new')` is a HASH CHANGE,
 * not a load. Doing it that way left the first-visit dialog open, holding
 * focus on its own button, and every assertion about the caret failed for a
 * reason that had nothing to do with the editor. It also meant the "cold open"
 * was a warm in-page navigation.
 *
 * So the script is installed first and each test performs its own first real
 * navigation, straight to the destination, the way the shortcut does.
 */
test.beforeEach(async ({ page }) => {
  await dismissWelcome(page);
});

test('A — a cold open lands with the cursor already in Notes', async ({ page }) => {
  await page.goto(`/${CAPTURE}`);
  await page.waitForLoadState('networkidle');

  // Focus, not merely visible. On a phone this is what raises the keyboard.
  await expect(notes(page)).toBeFocused();

  // Already a sermon; nothing was chosen.
  await expect(page.getByLabel('Kind')).toHaveValue('sermon');

  // Nothing in the way: no dialog, no chooser, and Details is shut.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const details = page.locator('details').filter({ hasText: 'Details' }).first();
  await expect(details).not.toHaveAttribute('open', /.*/);
});

test('B — typing immediately survives a reopen without pressing Save', async ({ page }) => {
  await page.goto(`/${CAPTURE}`);
  await page.waitForLoadState('networkidle');
  await expect(notes(page)).toBeFocused();

  // Straight into typing, the way a sermon starts.
  const typed = 'He opened on the vine, and said abiding is not striving.';
  await page.keyboard.type(typed);
  await expect(notes(page)).toHaveValue(typed);

  // Past the settle window, so the draft is durable.
  await page.waitForTimeout(1200);

  // The nearest a browser gets to process death: a full reload, never having
  // pressed Save.
  await page.goto('/#/');
  await page.reload();
  await page.waitForLoadState('networkidle');

  // Home is where unfinished work lives.
  const resume = page.getByRole('link', { name: /Continue/ });
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(notes(page)).toHaveValue(typed);
});

/**
 * C — the rule for a second sermon.
 *
 * Two situations, and they are different on purpose.
 *
 * A COLD capture — the process was not running, which is the ordinary case for
 * the next service — opens a blank sermon. The earlier unfinished one keeps its
 * own draft id and is reachable from Home. Nothing is ever overwritten, because
 * a draft id is minted per editor session and never reused.
 *
 * A WARM capture, tapped while the app is already sitting on this very route
 * with half a sermon on screen, leaves the reader where they are. That is the
 * deliberate choice: they are almost certainly still in the service they
 * started, and a blank page appearing under their hands would read as their
 * words having been lost. Their work is durable either way; the way to a fresh
 * sermon is the way it always is, by finishing or leaving this one.
 */
test('C — a cold capture starts a new sermon and leaves the unfinished one intact', async ({ page }) => {
  await page.goto(`/${CAPTURE}`);
  await page.waitForLoadState('networkidle');
  await page.keyboard.type('Last Sunday, unfinished.');
  await page.waitForTimeout(1200);

  // Another service. The process was not running, so this is a real load.
  await page.goto(`/${CAPTURE}`);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(notes(page)).toBeFocused();
  // A blank page, not last week's sermon.
  await expect(notes(page)).toHaveValue('');

  await page.keyboard.type('This Sunday, somewhere else.');
  await page.waitForTimeout(1200);

  // Both survive, and neither overwrote the other.
  //
  // Read from the store rather than from Home, which surfaces the most recent
  // unfinished piece rather than listing every one — asserting against Home
  // would be testing its layout, not the guarantee.
  const drafts = await page.evaluate<Array<{ id: string; notes: string }>>(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('journey');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('drafts', 'readonly').objectStore('drafts').getAll();
          request.onsuccess = () => {
            db.close();
            resolve(
              (request.result as Array<{ id: string; form: { notes: string } }>).map((row) => ({
                id: row.id,
                notes: row.form.notes,
              })),
            );
          };
          request.onerror = () => reject(request.error);
        };
      }),
  );

  expect(drafts).toHaveLength(2);
  expect(new Set(drafts.map((d) => d.id)).size).toBe(2);
  expect(drafts.map((d) => d.notes).sort()).toEqual([
    'Last Sunday, unfinished.',
    'This Sunday, somewhere else.',
  ]);

  // And Home offers a way back to unfinished work.
  await page.goto('/#/');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('link', { name: /Continue/ })).toBeVisible();
});

test('C2 — a warm capture keeps the reader in the sermon they are writing', async ({ page }) => {
  await page.goto(`/${CAPTURE}`);
  await page.waitForLoadState('networkidle');
  await page.keyboard.type('Mid-sentence, still going.');

  // The shortcut again, with the app already here. This is what the native
  // binding does on appUrlOpen: it asks for the same destination.
  await page.evaluate((hash) => window.location.replace(hash), CAPTURE);
  await page.waitForTimeout(300);

  // Their words are still on screen. Nothing was blanked under their hands.
  await expect(notes(page)).toHaveValue('Mid-sentence, still going.');
});

test('D — the ordinary way in still works, and reaches the same place', async ({ page }) => {
  await page.goto('/#/');
  await page.waitForLoadState('networkidle');

  await page.getByRole('link', { name: /Sermon note/ }).click();
  await expect(page).toHaveURL(new RegExp(CAPTURE.replace(/[?]/g, '\\?')));
  await expect(notes(page)).toBeFocused();
  await expect(page.getByLabel('Kind')).toHaveValue('sermon');
});

test('E — explicit Save still works from the fast route', async ({ page }) => {
  await page.goto(`/${CAPTURE}`);
  await page.waitForLoadState('networkidle');
  await page.keyboard.type('Saved properly.');

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
  // Saving a new entry moves to its own address.
  await expect(page).toHaveURL(/#\/entry\/(?!new)/);

  // And the draft retires: nothing unfinished is left behind.
  await page.goto('/#/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByText(/Continue writing/)).toHaveCount(0);
});
