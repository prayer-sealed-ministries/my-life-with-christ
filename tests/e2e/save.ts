/**
 * Pressing Save, and waiting for everything the app does about it.
 *
 * Saving a NEW entry ends in a visible route change, so a spec can wait for the
 * address to stop saying `new` and be certain the app has finished. Saving an
 * entry that ALREADY exists ends in a route change to the address it is already
 * on — invisible, unwaitable, and still queued on an animation frame.
 *
 * That gap produced a real intermittent. `search.spec.ts` saved an existing
 * entry, saw the confirmation, and navigated to the search page; the app's own
 * queued navigation then ran and took the browser straight back to the entry.
 * The assertion that followed reported "element(s) not found" for the empty
 * state — which reads exactly like search returning the wrong thing, and was
 * nothing of the kind. Two failures in thirty runs.
 *
 * So: wait for the confirmation, wait for the write to be readable, and wait
 * for the frame the app queued. All three, in that order.
 */

import { expect, type Page } from '@playwright/test';

/**
 * The confirmation the reader actually gets.
 *
 * Anchored on purpose. `getByText('Saved')` is a case-insensitive SUBSTRING
 * match, so it is also satisfied by "Your entry could not be saved: …" — the
 * loose form passes on precisely the failure it is there to rule out. The
 * leading `\W*` covers the tick the pill renders before the word.
 */
const CONFIRMATION = /^\W*Saved$/;

/**
 * Let the frame the app queued actually run.
 *
 * `handleSubmit` defers its navigation by one animation frame so the live
 * region survives long enough to be announced. Two frames are waited rather
 * than one: callbacks queued before this one run before it within the same
 * frame, so a single frame is already sufficient, and the second costs 16ms to
 * remove any argument about ordering.
 */
async function settleQueuedNavigation(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * Save an entry that already exists, and return only once it is really done.
 *
 * `expectStored` names a string that must be readable in the entry's stored
 * record before this returns. The confirmation pill proves the app said so;
 * reading the record proves it. They are different claims, and only the second
 * one is about the journal.
 */
export async function saveExistingEntry(
  page: Page,
  entryId: string,
  expectStored: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(CONFIRMATION)).toBeVisible();

  await expect
    .poll(async () => storedEntryText(page, entryId), {
      message: `the saved record for ${entryId} should contain ${JSON.stringify(expectStored)}`,
    })
    .toContain(expectStored);

  await settleQueuedNavigation(page);
}

/**
 * Every string in one stored entry, joined.
 *
 * Read from IndexedDB rather than from the page: the question is what the
 * journal holds, and the page is the thing under suspicion. Same duplication
 * as `seed.ts`, and for the same reason — the app's own modules are not
 * reachable from in here.
 */
export async function storedEntryText(page: Page, entryId: string): Promise<string> {
  return page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('journey');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const row = await new Promise<unknown>((resolve) => {
      const request = db.transaction('entries', 'readonly').objectStore('entries').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
    db.close();
    return row ? JSON.stringify(row) : '';
  }, entryId);
}
