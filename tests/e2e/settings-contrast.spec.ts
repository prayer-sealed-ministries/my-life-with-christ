/**
 * Contrast inside a chosen Settings row, measured on the rendered page.
 *
 * This exists because the full suite found the defect and the full suite takes
 * seven minutes. A selected row paints `--accent-soft` behind its text, and the
 * hint inside it was muted ink: 3.69:1 in dark, against the 4.5:1 AA requires.
 * Both Settings groups had it — the theme hints and the reminder's "default"
 * marker — because both are the same kind of row.
 *
 * It measures what is actually painted rather than looking for a class name. A
 * test that asserted `text-ink-soft` were present would pass whatever that
 * class resolved to, which is exactly the failure it is supposed to catch: the
 * class was there before, and the colour behind it was the problem.
 *
 * Colours are rasterised through a canvas rather than parsed, for the reason
 * `contrast.spec.ts` gives: Tailwind v4 emits `oklch()`, and a regex for
 * `rgb()` returns null for every themed colour and reports white-on-white.
 */

import { expect, test, type Page } from '@playwright/test';

import { examinedAtLeast } from './floor';
import { dismissWelcome, forceTheme } from './seed';

interface Measured {
  label: string;
  ratio: number;
  required: number;
  colors: string;
}

/**
 * Measure every piece of text inside one Settings row.
 *
 * Runs in the page, and is passed as a function so there is no escaping layer
 * between here and the browser.
 */
function measureRow(inputSelector: string): Measured[] {
  type RGBA = { r: number; g: number; b: number; a: number };

  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;
  const ctx = probe.getContext('2d', { willReadFrequently: true })!;

  const parse = (value: string): RGBA | null => {
    if (!value || value === 'transparent' || value === 'none') return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  };

  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance = (c: RGBA) =>
    0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (fg: RGBA, bg: RGBA) => {
    const a = luminance(fg) + 0.05;
    const b = luminance(bg) + 0.05;
    return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
  };
  const over = (fg: RGBA, bg: RGBA): RGBA => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  /** Whatever colour is genuinely painted behind this text. */
  const effectiveBg = (el: Element): RGBA => {
    let node: Element | null = el;
    let acc: RGBA | null = null;
    while (node) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) {
        acc = acc ? over(acc, bg) : bg;
        if (acc.a >= 1) return acc;
      }
      node = node.parentElement;
    }
    return acc && acc.a >= 1 ? acc : { r: 255, g: 255, b: 255, a: 1 };
  };

  // The row is the radio's parent. Resolved here rather than marked from the
  // test: an earlier version tagged the row with an attribute in one call and
  // measured it in another, and left tags behind, so later rows measured the
  // first one. The floor caught it.
  const row = document.querySelector(inputSelector)?.parentElement;
  if (!row) return [];

  const out: Measured[] = [];
  for (const el of row.querySelectorAll('span, label')) {
    // Only nodes that paint their own text, so a wrapper is not counted twice.
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    if (!ownText) continue;

    const style = getComputedStyle(el);
    const fg = parse(style.color);
    if (!fg || fg.a === 0) continue;
    const bg = effectiveBg(el);
    const composited = fg.a < 1 ? over(fg, bg) : fg;

    const px = Number.parseFloat(style.fontSize);
    const isLarge = px >= 24 || (px >= 18.66 && Number(style.fontWeight) >= 700);

    out.push({
      label: ownText.replace(/\s+/g, ' ').slice(0, 40),
      ratio: ratio(composited, bg),
      required: isLarge ? 3 : 4.5,
      colors: `fg ${style.color} on bg rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
    });
  }
  return out;
}

async function openSettings(page: Page) {
  await page.goto('/#/settings');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
}

/** The reminder rows: one chosen, one not. */
const REMINDER_CHOSEN = '#reminder-7';
const REMINDER_OTHER = '#reminder-30';

for (const theme of ['light', 'dark'] as const) {
  test(`every Settings option stays readable, chosen or not — ${theme}`, async ({ page }) => {
    await dismissWelcome(page);
    await forceTheme(page, theme);
    await openSettings(page);

    // Choose the theme row matching the theme under test. Choosing the other one
    // would switch the app's theme out from under the measurement: an earlier
    // version always picked Dark, so the "light" case measured dark and the two
    // cases were the same test twice.
    const chosenTheme = `#theme-${theme}`;
    const otherTheme = theme === 'dark' ? '#theme-light' : '#theme-dark';
    await page.locator(chosenTheme).click();
    await expect(page.locator(chosenTheme)).toBeChecked();
    await page.locator(REMINDER_CHOSEN).click();
    await expect(page.locator(REMINDER_CHOSEN)).toBeChecked();

    // The theme really is the one asked for, so the ratios below are that
    // theme's ratios and not the other one's.
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const rows = {
      themeChosen: chosenTheme,
      themeOther: otherTheme,
      reminderChosen: REMINDER_CHOSEN,
      reminderOther: REMINDER_OTHER,
    };

    const failures: string[] = [];
    let examined = 0;

    for (const [name, input] of Object.entries(rows)) {
      const samples = await page.evaluate(measureRow, input);
      // Per row as well as in total: a row that stopped matching would other-
      // wise hide inside a healthy-looking grand total.
      examinedAtLeast(samples.length, 1, `text samples in the ${name} row (${theme})`);
      examined += samples.length;
      for (const sample of samples) {
        if (sample.ratio < sample.required) {
          failures.push(
            `${name} "${sample.label}" ${sample.ratio}:1 (needs ${sample.required}:1) — ${sample.colors}`,
          );
        }
      }
    }

    // A floor. Every assertion here is "the list of problems is empty", which
    // an empty measurement satisfies perfectly — and a selector that matched
    // nothing is exactly how this check would rot.
    //
    // Seven is the real count, not a round number: an option name and a hint in
    // each theme row, the "30 days" name and its "default" marker, and the name
    // of the 7-day row. It was set to eight first, and the floor said so.
    examinedAtLeast(examined, 7, `text samples across four Settings rows (${theme})`);
    expect(failures.join('\n'), `contrast inside Settings rows — ${theme}`).toBe('');
  });
}

test('the chosen row is visibly distinct without relying on :has()', async ({ page }) => {
  // `:has()` reached WebKit in iOS 15.4 and this app supports iOS 15.0, so the
  // selected row's own styling must not depend on it. Measured rather than read
  // off a class list: what matters is that the row actually paints differently.
  await dismissWelcome(page);
  await openSettings(page);

  const backgroundOf = (id: string) =>
    page.evaluate(
      (selector) => getComputedStyle(document.querySelector(selector)!.parentElement!).backgroundColor,
      id,
    );

  await page.locator(REMINDER_CHOSEN).click();
  await expect(page.locator(REMINDER_CHOSEN)).toBeChecked();

  const chosen = await backgroundOf(REMINDER_CHOSEN);
  const other = await backgroundOf(REMINDER_OTHER);
  expect(chosen, 'the chosen row paints no differently from the rest').not.toBe(other);

  // And the stylesheet itself carries no :has() for these rows.
  const usesHas = await page.evaluate(() =>
    [...document.styleSheets].some((sheet) => {
      try {
        return [...sheet.cssRules].some(
          (rule) => rule.cssText.includes(':has(') && rule.cssText.includes('checked'),
        );
      } catch {
        return false;
      }
    }),
  );
  expect(usesHas, 'a :has(:checked) rule is back in the stylesheet').toBe(false);
});
