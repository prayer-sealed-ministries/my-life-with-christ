/**
 * Importing church sermon notes, in a real browser, against the built site.
 *
 * The unit suite owns the parsers and the separation of fields. What only a
 * rendered page can answer is whether the whole path works with a real file
 * input, a real PDF engine loaded as its own chunk, a real save, a real export
 * and a real restore — and whether at every step the church's material is
 * still visibly somebody else's.
 *
 * Fixtures are written to a temporary directory at run time from the same
 * builders the unit tests use. Nothing here is committed as a binary and
 * nothing here is in the shipped artefact; `verify:bundle` checks the second
 * claim against the build.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { examinedAtLeast } from './floor';
import { dismissWelcome } from './seed';
import {
  JSON_MALFORMED,
  JSON_NOTES,
  SCANNED_PDF_NOTES,
  TEXT_PDF_NOTES,
  TXT_NOTES,
} from '../../src/import/sermon-notes-fixtures';

/** Every fixture on disk, once, for the whole file. */
const dir = mkdtempSync(join(tmpdir(), 'journey-sermon-notes-'));
writeFileSync(join(dir, 'handout.txt'), TXT_NOTES);
writeFileSync(join(dir, 'sermon-notes.json'), JSON_NOTES);
writeFileSync(join(dir, 'broken.json'), JSON_MALFORMED);
writeFileSync(join(dir, 'handout.pdf'), TEXT_PDF_NOTES, 'latin1');
writeFileSync(join(dir, 'scanned.pdf'), SCANNED_PDF_NOTES, 'latin1');

const file = (name: string) => join(dir, name);

async function newEntry(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 900 });
  await dismissWelcome(page);
  await page.addInitScript(() => localStorage.setItem('journey:intro', 'closed'));
  await page.goto('/#/entry/new');
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Notes', { exact: true })).toBeVisible({ timeout: 15_000 });
}

async function choose(page: Page, name: string) {
  await page.getByRole('button', { name: 'Import church notes' }).click();
  await page.getByLabel('Sermon notes file').setInputFiles(file(name));
}

/**
 * The preview's own fact list.
 *
 * Scoped, because the panel also announces what it read to a live region and
 * an unscoped `getByText` matches both. Two matches is the check being vague
 * about which half of the page it is looking at.
 */
const previewFact = (page: Page, value: string) =>
  page.locator('section[aria-labelledby="sermon-notes-import-heading"] dd').filter({ hasText: value });

/** The provided-notes section on the entry, scoped so nothing else can match. */
const providedSection = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Provided notes' }) });

const entryCount = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('journey');
        request.onerror = () => reject(new Error('could not open the journal'));
        request.onsuccess = () => {
          const db = request.result;
          const count = db.transaction('entries').objectStore('entries').count();
          count.onsuccess = () => {
            resolve(count.result);
            db.close();
          };
          count.onerror = () => reject(new Error('could not count entries'));
        };
      }),
  );

test.describe('A — a plain text handout', () => {
  test('previews, becomes provided notes, and saves beside the reader’s own', async ({ page }) => {
    await newEntry(page);
    await choose(page, 'handout.txt');

    // The preview: what is about to happen, before it happens.
    await expect(page.getByRole('button', { name: 'Use these notes' })).toBeVisible();
    await expect(previewFact(page, 'handout.txt')).toBeVisible();
    expect(await entryCount(page), 'a preview created an entry').toBe(0);

    await page.getByRole('button', { name: 'Use these notes' }).click();

    const provided = providedSection(page);
    await expect(provided).toBeVisible();
    await expect(provided).toContainText('Seek first the kingdom.');
    await expect(provided).toContainText('Not your own writing.');

    // The reader's own boxes are untouched.
    await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Reflection', { exact: true })).toHaveValue('');

    await page.getByLabel('Notes', { exact: true }).fill('He said storing up is not trusting.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/#\/entry\/(?!new)/, { timeout: 15_000 });

    // Reopened from storage, both halves are still there and still apart.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(providedSection(page)).toContainText('Seek first the kingdom.');
    await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
      'He said storing up is not trusting.',
    );
  });
});

test.describe('B — a structured sermon-notes file', () => {
  test('carries the title, church, speaker and scripture it stated', async ({ page }) => {
    await newEntry(page);
    await choose(page, 'sermon-notes.json');

    await expect(previewFact(page, 'City Gate Church')).toBeVisible();
    await expect(previewFact(page, 'Pastor John Smith')).toBeVisible();
    await expect(previewFact(page, 'Matthew 6:19-34')).toBeVisible();

    await page.getByRole('button', { name: 'Use these notes' }).click();

    await expect(providedSection(page)).toContainText('Provided by City Gate Church');
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
      'Setting Godly Priorities',
    );

    await page
      .getByLabel('Reflection', { exact: true })
      .fill('I have been storing up for years.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/#\/entry\/(?!new)/, { timeout: 15_000 });

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel('Reflection', { exact: true })).toHaveValue(
      'I have been storing up for years.',
    );
    await expect(providedSection(page)).toContainText('Provided by City Gate Church');
  });
});

test.describe('C — a PDF, and what survives an export and a restore', () => {
  test('extracts the text, saves it, and finds it again after a round trip', async ({ page }) => {
    test.setTimeout(120_000);
    await newEntry(page);
    await choose(page, 'handout.pdf');

    await expect(page.getByRole('button', { name: 'Use these notes' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/from 2 pages/)).toBeVisible();

    await page.getByRole('button', { name: 'Use these notes' }).click();
    await expect(providedSection(page)).toContainText('seek first the kingdom');
    await page.getByLabel('Notes', { exact: true }).fill('Mine, written afterwards.');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/#\/entry\/(?!new)/, { timeout: 15_000 });

    // The canonical record, read out of the page rather than out of a file the
    // browser cannot hand back: the archive is built from exactly this.
    const journey = await page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const request = indexedDB.open('journey');
          request.onerror = () => reject(new Error('could not open the journal'));
          request.onsuccess = () => {
            const db = request.result;
            const all = db.transaction('entries').objectStore('entries').getAll();
            all.onsuccess = () => {
              resolve(JSON.stringify(all.result));
              db.close();
            };
            all.onerror = () => reject(new Error('could not read entries'));
          };
        }),
    );
    const entries = JSON.parse(journey) as Array<Record<string, unknown>>;
    examinedAtLeast(entries.length, 1, 'stored entries read back');

    const stored = entries[0];
    const material = stored.sourceMaterial as Record<string, unknown>;
    expect(material, 'the PDF text was not stored').toBeTruthy();
    expect(String(material.body)).toContain('seek first the kingdom');
    expect(material.format).toBe('pdf');
    expect(String(material.sha256)).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.notes, 'the PDF leaked into the reader’s notes').toBe(
      'Mine, written afterwards.',
    );

    // Restore: the journal page reads an archive back. Feed it the record it
    // just produced and check the material comes back whole.
    await page.goto('/#/data');
    await page.waitForLoadState('networkidle');
    const archive = JSON.stringify({
      format: 'journey-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
    });
    const restorePath = join(dir, 'journey.json');
    writeFileSync(restorePath, archive);
    await page.getByLabel('Journal file to read').setInputFiles(restorePath);

    await expect(page.getByRole('button', { name: /^(Merge|Import)/ })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /^(Merge|Import)/ }).click();
    await expect(page.getByText(/imported|merged/i).first()).toBeVisible({ timeout: 20_000 });

    await page.goto(`/#/entry/${String(stored.id)}`);
    await page.waitForLoadState('networkidle');
    await expect(providedSection(page)).toContainText('seek first the kingdom');
    await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
      'Mine, written afterwards.',
    );
  });
});

test.describe('D — changing your mind', () => {
  test('creates nothing when the import is cancelled', async ({ page }) => {
    await newEntry(page);
    await page.getByRole('button', { name: 'Import church notes' }).click();
    await expect(page.getByLabel('Sermon notes file')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Sermon notes file')).toHaveCount(0);

    expect(await entryCount(page), 'cancelling created an entry').toBe(0);
    await expect(page.getByRole('heading', { name: 'Provided notes' })).toHaveCount(0);
  });
});

test.describe('E — a file that cannot be used', () => {
  test('says what is wrong, and creates nothing', async ({ page }) => {
    await newEntry(page);
    await choose(page, 'broken.json');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/not valid JSON/i);
    expect(await entryCount(page), 'a failed import created an entry').toBe(0);
    await expect(page.getByRole('button', { name: 'Use these notes' })).toHaveCount(0);
  });

  test('explains a PDF it could read nothing from, and writes nothing', async ({ page }) => {
    /*
      Scanned pages ARE read now — on a phone, by the device's own recogniser.
      The browser has none, so this fixture reaches the end of every path there
      is and produces nothing, which is what this asserts.

      The wording changed with the feature: it says what happened rather than
      naming a capability, because the person's next step is the same whether
      the page was blank, too faint, or on a device that cannot read pictures.
      Claiming "recognition is not available yet" is simply no longer true.
    */
    test.setTimeout(90_000);
    await newEntry(page);
    await choose(page, 'scanned.pdf');

    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText('No readable text was found in this PDF');
    await expect(alert).toContainText('a clearer copy may work better');
    // And nothing it says is a promise this app no longer keeps.
    await expect(alert).not.toContainText('not available yet');
    expect(await entryCount(page)).toBe(0);
  });
});

test.describe('it works at the sizes people actually use', () => {
  for (const width of [320, 390]) {
    test(`the import panel holds together at ${width}px`, async ({ page }) => {
      await newEntry(page, width);
      await choose(page, 'sermon-notes.json');
      await expect(page.getByRole('button', { name: 'Use these notes' })).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `the import panel scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);

      await page.getByRole('button', { name: 'Use these notes' }).click();
      await expect(providedSection(page)).toBeVisible();

      const after = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(after, `the provided notes scroll sideways at ${width}px`).toBeLessThanOrEqual(1);
    });
  }
});
