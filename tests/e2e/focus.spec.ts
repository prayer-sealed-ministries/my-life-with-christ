/**
 * Focus writing mode, in a real browser.
 *
 * The unit suite owns what focus mode does: the chrome goes, the state survives
 * the remount a save causes, Back dismisses it before it navigates. None of
 * that needs a browser. What does is the question the mode exists to answer —
 * whether the writing surface actually GOT the space — and the two ways a
 * chrome-less page can quietly fail a reader: an accessibility tree with no
 * landmark left in it, and a layout that scrolls sideways once the reader's own
 * text size is larger than the one it was designed at.
 *
 * Measured against the built site, like everything else here.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { assertRendered, examinedAtLeast } from './floor';
import { dismissWelcome, forceTheme } from './seed';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Every kind the editor offers, by value and by the word a reader sees. */
const KINDS = [
  { value: 'sermon', label: 'Sermon' },
  { value: 'reading', label: 'Bible reading' },
  { value: 'prayer', label: 'Prayer' },
  { value: 'reflection', label: 'Reflection' },
  { value: 'letter', label: 'Letter' },
] as const;

/**
 * Is the kind control showing its whole value, or part of it?
 *
 * Measured against the browser's own idea of the width that option needs — a
 * clone holding only the selected option, laid out at `max-content`, which
 * includes the padding and the dropdown arrow Chromium draws inside the box.
 * That is the number the element must have, so comparing against it is the
 * question "is this clipped" asked directly rather than inferred from
 * `scrollWidth`, which a <select> does not report usefully.
 */
const kindFit = (page: Page) =>
  page.evaluate(() => {
    const select = document.querySelector('form select') as HTMLSelectElement;
    const text = select.options[select.selectedIndex].text;

    const probe = select.cloneNode(false) as HTMLSelectElement;
    const option = document.createElement('option');
    option.text = text;
    probe.appendChild(option);
    probe.style.cssText = 'position:absolute;visibility:hidden;width:max-content;flex:none';
    document.body.appendChild(probe);
    const needed = Math.ceil(probe.getBoundingClientRect().width);
    probe.remove();

    return { text, needed, actual: Math.round(select.getBoundingClientRect().width) };
  });

/** The writing surface and the page around it, as the browser has laid it out. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const notes = document.querySelector('textarea') as HTMLTextAreaElement | null;
    const box = notes?.getBoundingClientRect();
    return {
      header: !!document.querySelector('header'),
      footer: !!document.querySelector('footer'),
      nav: !!document.querySelector('nav'),
      main: !!document.querySelector('main'),
      h1s: document.querySelectorAll('h1').length,
      notesTop: box ? Math.round(box.top + window.scrollY) : -1,
      notesHeight: box ? Math.round(box.height) : -1,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      viewport: window.innerHeight,
    };
  });

async function openEditor(page: Page, width: number, height = 844) {
  await page.setViewportSize({ width, height });
  await dismissWelcome(page);
  await page.addInitScript(() => localStorage.setItem('journey:intro', 'closed'));
  await page.goto('/#/entry/new');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('textarea').first()).toBeVisible({ timeout: 15_000 });
}

const enterFocus = async (page: Page) => {
  await page.getByRole('button', { name: 'Focus' }).click();
  await expect(page.getByRole('button', { name: 'Leave focus mode' })).toBeVisible();
  await page.waitForTimeout(200);
};

test.describe('what focus mode is for', () => {
  test('gives the writing surface the space the chrome was using', async ({ page }) => {
    await openEditor(page, 390);
    const before = await measure(page);

    expect(before.header, 'there was no chrome to reclaim').toBe(true);
    expect(before.notesTop, 'the editor did not render').toBeGreaterThan(0);

    await enterFocus(page);
    const after = await measure(page);

    expect(after.header, 'the header survived focus mode').toBe(false);
    expect(after.footer, 'the footer survived focus mode').toBe(false);
    expect(after.nav, 'the navigation survived focus mode').toBe(false);

    // The claim, as a number rather than an impression: the notes box starts
    // higher up the page and is visibly bigger than it was.
    expect(after.notesTop, 'the writing surface did not move up').toBeLessThan(before.notesTop);
    expect(
      after.notesHeight,
      'the writing surface did not grow into the space the chrome gave up',
    ).toBeGreaterThan(before.notesHeight);

    // And what it is really about: how much of one phone screen is writing.
    const visible = Math.min(after.notesHeight, after.viewport - after.notesTop);
    expect(
      visible,
      `only ${visible}px of the writing box is on screen in focus mode`,
    ).toBeGreaterThan(before.notesHeight);
  });

  test('is still a page, not a rectangle', async ({ page }) => {
    await openEditor(page, 390);
    await enterFocus(page);
    const after = await measure(page);

    // Removing the header removes a landmark and the banner. `main` and exactly
    // one h1 are what a screen-reader user has left to navigate by, so they are
    // not optional.
    expect(after.main, 'focus mode has no main landmark').toBe(true);
    expect(after.h1s, 'focus mode does not have exactly one h1').toBe(1);

    // The way out, the kind, and Save — all three, all reachable.
    await expect(page.getByRole('button', { name: 'Leave focus mode' })).toBeVisible();
    await expect(page.getByLabel('Kind', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();

    // And it is not Notes only.
    await expect(page.getByLabel('Reflection', { exact: true })).toBeVisible();
    await page.getByText('Details', { exact: true }).click();
    await expect(page.getByLabel('Prayer', { exact: true })).toBeVisible();
  });
});

test.describe('it holds together when squeezed', () => {
  for (const width of [320, 390, 768, 1280]) {
    test(`at ${width}px`, async ({ page }) => {
      await openEditor(page, width);
      await enterFocus(page);
      const after = await measure(page);
      expect(after.overflow, `focus mode scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
      expect(after.notesHeight, `no writing box at ${width}px`).toBeGreaterThan(100);
    });
  }

  test('at the reader’s own doubled text size', async ({ page }) => {
    // The real mechanism, not `html { font-size: 200% }` — media queries cannot
    // see that. See nav-breakpoint.spec.ts for what this cost to learn.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 32 } });

    await openEditor(page, 320);
    await expect(page.locator('html')).toHaveCSS('font-size', '32px');
    await enterFocus(page);

    const after = await measure(page);
    expect(after.overflow, 'focus mode scrolls sideways at doubled text').toBeLessThanOrEqual(1);
  });
});

test.describe('axe-core in focus mode, WCAG 2.1 AA', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`no violations — ${theme}`, async ({ page }) => {
      await forceTheme(page, theme);
      await openEditor(page, 390);
      await enterFocus(page);
      await assertRendered(page, `focus mode (${theme})`);

      // The details panel is where most of this view's controls live, including
      // Prayer. A scan that left it closed would report the mode clean having
      // measured two textareas and a select.
      await page.getByText('Details', { exact: true }).click();
      await page.waitForTimeout(200);

      const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      examinedAtLeast(result.passes.length, 10, 'axe checks that passed in focus mode');
      expect(
        result.violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`).join('\n'),
      ).toBe('');
    });
  }
});

/**
 * The kind control, at the sizes where it stopped being readable.
 *
 * The first version of the focus bar put all three controls on one line at
 * every size. It never overflowed and it passed reflow, so both suites called
 * it clean — and at 320px with the reader's text at 200% the kind control was
 * 110px wide showing "Ser". Nothing was measuring whether the value could
 * still be read, which is the only thing that control is for.
 *
 * So this measures exactly that, for every kind rather than the short one that
 * happens to be the default.
 */
test.describe('the kind control shows what is selected', () => {
  const SIZES = [
    { name: '320px', width: 320, root: 16 },
    { name: '320px at 200% text', width: 320, root: 32 },
    { name: '390px', width: 390, root: 16 },
    { name: '390px at 200% text', width: 390, root: 32 },
  ] as const;

  for (const size of SIZES) {
    test(`in full, every kind — ${size.name}`, async ({ page }) => {
      if (size.root !== 16) {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Page.enable');
        await cdp.send('Page.setFontSizes', { fontSizes: { standard: size.root, fixed: size.root } });
      }
      await openEditor(page, size.width);
      if (size.root !== 16) {
        await expect(page.locator('html')).toHaveCSS('font-size', `${size.root}px`);
      }
      await enterFocus(page);

      const clipped: string[] = [];
      let checked = 0;

      for (const kind of KINDS) {
        await page.locator('form select').first().selectOption(kind.value);
        const fit = await kindFit(page);
        checked += 1;

        expect(fit.text, `the control is not showing ${kind.label}`).toBe(kind.label);
        if (fit.actual < fit.needed) {
          clipped.push(`${kind.label}: needs ${fit.needed}px, has ${fit.actual}px`);
        }

        // And the page still does not scroll sideways with that kind chosen —
        // the longest labels are exactly where that would first go wrong.
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${kind.label} pushed the page sideways at ${size.width}px`).toBeLessThanOrEqual(1);
      }

      examinedAtLeast(checked, KINDS.length, `entry kinds measured at ${size.name}`);
      expect(clipped.join('\n'), `the kind control is clipping its own value at ${size.name}`).toBe('');
    });
  }

  test('keeps both actions reachable, and the bar out of the way', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 32 } });
    await openEditor(page, 320, 760);
    await enterFocus(page);

    // Both actions on screen, both worth aiming at. 44px is the requirement and
    // it is a floor in CSS pixels, so it does not move with the text size.
    for (const name of ['Leave focus mode', 'Save']) {
      const box = await page.getByRole('button', { name }).boundingBox();
      expect(box, `${name} did not render`).not.toBeNull();
      expect(box!.height, `${name} is too short to tap`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `${name} is too narrow to tap`).toBeGreaterThanOrEqual(44);
      expect(box!.y, `${name} is off the top of the screen`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${name} is below the fold`).toBeLessThan(760);
    }

    // The bar is chrome. At the most extreme size it is allowed two lines and
    // no more — the writing surface is what the mode exists to enlarge.
    const bar = await page.locator('form > div').first().boundingBox();
    expect(
      bar!.height / 760,
      `the focus bar is taking ${Math.round((bar!.height / 760) * 100)}% of the screen`,
    ).toBeLessThan(0.35);
  });

  test('takes the keyboard out, kind, save — in that order', async ({ page }) => {
    await openEditor(page, 320);
    await enterFocus(page);
    // Save is disabled on an empty form, and a disabled button is not in the
    // tab order — so an empty editor would "prove" an order that excludes it.
    await page.locator('textarea').first().fill('Something to save.');

    await page.getByRole('button', { name: 'Leave focus mode' }).focus();
    const seen: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press('Tab');
      seen.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          return el.tagName === 'SELECT' ? 'kind' : (el.textContent ?? '').trim();
        }),
      );
    }
    expect(seen, 'the focus bar does not tab in a sensible order').toEqual(['kind', 'Save']);
  });

  test('survives reader-imposed text spacing', async ({ page }) => {
    await openEditor(page, 320);
    await enterFocus(page);

    // WCAG 1.4.12, applied to the one bar this lane changed.
    await page.addStyleTag({
      content:
        '*{line-height:1.5!important;letter-spacing:0.12em!important;word-spacing:0.16em!important}p,li{margin-bottom:2em!important}',
    });
    await page.waitForTimeout(200);

    await page.locator('form select').first().selectOption('reading');
    const fit = await kindFit(page);
    expect(fit.actual, 'the kind control clips with reader text spacing').toBeGreaterThanOrEqual(
      fit.needed,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'text spacing pushes the page sideways').toBeLessThanOrEqual(1);
  });
});
