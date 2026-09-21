/**
 * Finding something you half remember, through the real app.
 *
 * The unit tests own ranking arithmetic. These are the user-level promises: a
 * remembered phrase finds the right Sunday, a Scripture shorthand finds a
 * passage the prose never names, a church handout is never passed off as the
 * reader's own writing, and unfinished work stays out of finished history.
 */

import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome, seedEntries } from './seed';
import { saveExistingEntry } from './save';
import { expectSearchState, formatReport } from './search-report';
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

const CORPUS: Entry[] = [
  entry({
    id: 'old-anxiety',
    date: '2019-11-03',
    title: 'The week before the surgery',
    // `anaesthetist` is scenario D's marker, and it is a real word from a real
    // sentence rather than a token bolted on for a test. It is here rather
    // than reusing "worrying" because that word has a near neighbour in this
    // same corpus — `recent-mentions-worry` says "worry" — and the ranker's
    // fuzzy tier allows two edits on a token this long. The distance happens
    // to be three, so it does not match today; a marker whose correctness
    // rests on an off-by-one in an unrelated constant is not a marker.
    notes: 'I kept worrying about what would happen after the operation. The anaesthetist was kind about it.',
  }),
  entry({
    id: 'recent-mentions-worry',
    date: '2026-08-02',
    title: 'A calm Sunday',
    notes: 'Nothing much to worry about this week.',
  }),
  entry({
    id: 'vine',
    date: '2022-05-15',
    title: 'The vine and the branches',
    notes: 'Abiding is not striving.',
    anchors: [{ kind: 'scripture', book: 'john', chapterStart: 15, verseStart: 1, chapterEnd: 15, verseEnd: 17 }],
  }),
  entry({
    id: 'handout',
    date: '2024-02-11',
    title: 'Sunday with a handout',
    notes: 'My own thoughts were elsewhere.',
    sourceMaterial: {
      body: 'Point two: peace in the middle of uncertainty.',
      importedAt: '2024-02-11T00:00:00.000Z',
      filename: 'handout.md',
      format: 'markdown',
      parserVersion: 1,
    },
  }),
];

async function searchFor(page: Page, query: string) {
  await page.goto(`/#/search?q=${encodeURIComponent(query)}`);
  await page.waitForLoadState('networkidle');
  // A hash route can be taken back off this page by work the app had already
  // queued, and every assertion after that point describes the wrong screen.
  // Cheap to check, and it names the address it actually ended up on.
  await expect(page, 'the app navigated away from the search page').toHaveURL(/#\/search/);
}

/** The journal results, located by their own heading rather than by markup shape. */
const journalResults = (page: Page) =>
  page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /Your journal/ }) })
    .getByRole('listitem');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await dismissWelcome(page);
  await seedEntries(page, CORPUS);
});

test('A — a half-remembered phrase finds the right Sunday, not the recent one', async ({ page }) => {
  await searchFor(page, 'worrying about what would happen');

  await expect(journalResults(page).first()).toContainText('The week before the surgery');
});

/**
 * B, and the suite's freshness sentinel.
 *
 * This case is the one that distinguishes this engine from the one it
 * replaced: the old search read a blob of an entry's own words and never
 * looked at its anchors, so a purely anchored passage was unfindable. That
 * makes it the behaviour a stale bundle gets wrong first, and it is exactly
 * how the stale-preview incident presented — ordinary text search working,
 * every Scripture query returning nothing, looking for all the world like a
 * defect in the new code.
 *
 * Build identity (tests/e2e/global-setup.ts) is what actually prevents that
 * now. This is the behavioural backstop underneath it: if the digest check
 * were ever removed or weakened, this test would still go red against old
 * bytes rather than passing quietly.
 */
test('B — a Scripture shorthand finds an entry the prose never names', async ({ page }) => {
  // The sentinel is only a sentinel while the entry's own words really do not
  // name the passage. Asserted rather than assumed: an innocent edit to the
  // corpus above could turn this into an ordinary text match, and it would
  // still pass while having stopped testing anchors altogether.
  const vine = CORPUS.find((candidate) => candidate.id === 'vine');
  const ownWords = [vine?.title, vine?.notes, vine?.reflection, ...(vine?.scriptureRefs ?? [])]
    .join(' ')
    .toLowerCase();
  expect(ownWords, 'the vine entry now names the passage in prose').not.toMatch(/john|jn|15/);
  expect(vine?.anchors.length, 'the vine entry is no longer anchored').toBeGreaterThan(0);

  await searchFor(page, 'Jn 15');

  const result = journalResults(page).first();
  await expect(result).toContainText('The vine and the branches');
  // Found BY the anchor, and said so. Without this the test would pass on any
  // accidental match and stop distinguishing the two engines.
  await expect(result).toContainText('Scripture');
});

test('C — a word only the church handout used says so', async ({ page }) => {
  await searchFor(page, 'uncertainty');

  const result = journalResults(page).first();
  await expect(result).toContainText('Sunday with a handout');
  await expect(result).toContainText('Provided notes');
  await expect(result).toContainText('not in your own writing');
});

test('E — an unfinished draft never reaches historical search', async ({ page }) => {
  // Start writing, leave it unsaved; the autosave keeps it as a draft.
  await page.goto('/#/entry/new?kind=sermon');
  await page.getByRole('textbox', { name: 'Notes' }).fill('A unique marker: kestrel over the field.');
  await page.waitForTimeout(1200); // past the settle window, so the draft is durable

  await searchFor(page, 'kestrel');
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
});

/** What the entry can be found by before the edit, and after it. */
const BEFORE = 'anaesthetist';
const AFTER = 'kingfisher';

test('D — editing an entry changes what it can be found by', async ({ page }) => {
  /*
   * The markers are only markers while they are unique, so that is asserted
   * rather than assumed.
   *
   * Without this the interesting half of the test can pass vacuously: if
   * `BEFORE` were in no entry at all, "nothing matches it afterwards" would be
   * true before anything was edited, and the case would be measuring nothing.
   * The other direction matters just as much — a second entry carrying the
   * same word would make the same assertion fail for a reason that has nothing
   * to do with editing.
   */
  const carrying = (term: string) =>
    CORPUS.filter((candidate) => JSON.stringify(candidate).toLowerCase().includes(term));
  expect(carrying(BEFORE).map((e) => e.id), `${BEFORE} must belong to exactly one entry`).toEqual([
    'old-anxiety',
  ]);
  expect(carrying(AFTER), `${AFTER} must be new to the journal`).toHaveLength(0);

  // The floor: the entry really is findable by the old word. Everything below
  // is about that stopping, and it can only mean something if it started.
  await searchFor(page, BEFORE);
  await expect(journalResults(page).first()).toContainText('The week before the surgery');

  await page.goto(`/#/entry/old-anxiety`);
  await page.getByRole('textbox', { name: 'Notes' }).fill(`Replaced entirely: a ${AFTER} on the bank.`);
  /*
   * Not just "the pill appeared".
   *
   * Saving an entry that already exists ends in a queued navigation to the
   * address the browser is already on — invisible, and still able to fire
   * after this test has navigated somewhere else. It did, twice in thirty
   * runs, and took the browser back to the entry; the search assertion below
   * then failed against the editor. See tests/e2e/save.ts.
   */
  await saveExistingEntry(page, 'old-anxiety', AFTER);

  // Nothing matches the old word — and the report proves the reason, by
  // naming any entry or draft whose fields still hold it.
  await searchFor(page, BEFORE);
  const gone = await expectSearchState(page, BEFORE, 'nothing-matches');
  expect(
    gone.entriesHoldingTerm,
    `${BEFORE} survives somewhere the edit did not reach:\n${formatReport(gone)}`,
  ).toEqual([]);
  expect(gone.draftsHoldingTerm, `a draft still holds ${BEFORE}`).toEqual([]);

  await searchFor(page, AFTER);
  await expect(journalResults(page).first()).toContainText(AFTER);
});
