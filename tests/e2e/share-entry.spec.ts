/**
 * Sharing one page of the journal, through the real app.
 *
 * The unit tests own the rendering rules. These are the promises a person
 * would describe: I can send this morning's notes to a friend, my prayer does
 * not go with them unless I say so, the church's handout is labelled as
 * theirs, and nothing else I have ever written is anywhere near it.
 *
 * The system share sheet itself is not driven here — a browser cannot open
 * one, and an emulator test is where that belongs. What is driven is
 * everything up to it: the selection, and the exact text the app is about to
 * hand over.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome, forceTheme, seedEntries } from './seed';
import { examinedAtLeast } from './floor';
import type { Entry } from '../../src/types';

const NOTES = 'NOTESMARKER vinedresser prunes the branch';
const REFLECTION = 'REFLECTIONMARKER what this asked of me';
const PRAYER = 'PRAYERMARKER keep me abiding';
const PROVIDED = 'PROVIDEDMARKER city gate outline';
/** A second entry, whose marker must never appear in a share of the first. */
const OTHER = 'OTHERENTRYMARKER a different sunday entirely';

const SUBJECT = 'share-subject';
const OTHER_ID = 'share-other';

const base = (overrides: Partial<Entry> & { id: string }): Entry => ({
  kind: 'sermon',
  title: 'Abiding in Christ',
  date: '2026-03-01',
  anchors: [],
  scriptureRefs: ['John 15:1-17'],
  notes: NOTES,
  reflection: REFLECTION,
  prayer: PRAYER,
  links: [],
  tags: [],
  forDescendants: false,
  visibility: 'private',
  createdAt: '2026-03-01T10:00:00.000Z',
  updatedAt: '2026-03-01T10:00:00.000Z',
  ...overrides,
});

const WITH_HANDOUT: Partial<Entry> = {
  sourceMaterial: {
    format: 'pdf',
    filename: 'handout.pdf',
    importedAt: '2026-03-01T09:00:00.000Z',
    body: PROVIDED,
    parserVersion: 1,
  },
};

/** Seed two entries, open the first, and open its share surface. */
async function openShare(page: Page, extra: Partial<Entry> = {}): Promise<void> {
  await page.goto('/');
  await dismissWelcome(page);
  await seedEntries(page, [
    base({ id: SUBJECT, ...extra }),
    base({ id: OTHER_ID, title: 'Another Sunday', notes: OTHER, reflection: '', prayer: '' }),
  ]);

  await page.goto(`/#/entry/${SUBJECT}`);
  await page.getByRole('button', { name: 'Share this entry' }).click();
  await expect(page.getByRole('heading', { name: 'Share this entry' })).toBeVisible();
}

/** What the app is about to hand over, as the reader can read it. */
function preview(page: Page) {
  return page.locator('pre');
}

const box = (page: Page, name: RegExp) => page.getByRole('checkbox', { name });

test('A — notes and reflection go, the prayer stays behind', async ({ page }) => {
  await openShare(page);

  // Reflection is off by default — rule 5 — so this is the reader choosing it.
  await box(page, /My reflection/).check();

  await expect(preview(page)).toContainText(NOTES);
  await expect(preview(page)).toContainText(REFLECTION);
  await expect(preview(page)).not.toContainText(PRAYER);

  // And the prayer switch is genuinely there to be chosen.
  await expect(box(page, /^Prayer/)).not.toBeChecked();
});

test('B — the church’s handout goes only when chosen, and is labelled', async ({ page }) => {
  await openShare(page, WITH_HANDOUT);

  await expect(preview(page)).not.toContainText(PROVIDED);

  await box(page, /Provided notes/).check();
  await expect(preview(page)).toContainText('Provided notes');
  await expect(preview(page)).toContainText(PROVIDED);

  // Never presented as the reader's own writing.
  const text = (await preview(page).innerText()).replace(/\s+/g, ' ');
  expect(text.indexOf('Provided notes')).toBeLessThan(text.indexOf(PROVIDED));
  expect(text.indexOf('My notes')).toBeLessThan(text.indexOf('Provided notes'));
});

test('C — no other entry is anywhere near it, whatever is ticked', async ({ page }) => {
  await openShare(page, WITH_HANDOUT);

  for (const name of [/My reflection/, /^Prayer/, /Provided notes/, /Links/]) {
    const control = box(page, name);
    if (await control.isEnabled()) await control.check();
  }

  await expect(preview(page)).toContainText(NOTES);
  // The other entry exists in this journal and must not be in this share.
  await expect(preview(page)).not.toContainText(OTHER);
  await expect(preview(page)).not.toContainText('Another Sunday');
  // Nor anything of the record around it.
  await expect(preview(page)).not.toContainText(SUBJECT);
  await expect(preview(page)).not.toContainText('2026-03-01T10:00');
});

test('D — cancelling changes nothing', async ({ page }) => {
  await openShare(page);
  await box(page, /^Prayer/).check();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Share this entry' })).toHaveCount(0);

  // The entry is exactly as it was: still two entries, still the same words.
  const stored = await page.evaluate(async () => {
    const open = indexedDB.open('journey');
    const db: IDBDatabase = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const all: unknown[] = await new Promise((resolve, reject) => {
      const request = db.transaction('entries').objectStore('entries').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return all as Array<{ id: string; notes: string; prayer?: string }>;
  });

  expect(stored).toHaveLength(2);
  const subject = stored.find((row) => row.id === SUBJECT);
  expect(subject?.notes).toBe(NOTES);
  expect(subject?.prayer).toBe(PRAYER);
});

test('E — an entry with unsaved changes is not shared behind the reader’s back', async ({
  page,
}) => {
  await openShare(page);
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Type something and let the crash-safe draft land.
  await page.getByRole('textbox', { name: 'Notes' }).fill(`${NOTES} — and one more thought`);
  await expect(page.getByText(/Save your changes first/)).toBeVisible({ timeout: 15_000 });

  // Sharing the saved version silently would send an older page than the one
  // on screen; sharing the draft would send something never committed to.
  await expect(page.getByRole('button', { name: 'Share this entry' })).toBeDisabled();
});

/**
 * The share surface is a form somebody has to read carefully before pressing
 * send, so it gets the same treatment as every other view: axe at AA, in both
 * themes, at the width of a phone and at 200% text.
 *
 * Covered here rather than in a11y.spec.ts because it is behind a button — the
 * sweep over the twelve routed views never opens it, and a control that axe
 * cannot see passes every rule by not existing.
 */
test.describe('the share surface is usable by everybody', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`no axe violations — ${theme}`, async ({ page }) => {
      // The suite's own helper, not a bare emulateMedia: it sets the stored
      // theme as well as the OS preference, and the app reads the stored one
      // first. Half of that produced a page in a state the app never actually
      // renders, and an axe failure that was an artefact of the harness.
      await forceTheme(page, theme);
      await page.setViewportSize({ width: 390, height: 800 });
      await openShare(page, WITH_HANDOUT);

      const { violations, passes } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      // A clean result over nothing examined is not a clean result.
      examinedAtLeast(passes.length, 5, `axe rule results on the share surface (${theme})`);

      // Named with the element, not just the rule. "color-contrast failed" sends
      // somebody hunting; "color-contrast on .text-ink-muted" is a fix.
      const described = violations.flatMap((violation) =>
        violation.nodes.map(
          (node) => `${violation.id} on ${node.target.join(' ')} :: ${node.html}`,
        ),
      );
      expect(described).toEqual([]);
    });
  }

  test('every switch is named, reachable and hittable', async ({ page }) => {
    await openShare(page, WITH_HANDOUT);

    const boxes = page.getByRole('checkbox');
    const count = await boxes.count();
    examinedAtLeast(count, 6, 'share switches');

    for (let index = 0; index < count; index += 1) {
      const control = boxes.nth(index);
      // A real accessible name, not a placeholder or a bare icon.
      const name = await control.evaluate((node) => {
        const label = (node as HTMLInputElement).labels?.[0];
        return label?.textContent?.trim() ?? '';
      });
      expect(name.length, `switch ${index} has a name`).toBeGreaterThan(2);

      // 44px of something to press, which is the label rather than the box.
      const box = await control.evaluate((node) => {
        const label = (node as HTMLInputElement).labels?.[0];
        const rect = label?.getBoundingClientRect();
        return rect ? { height: rect.height } : null;
      });
      expect(box?.height ?? 0, `switch ${index} target height`).toBeGreaterThanOrEqual(44);
    }
  });

  test('it holds together at 320px and at 200% text', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openShare(page, WITH_HANDOUT);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });

    // 1.4.10: no horizontal scrolling of the page itself.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Share and Cancel are both still there to be found.
    await expect(page.getByRole('button', { name: /Share as PDF/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });
});
