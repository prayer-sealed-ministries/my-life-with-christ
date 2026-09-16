/**
 * Import, driven in a real browser against real files.
 *
 * The unit suite proves the parsers; this proves the thing a person actually
 * does — choose a file, look at what was found, and press the button. It also
 * proves the one claim printed on that screen, by watching every request the
 * page makes and failing if a single one leaves this origin.
 */

import { expect, test, type Page } from '@playwright/test';

import { examinedAtLeast } from './floor';
import { writeFixtures } from './import-fixtures';
import { dismissWelcome, forceTheme } from './seed';

const DIR = writeFixtures();

/**
 * Record every request that is not this origin's own asset.
 *
 * The page legitimately loads its own chunks — including the PDF worker, which
 * is bundled precisely so it is same-origin. Anything else is egress.
 */
function watchEgress(page: Page): string[] {
  const offsite: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://localhost:4173') && !url.startsWith('blob:') && !url.startsWith('data:')) {
      offsite.push(url);
    }
  });
  return offsite;
}

async function openImport(page: Page, theme: 'light' | 'dark' = 'light') {
  await dismissWelcome(page);
  await forceTheme(page, theme);
  await page.goto('#/import');
  await page.waitForLoadState('networkidle');
}

const CASES = [
  { file: 'journal.txt', notes: 3, contains: 'Romans 8:28' },
  { file: 'sermons.md', notes: 2, contains: 'Matthew 5:1-12' },
  { file: 'Sunday Sermons 2019.docx', notes: 3, contains: 'Ephesians 2:8-9' },
  { file: 'sermon notes.pdf', notes: 2, contains: 'Romans 8:28' },
] as const;

for (const { file, notes, contains } of CASES) {
  test(`imports ${file} without reaching the network`, async ({ page }) => {
    test.setTimeout(60_000);
    const offsite = watchEgress(page);
    await openImport(page);

    await page.setInputFiles('input[type=file]', `${DIR}/${file}`);
    await expect(page.getByRole('heading', { name: file, exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // What it says it found, before anything is written.
    //
    // Scoped to the summary list: the polite live region repeats this wording
    // by design, so an unscoped query finds two nodes and fails on strictness.
    await expect(
      page.locator('main ul li').filter({ hasText: `${notes} notes found` }),
    ).toBeVisible();
    await expect(page.locator('main p:not(.sr-only)').filter({ hasText: /Nothing has been saved yet/ })).toBeVisible();

    const commit = page.getByRole('button', { name: `Import ${notes} notes` });
    await expect(commit).toBeVisible();
    await commit.click();

    await expect(page.getByRole('heading', { name: 'Imported' })).toBeVisible();
    await expect(
      page.locator('main p:not(.sr-only)').filter({ hasText: `${notes} notes imported.` }),
    ).toBeVisible();

    // The reference the parser found is on a note, not merely in the preview.
    await page.goto('#/timeline');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toContainText(contains.split(' ')[0]);

    expect(offsite, `import reached: ${offsite.join(', ')}`).toEqual([]);
  });
}

test('a scanned PDF is refused in the words the reader needs', async ({ page }) => {
  const offsite = watchEgress(page);
  await openImport(page);
  await page.setInputFiles('input[type=file]', `${DIR}/scanned.pdf`);

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible({ timeout: 30_000 });
  await expect(alert).toContainText('scanned pages rather than selectable text');
  // Not "imported 0 notes", and not a success with nothing in it.
  await expect(page.getByRole('heading', { name: 'Imported' })).toBeHidden();
  expect(offsite).toEqual([]);
});

test('a damaged file is explained without leaking anything internal', async ({ page }) => {
  await openImport(page);
  await page.setInputFiles('input[type=file]', `${DIR}/broken.docx`);

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  const text = (await alert.innerText()).trim();
  expect(text).toMatch(/damaged|not a readable/i);
  // No stack frame, no file path, no byte offset.
  expect(text).not.toMatch(/\.ts:\d|at \w+ \(|RangeError|byte \d/);
});

test('nothing is written until the button is pressed', async ({ page }) => {
  await openImport(page);

  const count = async () =>
    page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open('journey');
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('entries')) {
              db.close();
              resolve(0);
              return;
            }
            const request = db.transaction('entries').objectStore('entries').count();
            request.onsuccess = () => {
              db.close();
              resolve(request.result);
            };
          };
          open.onerror = () => resolve(-1);
        }),
    );

  await page.setInputFiles('input[type=file]', `${DIR}/sermons.md`);
  await expect(page.getByRole('heading', { name: 'sermons.md' })).toBeVisible();

  // Parsed, reviewed, edited — and the journal is still empty.
  await page.getByRole('button', { name: 'Review' }).first().click();
  await page.getByLabel(/^Title for /).fill('Edited before commit');
  expect(await count()).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('File to import')).toBeVisible();
  expect(await count()).toBeLessThanOrEqual(0);
});

/**
 * One test per theme, not one test looping over both.
 *
 * A second pass inside one test hung on `setInputFiles`: navigating to
 * `#/import` while already there does not remount the view, so it was still
 * showing the review screen and the file input did not exist. A fresh page per
 * theme is both simpler and a more honest reproduction of a real visit.
 */
for (const theme of ['light', 'dark'] as const) {
  test(`the review screen works from the keyboard in ${theme} mode`, async ({ page }) => {
    await openImport(page, theme);
    await page.setInputFiles('input[type=file]', `${DIR}/sermons.md`);
    await expect(page.getByRole('heading', { name: 'sermons.md' })).toBeVisible();

    // Every control reachable by Tab, every one showing a visible focus ring.
    let reached = 0;
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const outline = Number.parseFloat(style.outlineWidth) || 0;
        return {
          name: el.getAttribute('aria-label') || el.textContent?.slice(0, 30) || el.tagName,
          ring: (outline > 0 && style.outlineStyle !== 'none') || style.boxShadow !== 'none',
        };
      });
      if (!state) continue;
      expect(state.ring, `no visible focus on ${state.name} (${theme})`).toBe(true);
      reached += 1;
    }
    examinedAtLeast(reached, 8, `focusable controls reached on the review screen (${theme})`);
  });
}

test('the review screen reflows on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openImport(page);
  await page.setInputFiles('input[type=file]', `${DIR}/Sunday Sermons 2019.docx`);
  await expect(page.getByRole('heading', { name: 'Sunday Sermons 2019.docx' })).toBeVisible();
  await page.getByRole('button', { name: 'Review' }).first().click();

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflows, 'the review screen scrolls sideways at 320px').toBe(false);
});
