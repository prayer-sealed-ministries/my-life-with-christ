/**
 * My history with a passage, through the real app.
 *
 * The unit tests own overlap arithmetic, ordering and excerpt choice. These are
 * the user-level promises: a passage gathers the moments attached to it, in the
 * order they happened; a narrower reference narrows honestly; another book with
 * the same chapter number never appears; unfinished writing never appears; and
 * getting there and back does not cost the reader the search they came from.
 *
 * Fixtures are per-test by construction — Playwright gives each test its own
 * browser context, so the IndexedDB seeded here exists only for that test.
 */

import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome, seedEntries } from './seed';
import type { Entry } from '../../src/types';

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

const at = (book: string, cs: number, vs: number, ce = cs, ve = vs) =>
  ({ kind: 'scripture' as const, book, chapterStart: cs, verseStart: vs, chapterEnd: ce, verseEnd: ve });

const CORPUS: Entry[] = [
  entry({
    id: 'ph-reading', kind: 'reading', title: 'Reading the vine', date: '2026-04-12',
    anchors: [at('john', 15, 1, 15, 27)],
    reflection: 'Read it slowly on the back porch.',
  }),
  entry({
    id: 'ph-sermon', kind: 'sermon', title: 'Abiding in Christ', date: '2027-10-08',
    speaker: 'Rev. Dana Okonkwo', anchors: [at('john', 15, 5)],
    reflection: 'I have been striving where I was asked to abide.',
  }),
  entry({
    id: 'ph-prayer', kind: 'prayer', title: 'A prayer to abide', date: '2028-01-20',
    anchors: [at('john', 15, 1, 15, 8)],
    prayer: 'Keep me in the vine.',
  }),
  // Same chapter number, different book. Must never appear for John 15.
  entry({
    id: 'ph-mark', kind: 'sermon', title: 'Mark fifteen, Good Friday', date: '2027-04-02',
    anchors: [at('mark', 15, 5)],
  }),
];

const moments = (page: Page) => page.locator('main article');

async function openHistory(page: Page, reference: string) {
  await page.goto(`/#/history/${encodeURIComponent(reference)}`);
  await page.waitForLoadState('networkidle');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await dismissWelcome(page);
  await seedEntries(page, CORPUS);
});

test('A — a passage gathers its moments, oldest first, each named by its kind', async ({ page }) => {
  await openHistory(page, 'John 15');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My history with John 15');
  await expect(moments(page)).toHaveCount(3);

  // The story's order, not search's order.
  await expect(moments(page).nth(0)).toContainText('Reading the vine');
  await expect(moments(page).nth(1)).toContainText('Abiding in Christ');
  await expect(moments(page).nth(2)).toContainText('A prayer to abide');

  // Every kind present, under the canonical labels.
  await expect(moments(page).nth(0)).toContainText('Reading');
  await expect(moments(page).nth(1)).toContainText('Sermon');
  await expect(moments(page).nth(2)).toContainText('Prayer');

  // Years, in order, with no empty ones invented between them.
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['2026', '2027', '2028']);
  await expect(page.getByText('3 saved moments')).toBeVisible();
});

test('B — a verse narrows to what overlaps it', async ({ page }) => {
  await openHistory(page, 'John 15:5');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My history with John 15:5');
  // The whole chapter and the 1-8 range both contain verse 5; nothing else does.
  await expect(moments(page)).toHaveCount(3);

  await openHistory(page, 'John 15:20');
  // Only the whole-chapter anchor reaches verse 20.
  await expect(moments(page)).toHaveCount(1);
  await expect(moments(page).first()).toContainText('Reading the vine');
});

test('C — another book with the same chapter number never appears', async ({ page }) => {
  await openHistory(page, 'John 15');
  await expect(page.getByText('Mark fifteen, Good Friday')).toHaveCount(0);

  // And it is findable where it belongs, so the absence above is a filter
  // rather than a missing entry.
  await openHistory(page, 'Mark 15');
  await expect(moments(page)).toHaveCount(1);
  await expect(moments(page).first()).toContainText('Mark fifteen, Good Friday');
});

test('D — search survives a trip through history and an entry', async ({ page }) => {
  // A filtered search, so there is real state to lose.
  await page.goto('/#/search?q=Jn%2015&kinds=sermon');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('searchbox')).toHaveValue('Jn 15');

  await page.getByRole('link', { name: 'My history with John 15' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My history with John 15');

  await page.getByRole('link', { name: 'Abiding in Christ' }).click();
  await expect(page).toHaveURL(/#\/entry\/ph-sermon/);

  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My history with John 15');

  await page.goBack();
  // The query AND the advanced filter, both still there.
  await expect(page).toHaveURL(/kinds=sermon/);
  await expect(page.getByRole('searchbox')).toHaveValue('Jn 15');
  await expect(page.getByRole('checkbox', { name: 'Sermon' })).toBeChecked();
});

test('E — an unfinished draft is not part of the history', async ({ page }) => {
  await page.goto('/#/entry/new?kind=prayer');
  await page.getByRole('textbox', { name: 'Notes' }).fill('An unfinished thought about the vine, John 15.');
  await page.waitForTimeout(1200); // past the settle window, so the draft is durable

  await openHistory(page, 'John 15');
  await expect(moments(page)).toHaveCount(3);
  await expect(page.getByText(/unfinished thought/)).toHaveCount(0);
});

test('F — an unwritten passage says so calmly, and offers a way in', async ({ page }) => {
  await openHistory(page, 'Romans 8');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My history with Romans 8');
  await expect(page.getByText(/You haven’t written about Romans 8 yet/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start a Bible reading' })).toBeVisible();
});

test('G — a shorthand reference settles on one canonical address', async ({ page }) => {
  await openHistory(page, 'Jn 15');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My history with John 15');
  // One passage, one address, so a kept link says what it means.
  await expect(page).toHaveURL(/#\/history\/John%2015$/);
});

/**
 * The two surfaces, in one run.
 *
 * "Your entries on this passage" and "My history with …" answer the same
 * question and must include the same entries. They did not: the passage page
 * matched an anchor whose range was byte-for-byte the segment's, so a note on
 * John 15:5 was missing from the passage holding it while the history page
 * listed it. Both now use the one overlap predicate.
 */
test('H — a verse-anchored note appears on the passage AND in its history', async ({ page }) => {
  // Reach the passage holding John 15:5 the way a reader does, so the segment
  // is whichever one this profile divides it into rather than a hardcoded id.
  await page.goto('/#/search?q=John%2015%3A5');
  await page.waitForLoadState('networkidle');
  await page.getByRole('link', { name: /Read it in the King James Version/ }).click();
  await page.waitForLoadState('networkidle');

  const section = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Your entries on this passage' }),
  });

  // ph-sermon is anchored to John 15:5 alone. Before this fix it was absent
  // here unless a segment happened to be exactly John 15:5.
  await expect(section.getByText('Abiding in Christ')).toBeVisible();
  // The whole-chapter reading overlaps the segment too.
  await expect(section.getByText('Reading the vine')).toBeVisible();
  // And the same chapter number in another book never leaks in.
  await expect(section.getByText('Mark fifteen, Good Friday')).toHaveCount(0);

  const onPassage = (await section.locator('article').allInnerTexts()).length;
  expect(onPassage).toBeGreaterThanOrEqual(2);

  // The other surface, same passage, same entries.
  await page.getByRole('link', { name: /^My history with / }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('My history with');
  await expect(moments(page)).toHaveCount(onPassage);
  await expect(page.getByText('Abiding in Christ')).toBeVisible();
  await expect(page.getByText('Reading the vine')).toBeVisible();
  await expect(page.getByText('Mark fifteen, Good Friday')).toHaveCount(0);
});
