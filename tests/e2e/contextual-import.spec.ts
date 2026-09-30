/**
 * The church-note import, per entry kind, in a real browser.
 *
 * The unit suite owns which branch renders. What only a rendered page can
 * answer is whether the quieter control is still a usable one: 44 CSS px of
 * touch target, a real accessible name, a visible focus ring, reachable by
 * keyboard, and not distinguished from its surroundings by colour alone.
 *
 * It exists because `#/entry/new` is a sermon, so before this file the
 * secondary control was rendered by the product and measured by nothing. The
 * view sweep in `views.ts` now visits a prayer editor too, which puts the
 * control in front of axe, the contrast pass and the 320px reflow checks; this
 * spec asserts the parts those cannot judge.
 */

import { expect, test, type Page } from '@playwright/test';

import { dismissWelcome } from './seed';

/** WCAG 2.5.5 asks for 44×44. The button tokens set `min-h-11`, which is 44px. */
const TARGET_MIN = 44;

async function editor(page: Page, hash: string, width = 390) {
  await page.setViewportSize({ width, height: 900 });
  await dismissWelcome(page);
  await page.addInitScript(() => localStorage.setItem('journey:intro', 'closed'));
  await page.goto(`/#${hash}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByLabel('Notes', { exact: true })).toBeVisible({ timeout: 15_000 });
}

test('a sermon keeps the prominent import, with the line that explains it', async ({ page }) => {
  await editor(page, '/entry/new?kind=sermon');

  await expect(page.getByRole('button', { name: 'Import church notes' })).toBeVisible();
  await expect(page.getByText(/A file your church handed out/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Import notes/ })).toHaveCount(0);
});

for (const kind of ['reading', 'prayer', 'reflection'] as const) {
  test(`a ${kind} keeps a quiet import that is still a real target`, async ({ page }) => {
    await editor(page, `/entry/new?kind=${kind}`);

    const quiet = page.getByRole('button', { name: /^Import notes/ });
    await expect(quiet).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import church notes' })).toHaveCount(0);

    // Named by its own text, not by a title attribute or an icon alone.
    await expect(quiet).toHaveAccessibleName(/^Import notes/);

    // 44px, measured on the rendered box rather than inferred from the class.
    const box = await quiet.boundingBox();
    expect(box, 'the quiet import has no layout box').not.toBeNull();
    expect(
      box!.height,
      `the quiet import is ${box!.height}px tall, under the ${TARGET_MIN}px target`,
    ).toBeGreaterThanOrEqual(TARGET_MIN);

    // Keyboard reachable, and visibly so when it has focus.
    await quiet.focus();
    await expect(quiet).toBeFocused();
    const ring = await quiet.evaluate((el) => {
      const s = getComputedStyle(el);
      return { outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, boxShadow: s.boxShadow };
    });
    const visible =
      (ring.outlineStyle !== 'none' && parseFloat(ring.outlineWidth) > 0) ||
      (ring.boxShadow !== 'none' && ring.boxShadow !== '');
    expect(visible, `focused but no visible ring: ${JSON.stringify(ring)}`).toBe(true);

    // And it opens the same review step a sermon gets — one flow, not two.
    await quiet.click();
    await expect(page.getByLabel('Sermon notes file')).toBeVisible();
  });
}

test('the quiet control does not overflow a 320px editor', async ({ page }) => {
  await editor(page, '/entry/new?kind=prayer', 320);

  const quiet = page.getByRole('button', { name: /^Import notes/ });
  await expect(quiet).toBeVisible();

  const box = await quiet.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x, 'the control starts left of the viewport').toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, 'the control runs past 320px').toBeLessThanOrEqual(320);

  // And nothing else it shares a row with pushed the page wide.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the editor scrolls horizontally at 320px').toBeLessThanOrEqual(0);
});
