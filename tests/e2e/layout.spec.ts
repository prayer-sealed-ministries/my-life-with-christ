/**
 * Geometry, measured rather than eyeballed.
 *
 * The complaint that started this pass was that the four cards on the front
 * page "do not feel like one professional component family" — mismatched
 * heights, and a primary card that looked like a different component. None of
 * that is visible to axe, to the contrast walker, or to a unit test: they are
 * all facts about computed boxes on a rendered page, so they are asserted here
 * as computed boxes on a rendered page.
 */

import { expect, test, type Page } from '@playwright/test';

import { examinedAtLeast } from './floor';
import { dismissWelcome, forceTheme } from './seed';

/** The breakpoints the design has to hold at, named so a failure reads. */
const WIDTHS = [
  { name: 'large desktop', width: 1600, columns: 4 },
  { name: 'laptop', width: 1280, columns: 4 },
  { name: 'tablet', width: 834, columns: 4 },
  { name: 'small tablet', width: 640, columns: 2 },
  { name: 'mobile', width: 390, columns: 2 },
  { name: 'narrow', width: 320, columns: 1 },
] as const;

interface Box {
  w: number;
  h: number;
  x: number;
  radius: string;
  pad: string;
  font: string;
  weight: string;
}

async function cardBoxes(page: Page): Promise<Box[]> {
  return page
    .locator('main ul li a')
    .filter({ hasText: /Sermon note|Read Scripture|Topics|Search/ })
    .evaluateAll((els) =>
      els.slice(0, 4).map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        // The title, not the icon: the first span in a card is the icon's
        // container now, and measuring that would compare two 20px squares and
        // call the typography consistent.
        const title = el.querySelector('span > span');
        const ts = title ? getComputedStyle(title) : cs;
        return {
          w: Math.round(r.width),
          h: Math.round(r.height),
          x: Math.round(r.x),
          radius: cs.borderTopLeftRadius,
          pad: `${cs.paddingTop}/${cs.paddingLeft}`,
          font: `${ts.fontSize} ${ts.fontFamily.split(',')[0]}`,
          weight: ts.fontWeight,
        };
      }),
    );
}

test('the four Journey cards are one component family at every width', async ({ page }) => {
  test.setTimeout(120_000);
  await dismissWelcome(page);
  await forceTheme(page, 'light');

  let checked = 0;

  for (const { name, width, columns } of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('#/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(250);

    const boxes = await cardBoxes(page);
    expect(boxes, `${name}: expected four cards`).toHaveLength(4);
    checked += boxes.length;

    const distinct = (pick: (b: Box) => string | number) => new Set(boxes.map(pick)).size;

    // Structure is identical everywhere. These are the things that made the
    // four read as four unrelated boxes.
    expect(distinct((b) => b.w), `${name}: card widths differ`).toBe(1);
    expect(distinct((b) => b.radius), `${name}: border radii differ`).toBe(1);
    expect(distinct((b) => b.pad), `${name}: internal padding differs`).toBe(1);
    expect(distinct((b) => b.font), `${name}: title typography differs`).toBe(1);
    expect(distinct((b) => b.weight), `${name}: title weight differs`).toBe(1);

    expect(distinct((b) => b.x), `${name}: expected ${columns} column(s)`).toBe(columns);

    // Equal heights are a multi-column claim only. Stacked in one column every
    // card is its own grid row, and padding a one-line card out to match a
    // two-line one would waste the scarcest space on the smallest screen.
    if (columns > 1) {
      expect(distinct((b) => b.h), `${name}: card heights differ inside the grid`).toBe(1);
    }

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflows, `${name}: the page scrolls sideways`).toBe(false);
  }

  examinedAtLeast(checked, WIDTHS.length * 4, 'card boxes measured across breakpoints');
});

/**
 * The grid must survive a copy edit.
 *
 * The check above passes today whether or not `auto-rows-fr` is on the grid,
 * and that is a fact about the current wording, not about the layout: two of
 * the four descriptions happen to wrap to two lines, one in each row, so both
 * rows come out equal by coincidence. Removing `auto-rows-fr` as a deliberate
 * sabotage changed nothing and the suite stayed green.
 *
 * So this lengthens a description the way an editor would, and asserts the four
 * are still equal. Measured: with `auto-rows-fr` the heights are 140/140/140/140,
 * without it they are 140/140/118/118.
 */
test('the card grid stays square when a description grows', async ({ page }) => {
  await dismissWelcome(page);
  await forceTheme(page, 'light');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('#/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);

  const heights = await page.evaluate(() => {
    const ul = document.querySelector('main ul');
    if (!ul) return null;
    const descriptions = [...ul.querySelectorAll('li a span:last-child')];
    if (descriptions.length < 4) return null;
    const original = descriptions[0].textContent;
    descriptions[0].textContent =
      'Start writing now. The details can wait until afterwards, and this sentence is ' +
      'deliberately long enough to wrap onto a third line so the first row outgrows the second.';
    const measured = [...ul.querySelectorAll('li a')].map((a) =>
      Math.round(a.getBoundingClientRect().height),
    );
    descriptions[0].textContent = original;
    return measured;
  });

  expect(heights, 'could not find the four cards to measure').not.toBeNull();
  examinedAtLeast(heights!.length, 4, 'cards measured with a lengthened description');
  expect(
    new Set(heights).size,
    `a longer description broke the grid: heights were ${heights!.join(', ')}`,
  ).toBe(1);
});

test('the featured card belongs to the family it leads', async ({ page }) => {
  await dismissWelcome(page);
  await forceTheme(page, 'dark');
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('#/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(250);

  const [featured, ...rest] = await page
    .locator('main ul li a')
    .filter({ hasText: /Sermon note|Read Scripture|Topics|Search/ })
    .evaluateAll((els) =>
      els.slice(0, 4).map((el) => {
        const cs = getComputedStyle(el);
        const px = (c: string) => c.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
        const [r, g, b] = px(cs.backgroundColor);
        return { lum: 0.2126 * r + 0.7152 * g + 0.0722 * b, bg: cs.backgroundColor };
      }),
    );

  const page_ = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  void page_;

  // It must read as distinct from its three siblings…
  expect(featured.bg, 'the featured card is indistinguishable from the others').not.toBe(rest[0].bg);

  // …but not as a different component. In dark mode the old treatment inverted
  // it to a near-white fill, a stark rectangle against a dark page. Anything
  // close to white here is that bug returning.
  expect(
    featured.lum,
    `the featured card is too bright for a dark page (${featured.bg})`,
  ).toBeLessThan(90);
});
