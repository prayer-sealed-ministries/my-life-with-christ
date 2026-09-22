/**
 * Details offered back, through the real app.
 *
 * The unit tests own the derivation rules. These are the promises a person
 * would describe: last week's church is one tap away, the app never fills it
 * in for me, and something I only half-typed never comes back as though I had
 * decided on it.
 *
 * Fixtures are per-test by construction — Playwright gives each test its own
 * browser context, so the IndexedDB seeded here belongs to that test alone.
 */

import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome, seedEntries } from './seed';
import { SAVE_CONFIRMATION } from './save';
import type { Entry } from '../../src/types';

const CAPTURE = '#/entry/new?kind=sermon';

const entry = (overrides: Partial<Entry> & { id: string }): Entry => ({
  kind: 'sermon',
  title: 'A Sunday',
  date: '2026-03-01',
  anchors: [],
  scriptureRefs: [],
  notes: 'Something worth keeping.',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  ...overrides,
});

const notes = (page: Page) => page.getByRole('textbox', { name: 'Notes' });
/**
 * A metadata input, named exactly.
 *
 * Not `getByLabel('Speaker')`: that is a case-insensitive substring match, and
 * a suggestion's accessible name is "Use speaker Pastor James" — so the loose
 * form matches the chip as well as the box and fails on ambiguity. The
 * accessible name is the one that is right; the locator has to be the precise
 * one.
 */
const detailField = (page: Page, label: string) =>
  page.getByRole('textbox', { name: label, exact: true });
const detailsPanel = (page: Page) => page.getByText('Details', { exact: true });

/**
 * Open the Details disclosure, whatever state it is already in.
 *
 * An entry that carries details opens the panel by itself, so a blind click
 * shuts it — and then nothing inside can be seen, which reads exactly like the
 * suggestions never arriving.
 */
async function openDetails(page: Page) {
  // The metadata panel specifically. An entry page carries more than one
  // disclosure, and `details` alone picked whichever came first — which was
  // already open, so this skipped the click and then waited for the wrong
  // element to open.
  const panel = page
    .locator('details')
    .filter({ has: page.getByText('Details', { exact: true }) });

  if ((await panel.getAttribute('open')) === null) {
    await page.getByText('Details', { exact: true }).click();
  }
  await expect(panel, 'the Details panel did not open').toHaveJSProperty('open', true);
}
const chip = (page: Page, spoken: string, value: string) =>
  page.getByRole('button', { name: `Use ${spoken} ${value}` });
/** Every suggestion currently offered for one field, in order. */
const chipsFor = (page: Page, spoken: string) =>
  page.getByRole('button', { name: new RegExp(`^Use ${spoken} `) });

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await dismissWelcome(page);
});

test('A — last week’s speaker is one tap away, and fills nothing in by itself', async ({
  page,
}) => {
  await seedEntries(page, [entry({ id: 'sunday-1', speaker: 'Pastor James' })]);

  await page.goto(`/${CAPTURE}`);
  await page.waitForLoadState('networkidle');
  await openDetails(page);

  // Offered — and the field it belongs to is still empty.
  await expect(chip(page, 'speaker', 'Pastor James')).toBeVisible();
  await expect(detailField(page, 'Speaker')).toHaveValue('');

  await chip(page, 'speaker', 'Pastor James').click();
  await expect(detailField(page, 'Speaker')).toHaveValue('Pastor James');
});

test('B — a series used three Sundays running is offered once', async ({ page }) => {
  await seedEntries(page, [
    entry({ id: 'w1', date: '2026-01-04', sermonSeries: 'James' }),
    entry({ id: 'w2', date: '2026-01-11', sermonSeries: 'Romans' }),
    entry({ id: 'w3', date: '2026-01-18', sermonSeries: 'James' }),
  ]);

  await page.goto(`/${CAPTURE}`);
  await page.waitForLoadState('networkidle');
  await openDetails(page);

  await expect(chipsFor(page, 'series')).toHaveCount(2);
  // Most recently used first: James was the latest Sunday.
  await expect(chipsFor(page, 'series')).toHaveText(['James', 'Romans']);
});

test('C — something only half-typed is never offered back', async ({ page }) => {
  await seedEntries(page, [entry({ id: 'saved', speaker: 'Pastor James' })]);

  // Begin a sermon, put a speaker in it, and walk away without saving. The
  // autosave keeps it as a recovery draft — which is not a decision.
  await page.goto(`/${CAPTURE}`);
  await page.waitForLoadState('networkidle');
  await notes(page).fill('Started only.');
  await openDetails(page);
  await detailField(page, 'Speaker').fill('NEVER-SUGGEST-DRAFT');
  await page.waitForTimeout(1200); // past the settle window, so the draft is durable

  // Away and back. Going straight to the same address is not a navigation at
  // all, and the half-typed page would simply still be sitting there.
  await page.goto('/#/');
  await page.waitForLoadState('networkidle');
  await page.goto(`/${CAPTURE}`);
  await page.waitForLoadState('networkidle');
  await openDetails(page);

  await expect(chip(page, 'speaker', 'Pastor James')).toBeVisible();
  await expect(
    chipsFor(page, 'speaker'),
    'an unfinished draft was offered as though it had been saved',
  ).toHaveText(['Pastor James']);
});

test('D — opening Details on a saved entry and leaving writes nothing', async ({ page }) => {
  await seedEntries(page, [
    entry({ id: 'kept', speaker: 'Rev. Smith', place: 'First Baptist' }),
    entry({ id: 'older', date: '2026-02-01', speaker: 'Pastor James' }),
  ]);

  await page.goto('/#/entry/kept');
  await page.waitForLoadState('networkidle');
  await openDetails(page);
  await expect(chip(page, 'speaker', 'Pastor James')).toBeVisible();

  // The saved values are untouched by the suggestions being there.
  await expect(detailField(page, 'Speaker')).toHaveValue('Rev. Smith');

  await page.goto('/#/');
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByText(/Continue writing/),
    'reading an entry with Details open was mistaken for unfinished work',
  ).toHaveCount(0);
});

test('E — fast capture reaches a focused notes box with no suggestions in sight', async ({
  page,
}) => {
  await seedEntries(page, [entry({ id: 'sunday-1', speaker: 'Pastor James' })]);

  await page.goto(`/${CAPTURE}`);
  await page.waitForLoadState('networkidle');

  // The whole point of the route: writing, immediately.
  await expect(notes(page)).toBeFocused();
  // And nothing has gone looking through the journal to get here.
  await expect(
    chipsFor(page, 'speaker'),
    'suggestions were rendered before anyone asked for Details',
  ).toHaveCount(0);

  // They arrive when asked for, and not before.
  await openDetails(page);
  await expect(chip(page, 'speaker', 'Pastor James')).toBeVisible();
});

test('F — a chosen suggestion saves as an ordinary value', async ({ page }) => {
  await seedEntries(page, [entry({ id: 'sunday-1', speaker: 'Pastor James', place: 'City Gate' })]);

  await page.goto(`/${CAPTURE}`);
  await page.waitForLoadState('networkidle');
  await notes(page).fill('This week, on the narrow gate.');
  await openDetails(page);
  await chip(page, 'speaker', 'Pastor James').click();
  await chip(page, 'place', 'City Gate').click();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/#\/entry\/(?!new)/);
  await expect(page.getByText(SAVE_CONFIRMATION)).toHaveCount(1);

  // Read back out of the journal itself, not off the screen.
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('journey');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<Record<string, unknown>[]>((resolve) => {
      const all = db.transaction('entries', 'readonly').objectStore('entries').getAll();
      all.onsuccess = () => resolve(all.result ?? []);
    });
    db.close();
    return rows.map((row) => ({ speaker: row.speaker, place: row.place, notes: row.notes }));
  });

  expect(stored).toContainEqual({
    speaker: 'Pastor James',
    place: 'City Gate',
    notes: 'This week, on the narrow gate.',
  });
});
