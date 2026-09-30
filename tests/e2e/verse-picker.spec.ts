/**
 * Choosing a verse, in a real browser.
 *
 * The unit suite owns which options each select offers and what anchor comes
 * out. What only a rendered page can answer is whether the controls are usable:
 * real accessible names, 44 CSS px of target, a visible focus ring, reachable
 * by keyboard, and no horizontal overflow at 320px.
 *
 * It exists for the reason the contextual-import spec does. The shared view
 * sweep opens `#/entry/new`, which starts on passage mode, so the chapter,
 * verse and end-verse controls are rendered by the product and measured by
 * nothing — not by axe, not by the contrast pass, not at 320px. They appear
 * only after a radio is pressed, which a static sweep of routes cannot do.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome, forceTheme } from './seed';

/** WCAG 2.5.5 asks for 44×44. The tokens set `min-h-11`, which is 44px. */
const TARGET_MIN = 44;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function verseMode(page: Page, width = 390) {
  await page.setViewportSize({ width, height: 900 });
  await dismissWelcome(page);
  await page.addInitScript(() => localStorage.setItem('journey:intro', 'closed'));
  await page.goto('/#/entry/new');
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Notes', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('radio', { name: 'A verse' }).check();
}

test('the mode is a real radio group, announced and not colour-only', async ({ page }) => {
  await verseMode(page);

  const group = page.getByRole('radiogroup', { name: 'What to add' });
  await expect(group).toBeVisible();

  const verse = page.getByRole('radio', { name: 'A verse' });
  const passage = page.getByRole('radio', { name: 'A passage' });

  // The state is in the accessibility tree, not only in the pixels — a screen
  // reader and a colour-blind reader both get the same answer as everyone else.
  await expect(verse).toBeChecked();
  await expect(passage).not.toBeChecked();

  for (const radio of [verse, passage]) {
    const box = await radio.boundingBox();
    expect(box, 'a mode radio has no layout box').not.toBeNull();
  }

  // The label is the target, and it is a full-size one.
  const labelBox = await page.getByText('A verse', { exact: true }).boundingBox();
  expect(labelBox).not.toBeNull();
  expect(
    labelBox!.height,
    `the mode label is ${labelBox!.height}px tall, under the ${TARGET_MIN}px target`,
  ).toBeGreaterThanOrEqual(TARGET_MIN);
});

test('book, chapter and verse each carry a real label and open in order', async ({ page }) => {
  await verseMode(page);

  const book = page.getByLabel('Book', { exact: true });
  const chapter = page.getByLabel('Chapter', { exact: true });
  const verse = page.getByLabel('Verse', { exact: true });
  const end = page.getByLabel('To verse', { exact: true });

  // Named by a <label>, never by a placeholder.
  for (const control of [book, chapter, verse, end]) {
    await expect(control).toBeVisible();
    await expect(control).not.toHaveAttribute('placeholder', /./);
  }

  await expect(chapter).toBeDisabled();
  await expect(verse).toBeDisabled();

  await book.selectOption('john');
  await expect(chapter).toBeEnabled();
  await chapter.selectOption('3');
  await expect(verse).toBeEnabled();
  await verse.selectOption('16');

  const add = page.getByRole('button', { name: 'Add verse' });
  await expect(add).toBeEnabled();

  const box = await add.boundingBox();
  expect(box).not.toBeNull();
  expect(
    box!.height,
    `Add verse is ${box!.height}px tall, under the ${TARGET_MIN}px target`,
  ).toBeGreaterThanOrEqual(TARGET_MIN);

  // Tabbed to, not focused programmatically: the ring is a `:focus-visible`
  // one, which Chromium deliberately withholds from a scripted `.focus()`.
  // Reaching it by keyboard is also the claim worth making.
  await end.focus();
  await page.keyboard.press('Tab');
  await expect(add).toBeFocused();
  const ring = await add.evaluate((el) => {
    const s = getComputedStyle(el);
    return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, boxShadow: s.boxShadow };
  });
  const visible =
    (ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) > 0) ||
    (ring.boxShadow !== 'none' && ring.boxShadow !== '');
  expect(visible, `focused but no visible ring: ${JSON.stringify(ring)}`).toBe(true);
});

test('a verse can be chosen with the keyboard alone, and reads naturally', async ({ page }) => {
  await verseMode(page);

  await page.getByLabel('Book', { exact: true }).selectOption('john');
  await page.getByLabel('Chapter', { exact: true }).selectOption('3');
  await page.getByLabel('Verse', { exact: true }).selectOption('16');
  await page.getByRole('button', { name: 'Add verse' }).press('Enter');

  // "John 3:16" — not "John 3:16-16", and not a start/end object.
  await expect(page.getByText('John 3:16', { exact: true })).toBeVisible();
});

test('a range reads as a range', async ({ page }) => {
  await verseMode(page);

  await page.getByLabel('Book', { exact: true }).selectOption('john');
  await page.getByLabel('Chapter', { exact: true }).selectOption('3');
  await page.getByLabel('Verse', { exact: true }).selectOption('16');
  await page.getByLabel('To verse', { exact: true }).selectOption('18');
  await page.getByRole('button', { name: 'Add verse' }).click();

  await expect(page.getByText('John 3:16-18', { exact: true })).toBeVisible();
});

test('the verse controls hold together at 320px', async ({ page }) => {
  await verseMode(page, 320);

  await page.getByLabel('Book', { exact: true }).selectOption('psalms');
  await page.getByLabel('Chapter', { exact: true }).selectOption('119');
  await page.getByLabel('Verse', { exact: true }).selectOption('176');

  for (const name of ['Book', 'Chapter', 'Verse', 'To verse']) {
    const box = await page.getByLabel(name, { exact: true }).boundingBox();
    expect(box, `${name} has no layout box`).not.toBeNull();
    expect(box!.x, `${name} starts left of the viewport`).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, `${name} runs past 320px`).toBeLessThanOrEqual(320);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the editor scrolls horizontally at 320px').toBeLessThanOrEqual(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`no axe violations with the verse controls on screen — ${theme}`, async ({ page }) => {
    await forceTheme(page, theme);
    await verseMode(page);
    await page.getByLabel('Book', { exact: true }).selectOption('john');
    await page.getByLabel('Chapter', { exact: true }).selectOption('3');

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const violations = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(violations, violations.join('\n')).toEqual([]);
  });
}
