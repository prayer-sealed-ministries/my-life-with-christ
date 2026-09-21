/**
 * Advanced search, through the real app.
 *
 * The unit tests own which entries survive a filter and the route that carries
 * it. These are the promises a person would describe: I can narrow to one kind,
 * I can narrow to two, I can undo it in one action, and narrowing never costs
 * me the words I typed or changes what a result says about itself.
 *
 * Fixtures are per-test by construction — Playwright gives each test its own
 * browser context, so the IndexedDB seeded here exists only for that test and
 * is gone with the context. Nothing is shared and nothing needs clearing.
 */

import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome, seedEntries } from './seed';
import type { Entry } from '../../src/types';

/** Nonsense on purpose: nothing in the Bible, the topics or the seed can match it. */
const TERM = 'quillwright';

const entry = (overrides: Partial<Entry> & { id: string }): Entry => ({
  kind: 'sermon',
  title: '',
  date: '2026-03-01',
  anchors: [],
  scriptureRefs: [],
  notes: '',
  reflection: '',
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  ...overrides,
});

const CORPUS: Entry[] = [
  entry({ id: 'f-sermon', kind: 'sermon', title: `A sermon about ${TERM}` }),
  entry({ id: 'f-prayer', kind: 'prayer', title: `A prayer about ${TERM}` }),

  // Anchored to John 15 and saying so nowhere in their own words.
  entry({
    id: 'f-vine-sermon',
    kind: 'sermon',
    title: 'The vine, preached',
    anchors: [{ kind: 'scripture', book: 'john', chapterStart: 15, verseStart: 1, chapterEnd: 15, verseEnd: 17 }],
  }),
  entry({
    id: 'f-vine-reflection',
    kind: 'reflection',
    title: 'Abiding, afterwards',
    anchors: [{ kind: 'scripture', book: 'john', chapterStart: 15, verseStart: 4, chapterEnd: 15, verseEnd: 5 }],
  }),

  // A sermon whose ONLY connection to the word is the handout.
  entry({
    id: 'f-handout',
    kind: 'sermon',
    title: 'Sunday with a handout',
    notes: 'My own thoughts were elsewhere.',
    sourceMaterial: {
      body: 'Point three: the pelican in the wilderness.',
      importedAt: '2026-02-11T00:00:00.000Z',
      filename: 'handout.md',
      format: 'markdown',
      parserVersion: 1,
    },
  }),
];

const journalResults = (page: Page) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Your journal/ }) })
    .getByRole('listitem');

async function searchFor(page: Page, query: string) {
  await page.goto(`/#/search?q=${encodeURIComponent(query)}`);
  await page.waitForLoadState('networkidle');
}

async function openAdvanced(page: Page) {
  const summary = page.getByText('Advanced search', { exact: false });
  await summary.click();
  await expect(page.getByRole('checkbox', { name: 'Prayer' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await dismissWelcome(page);
  await seedEntries(page, CORPUS);
});

test('A — narrowing to a kind, widening again, and clearing', async ({ page }) => {
  await searchFor(page, TERM);

  // Both kinds to begin with.
  await expect(journalResults(page)).toHaveCount(2);

  await openAdvanced(page);
  await page.getByRole('checkbox', { name: 'Prayer' }).check();

  await expect(journalResults(page)).toHaveCount(1);
  await expect(journalResults(page).first()).toContainText(`A prayer about ${TERM}`);

  // A second kind ADDS; it does not replace.
  await page.getByRole('checkbox', { name: 'Sermon' }).check();
  await expect(journalResults(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(journalResults(page)).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: 'Prayer' })).not.toBeChecked();
  // The query is not a filter.
  await expect(page.getByRole('searchbox')).toHaveValue(TERM);
});

test('B — a kind filter composes with a Scripture query', async ({ page }) => {
  await searchFor(page, 'Jn 15');

  // The sentinel underneath this case: both are found only by their anchors.
  await expect(journalResults(page)).toHaveCount(2);

  await openAdvanced(page);
  await page.getByRole('checkbox', { name: 'Reflection' }).check();

  await expect(journalResults(page)).toHaveCount(1);
  await expect(journalResults(page).first()).toContainText('Abiding, afterwards');
  await expect(journalResults(page).first()).toContainText('Scripture');
  await expect(page.getByText('The vine, preached')).toHaveCount(0);
});

test('C — a kind filter does not change what a result says it matched', async ({ page }) => {
  await searchFor(page, 'pelican');

  await openAdvanced(page);
  await page.getByRole('checkbox', { name: 'Sermon' }).check();

  const result = journalResults(page).first();
  await expect(result).toContainText('Sunday with a handout');
  // Kind and provenance are different questions. Narrowing by the first must
  // not soften the second: this entry IS a sermon, and the words are still
  // somebody else's.
  await expect(result).toContainText('Provided notes');
  await expect(result).toContainText('not in your own writing');
});

test('D — the filter is visible when it is the reason nothing came back', async ({ page }) => {
  await searchFor(page, TERM);
  await openAdvanced(page);
  await page.getByRole('checkbox', { name: 'Service' }).check();

  await expect(page.getByText('No matches in Service.')).toBeVisible();
  // And it does not pretend the words are nowhere in the journal.
  await expect(page.getByText('2 entries of other kinds match.')).toBeVisible();
});
