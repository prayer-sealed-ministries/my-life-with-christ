/**
 * Pass B, part three: measure contrast rather than trusting the palette.
 *
 * A palette can be correct in the abstract and still fail on the page, because
 * what matters is the computed colour against the background that actually sits
 * behind it — after inheritance, after opacity, after whichever ancestor ends up
 * painting. So this reads computed styles from the rendered page.
 *
 * Two states get their own attention because they are where this usually goes
 * wrong: placeholder text, which is often set several steps too light, and
 * disabled controls, which are commonly near-invisible.
 *
 * Note on disabled: WCAG 1.4.3 explicitly exempts disabled controls, so a low
 * ratio there is not a conformance failure. It is still measured and reported,
 * because "technically exempt" and "readable" are different claims.
 */

import { expect, test } from '@playwright/test';

import { assertRendered, examinedAtLeast } from './floor';
import { dismissWelcome, forceTheme, seedEntries, seedWithProvidedNotes } from './seed';
import { detectProfile, openDisclosures, resolveViews } from './views';


interface Sample {
  kind: 'text' | 'placeholder' | 'disabled';
  ratio: number;
  required: number;
  sample: string;
  colors: string;
}

/**
 * Runs in the page. Passed as a function rather than a source string so there
 * is no escaping layer to get wrong — an earlier version lost a regex to
 * template-literal escaping and silently measured almost nothing.
 */
function measureContrast(): Sample[] {
  type RGBA = { r: number; g: number; b: number; a: number };

  // Colours are resolved by rasterising one pixel. Tailwind v4 emits oklch(),
  // which getComputedStyle returns verbatim; a regex for rgb() would return
  // null for every themed colour and make dark buttons read as white-on-white.
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
  const luminance = (c: RGBA) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);

  const ratio = (fg: RGBA, bg: RGBA) => {
    const a = luminance(fg) + 0.05;
    const b = luminance(bg) + 0.05;
    return Math.round((Math.max(a, b) / Math.min(a, b)) * 100) / 100;
  };

  /** Composite a translucent colour over what is behind it. */
  const over = (fg: RGBA, bg: RGBA): RGBA => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  /** The colour actually painted behind an element. */
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

  const results: Sample[] = [];
  const seen = new Set<string>();

  const record = (el: Element, kind: Sample['kind'], color: string, size: string, weight: string) => {
    const fg = parse(color);
    if (!fg || fg.a === 0) return;
    const bg = effectiveBg(el);
    const composited = fg.a < 1 ? over(fg, bg) : fg;

    const px = Number.parseFloat(size);
    const isLarge = px >= 24 || (px >= 18.66 && Number(weight) >= 700);
    const required = isLarge ? 3 : 4.5;

    const text = (el.textContent || el.getAttribute('placeholder') || '').trim().slice(0, 48);
    const key = `${kind}|${color}|${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}|${required}`;
    if (seen.has(key)) return;
    seen.add(key);

    results.push({
      kind,
      ratio: ratio(composited, bg),
      required,
      sample: text.replace(/\s+/g, ' '),
      colors: `fg ${color} on bg rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
    });
  };

  const main = document.querySelector('main') ?? document.body;

  for (const el of Array.from(main.querySelectorAll('*'))) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => (n.textContent ?? '').trim())
      .join('');
    if (ownText.length < 2) continue;

    const disabled = el.closest('[disabled], [aria-disabled="true"]');
    record(el, disabled ? 'disabled' : 'text', style.color, style.fontSize, style.fontWeight);
  }

  for (const el of Array.from(main.querySelectorAll('input[placeholder], textarea[placeholder]'))) {
    const style = getComputedStyle(el);
    if (style.display === 'none') continue;
    const ph = getComputedStyle(el, '::placeholder');
    record(el, 'placeholder', ph.color, ph.fontSize || style.fontSize, ph.fontWeight || style.fontWeight);
  }

  for (const el of Array.from(
    main.querySelectorAll('button:disabled, input:disabled, select:disabled, textarea:disabled, [aria-disabled="true"]'),
  )) {
    const style = getComputedStyle(el);
    if (style.display === 'none') continue;
    record(el, 'disabled', style.color, style.fontSize, style.fontWeight);
  }

  return results;
}

for (const theme of ['light', 'dark'] as const) {
  test(`computed contrast — ${theme}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await dismissWelcome(page);
    await forceTheme(page, theme);
    await page.goto('#/');
    await page.waitForLoadState('networkidle');
    // With provided notes and a prayer: those semantic contexts were never
  // rendered by this sweep, which is how a 4.48:1 label went unseen.
  await seedEntries(page, seedWithProvidedNotes());

    console.log(`  data profile under test: ${await detectProfile(page)}`);
    const VIEWS = (await resolveViews(page)).map((target) => target.hash);

    const all: Array<Sample & { view: string }> = [];
    let opened = 0;

    for (const view of VIEWS) {
      await page.goto(view);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(300);
      await assertRendered(page, view);

      // Nothing inside a closed <details> is rendered, so it has no computed
      // colour to sample. The editor folds most of its controls behind one; left
      // shut, this suite measured two textareas and called the editor clean.
      opened += await openDisclosures(page);
      await page.waitForTimeout(200);

      const measured = await page.evaluate(measureContrast);
      // A view that measured no colour pair contributes nothing, and its
      // silence would be indistinguishable from a clean result.
      examinedAtLeast(measured.length, 3, `colour pairs in ${view}`);
      all.push(...measured.map((row) => ({ ...row, view })));
    }

    /*
     * The share surface, which no routed view reaches on its own.
     *
     * It is behind a button on a saved entry, so the sweep above walks past it
     * — and it is a form somebody reads carefully before sending their own
     * writing to another person. Sampled here rather than left to axe, which
     * cannot see a panel that has not been opened.
     */
    await page.goto('#/entry/seed-01');
    await page.waitForLoadState('networkidle');
    const share = page.getByRole('button', { name: 'Share this entry' });
    if (await share.count()) {
      await share.click();
      await expect(page.getByRole('heading', { name: 'Share this entry' })).toBeVisible();
      const shared = await page.evaluate(measureContrast);
      examinedAtLeast(shared.length, 3, 'colour pairs on the share surface');
      all.push(...shared.map((row) => ({ ...row, view: '#/entry/seed-01 (share)' })));
    }

    const failures = all.filter((row) => row.kind !== 'disabled' && row.ratio < row.required);
    const disabledLow = all.filter((row) => row.kind === 'disabled' && row.ratio < 4.5);

    console.log(`  measured ${all.length} distinct colour pairs in ${theme}`);

    // Reported, not failed: WCAG 1.4.3 exempts disabled controls. Printed so
    // leaving them is a decision rather than an oversight.
    if (disabledLow.length > 0) {
      console.log(`  disabled text below 4.5:1 (exempt under 1.4.3, reported for judgement):`);
      for (const row of disabledLow.slice(0, 8)) {
        console.log(`    ${row.ratio}:1  ${row.view}  "${row.sample}"  ${row.colors}`);
      }
    }

    // A check that measured nothing passes vacuously, so say what was sampled.
    const placeholders = all.filter((row) => row.kind === 'placeholder');
    const disabled = all.filter((row) => row.kind === 'disabled');

    // No placeholders is the RIGHT answer, not a gap: every field here carries a
    // real <label>, and placeholder-as-label is the failure this would catch.
    console.log(
      placeholders.length > 0
        ? `  including ${placeholders.length} placeholder samples`
        : '  no placeholder text anywhere — every field uses a real label',
    );
    examinedAtLeast(all.length, 40, 'colour pairs across all views');
    examinedAtLeast(disabled.length, 1, 'disabled controls');
    // The editor has one on each of its two routes. Zero means every colour
    // behind a disclosure went unsampled.
    examinedAtLeast(opened, 2, 'collapsed disclosures opened before sampling');
    console.log(`  including ${disabled.length} disabled-control samples`);

    const report = failures
      .map((row) => `[${row.view}] ${row.kind} ${row.ratio}:1 (needs ${row.required}:1) "${row.sample}" — ${row.colors}`)
      .join('\n');

    expect(report).toBe('');
  });
}
