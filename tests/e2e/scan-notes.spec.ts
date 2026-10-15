/**
 * Scanning, as the deployed web build actually serves it: not at all.
 *
 * There is no on-device text recogniser a browser can promise, and the two
 * alternatives are both refusals — ship a WASM engine, or post somebody's page
 * to a server. So the web edition offers nothing, and this spec checks that
 * against the built artefact rather than against a component in jsdom.
 *
 * It is a small assertion guarding a large mistake. The scanner port is
 * injected, and a default that leaked `supported: true` into the web platform
 * would put a button on the live site that opens a camera, fails, and tells a
 * reader the app is broken. Unit tests pass either way, because they supply
 * their own scanner.
 */
import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome } from './seed';

const EDITOR = '#/entry/new?kind=sermon';

const notes = (page: Page) => page.getByRole('textbox', { name: 'Notes' });

test.beforeEach(async ({ page }) => {
  await dismissWelcome(page);
});

test('the web build offers no Scan notes button', async ({ page }) => {
  await page.goto(`/${EDITOR}`);

  // The floor: prove the editor actually rendered before concluding that
  // something is absent from it. An error page is missing the button too.
  await expect(notes(page)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Title' })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Scan notes' })).toHaveCount(0);
  // Not disabled and not explained away — simply not offered. A control that
  // cannot work reads as a broken feature rather than an absent one.
  await expect(page.getByText(/Scan notes/)).toHaveCount(0);
});

test('nothing in the served bundle reaches a recognition service', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://localhost') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      requests.push(url);
    }
  });

  await page.goto(`/${EDITOR}`);
  await expect(notes(page)).toBeVisible();
  await notes(page).fill('FICTIONAL-SCAN typed, not scanned');
  await page.waitForTimeout(500);

  // v1 makes no network calls at all; this is the scan-shaped version of that
  // rule, and it is measured over the real served page.
  expect(requests).toEqual([]);
});
