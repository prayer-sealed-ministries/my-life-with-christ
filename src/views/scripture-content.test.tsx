/**
 * The divisions still say the same thing after being deferred.
 *
 * Section 9 of the lane brief. Moving data out of the startup chunk is only
 * safe if what the reader eventually sees is identical to what they saw
 * before — same headings, same order, same wording, same profile. A refactor
 * that made the app fast by showing less would pass every timing check in this
 * repository.
 *
 * Equivalence against the DATA, never against copied strings. Section headings
 * are re-ingested from the BSB, so a test holding "Jesus and the Samaritan
 * Woman" would be asserting today's ingest rather than the property that
 * matters — and it would have to be rewritten every time the source is
 * refreshed, which is how a check turns into a chore and then into a deletion.
 *
 * Every test here begins with NOTHING loaded. That is the point: the surface
 * has to ask, wait, and then render the real thing. A view that never asked
 * would sit on its waiting state for ever, which is what mutation 4 does.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';

import { __setSectionsLoader, loadSections } from '../app/sections';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { examinedAtLeast } from '../testing/floor';
import { DexieStorageProvider } from '../storage/db';
import BookView from './BookView';
import PassageView from './PassageView';

let counter = 0;

async function show(ui: ReactElement, hash: string) {
  window.location.hash = hash;
  const db = new DexieStorageProvider(`journey-content-${(counter += 1)}`);
  await db.open();
  return render(
    <RouterProvider>
      <StorageContextProvider provider={db}>{ui}</StorageContextProvider>
    </RouterProvider>,
  );
}

beforeEach(() => {
  // Nothing preloaded. Each test starts from the state a cold app is in.
  __setSectionsLoader();
});

afterEach(() => {
  cleanup();
  __setSectionsLoader();
});

describe('a Scripture surface renders the divisions this build ships', () => {
  it('lists every one of a book’s segments, in order, under its own title', async () => {
    await show(<BookView bookId="john" />, '#/book/john');

    // Wait for the divisions to have arrived and been rendered. Waiting on the
    // absence of a spinner would pass the instant the page had not yet painted
    // one, which is a clean result measured before anything happened.
    const links = await screen.findAllByRole('link');

    const { segmentsForBook, segmentTitle } = await loadSections();
    const expected = segmentsForBook('john');

    // A floor: John has divisions under both profiles — outline spans under
    // `public`, twenty-one chapters under `refs-only` — so an empty list here
    // is a broken build, not a profile difference.
    examinedAtLeast(expected.length, 21, 'segments of John');

    const rendered = links.map((link) => link.textContent ?? '');

    const missing = expected.filter(
      (segment) => !rendered.some((text) => text.includes(segmentTitle(segment))),
    );
    expect(missing.map((segment) => segmentTitle(segment))).toEqual([]);
  });

  it('titles a passage exactly as segmentTitle does', async () => {
    const { segmentsForBook, segmentTitle } = await loadSections();
    const target = segmentsForBook('john')[0];
    expect(target).toBeDefined();

    // Reset again: the line above loaded them, and this test is about a view
    // that starts without.
    __setSectionsLoader();

    await show(
      <PassageView bookId="john" segmentId={target.id} />,
      `#/passage/john/${target.id}`,
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        segmentTitle(target),
      ),
    );
  });

  /**
   * The profile, unchanged by any of this.
   *
   * `public` divides John into outline spans; `refs-only` browses it as whole
   * chapters and ships no arrangement at all. Deferring the payload must not
   * have blurred that — it is the licensing line, not a preference.
   */
  it('keeps the profile’s own segmentation', async () => {
    const { segmentsForBook } = await loadSections();
    const john = segmentsForBook('john');
    const { hasOutlines } = await import('../app/data');

    if (hasOutlines) {
      expect(john.some((segment) => segment.kind === 'outline')).toBe(true);
    } else {
      expect(john.every((segment) => segment.kind === 'uncovered')).toBe(true);
      // Whole chapters, and exactly as many as John has.
      expect(john).toHaveLength(21);
    }
  });
});
