/**
 * The list of views to sweep, resolved against the build actually under test.
 *
 * Hardcoding `#/passage/matthew/matthew-5-1-12` tied the whole suite to the
 * `full` data profile: under `refs-only` there are no outline divisions, so
 * that id names nothing and the view renders a graceful "passage not found".
 * Graceful is right for a reader following an old link — but as a test target
 * it meant the suite swept a not-found page and reported it clean.
 *
 * Worse, nothing said which profile was under test. `dist/` holds whatever was
 * built last, so the same command tested different things depending on what had
 * run before it.
 *
 * So the passage is discovered from the running build, and the profile is
 * reported rather than assumed.
 */

import { expect, type Page } from '@playwright/test';

export interface ViewTarget {
  key: string;
  hash: string;
}

export type DataProfile = 'full' | 'public' | 'refs-only';

const PROFILES: DataProfile[] = ['full', 'public', 'refs-only'];

/**
 * Which data profile the build under test carries — read, not inferred.
 *
 * This used to count passage links on the Matthew page and return `refs-only`
 * if there were exactly 28 and `full` otherwise. That has two profiles in it
 * and there are three, so a `public` build reported itself as `full`: the
 * suite printed a profile name that was simply wrong, which is worse than
 * printing nothing. The build now stamps the answer on the root element and
 * this reads it back, failing loudly if it is missing or unrecognised rather
 * than falling back to a default.
 */
export async function detectProfile(page: Page): Promise<DataProfile> {
  await page.goto('#/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });

  const stamped = await page.locator('html').getAttribute('data-data-profile');
  expect(
    stamped,
    'the build did not stamp data-data-profile on <html> — cannot say what is under test',
  ).toBeTruthy();
  expect(PROFILES, `unrecognised data profile ${stamped}`).toContain(stamped);
  return stamped as DataProfile;
}

/**
 * A passage hash that exists in this build.
 *
 * Read from the book page rather than constructed, so it is correct under
 * either profile and stays correct if the segmentation ever changes again.
 */
export async function resolvePassageHash(page: Page, bookId = 'matthew'): Promise<string> {
  await page.goto(`#/book/${bookId}`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });

  const links = page.locator(`main a[href^="#/passage/${bookId}/"]`);
  const count = await links.count();
  expect(count, `no passage links on the ${bookId} page — the build may be broken`).toBeGreaterThan(0);

  // The fifth, where there is one: the first entry of a book is often an
  // introduction or genealogy, and a mid-book passage exercises more of the
  // view (previous/next links, topic chips, existing entries).
  const href = await links.nth(Math.min(4, count - 1)).getAttribute('href');
  expect(href, 'passage link had no href').toBeTruthy();
  return href!;
}

/**
 * Open every collapsed disclosure in the page before measuring it.
 *
 * A closed `<details>` renders none of its content, so axe skips it and the
 * contrast walker has nothing to sample. The entry editor folds almost
 * everything optional away behind one — date, place, speaker, series, tags,
 * links, prayer, the passage picker and the topic picker — which meant the
 * accessibility pass was sweeping the two textareas and calling the editor
 * clean. Ten controls were never looked at.
 *
 * Returns how many it opened, so a caller can assert it actually found them
 * rather than trusting a sweep that silently opened nothing.
 */
export async function openDisclosures(page: Page): Promise<number> {
  return page.evaluate(() => {
    const closed = [...document.querySelectorAll('main details:not([open])')];
    for (const node of closed) (node as HTMLDetailsElement).open = true;
    return closed.length;
  });
}

/** Every view, with the passage resolved against the running build. */
export async function resolveViews(page: Page): Promise<ViewTarget[]> {
  const passage = await resolvePassageHash(page);

  return [
    { key: 'home', hash: '#/' },
    { key: 'browse', hash: '#/browse' },
    { key: 'book', hash: '#/book/matthew' },
    { key: 'passage', hash: passage },
    { key: 'topics', hash: '#/topics' },
    { key: 'topic', hash: '#/topic/anxiety' },
    { key: 'timeline', hash: '#/timeline' },
    { key: 'search', hash: '#/search?q=whitfield' },
    { key: 'entry-edit', hash: '#/entry/seed-01' },
    { key: 'entry-new', hash: '#/entry/new' },
    { key: 'data', hash: '#/data' },
    { key: 'legacy', hash: '#/legacy' },
  ];
}
