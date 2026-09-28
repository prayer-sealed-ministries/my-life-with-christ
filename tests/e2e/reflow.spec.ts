/**
 * The AA success criteria axe does not cover, and that do not need a human.
 *
 *   1.4.10 Reflow         320 CSS px wide, no horizontal scrolling, nothing lost
 *   1.4.4  Resize text    200% text size, nothing lost
 *   1.4.12 Text spacing   reader-imposed line, letter and word spacing, nothing lost
 *
 * All three are "no loss of content or functionality" criteria, which is a
 * harder thing to assert than it sounds: a page can avoid horizontal scrolling
 * by clipping the overflow instead, which passes a naive check while hiding the
 * very content the criterion protects. So both are measured — the page must not
 * scroll sideways AND nothing may be cut off inside it.
 *
 * 320px is the figure the criterion names: 1280 CSS px at 400% zoom reflows to
 * 320. Testing at that width is the standard equivalent.
 */

import { expect, test, type Page } from '@playwright/test';

import { assertRendered, examinedAtLeast } from './floor';
import { dismissWelcome, forceTheme, seedEntries, seedWithProvidedNotes } from './seed';
import { detectProfile, resolveViews } from './views';


/** The reflow width named by 1.4.10. Height is the matching 256 CSS px. */
const REFLOW = { width: 320, height: 256 };

interface Overflow {
  /** Sideways scrolling of the page itself. */
  pageScroll: { scrollWidth: number; clientWidth: number };
  /** Elements cut off by a clipping overflow rather than reflowed. */
  clipped: string[];
  /** Elements sticking out past the viewport. */
  protruding: string[];
  /** How many elements were inspected — a floor against checking nothing. */
  inspected: number;
}

/**
 * Look for lost content.
 *
 * Runs in the page. A container that declares `auto` or `scroll` on the axis is
 * deliberately scrollable and exempt — the criterion allows it for content that
 * genuinely needs two dimensions, which here means wide tables and code.
 */
function findOverflow(): Overflow {
  const describe = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).slice(0, 3).join('.');
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return `${tag}${cls ? `.${cls}` : ''} "${text}"`;
  };

  const clipped: string[] = [];
  const protruding: string[] = [];
  let inspected = 0;

  const viewportWidth = document.documentElement.clientWidth;

  /**
   * Is this element inside a container that scrolls sideways on purpose?
   *
   * 1.4.10 permits two-dimensional content in a scrollable region — the nav
   * bar does exactly that at narrow widths. An item sticking out of a
   * scrollable box is reachable; it is only lost if the PAGE is what has to
   * scroll, which is checked separately.
   */
  const inScrollableRegion = (el: Element): boolean => {
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    return false;
  };

  for (const el of Array.from(document.querySelectorAll('body *'))) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    inspected += 1;

    // Visually-hidden text (the `sr-only` pattern) is a 1px clipped box BY
    // DESIGN — that is how it stays available to a screen reader while taking
    // no space. It is not lost content, it is content deliberately not shown.
    const visuallyHidden = rect.width <= 2 || rect.height <= 2;

    // A text field whose value is longer than the box is not lost content
    // either: the caret scrolls it, which is native and reachable.
    const isFormControl = ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);

    // Content cut off rather than reflowed. `hidden`/`clip` conceal; `auto` and
    // `scroll` are a deliberate, reachable escape hatch and are allowed.
    const clips = style.overflowX === 'hidden' || style.overflowX === 'clip';
    if (clips && !visuallyHidden && !isFormControl && el.scrollWidth > el.clientWidth + 1) {
      clipped.push(`${describe(el)} — ${el.scrollWidth}px of content in a ${el.clientWidth}px box`);
    }

    // Sticking out past the right edge. Fixed and sticky chrome is positioned
    // against the viewport and measured separately by the page scroll check.
    if (
      style.position !== 'fixed' &&
      !visuallyHidden &&
      !inScrollableRegion(el) &&
      rect.right > viewportWidth + 1
    ) {
      protruding.push(`${describe(el)} — right edge at ${Math.round(rect.right)}px of ${viewportWidth}px`);
    }
  }

  return {
    pageScroll: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
    clipped: [...new Set(clipped)].slice(0, 10),
    protruding: [...new Set(protruding)].slice(0, 10),
    inspected,
  };
}

/** The text-spacing overrides a reader may impose, from 1.4.12. */
const TEXT_SPACING_CSS = `
  * {
    line-height: 1.5 !important;
    letter-spacing: 0.12em !important;
    word-spacing: 0.16em !important;
  }
  p, li, h1, h2, h3, h4, blockquote {
    margin-bottom: 2em !important;
  }
`;

async function sweep(page: Page, label: string, views: string[]): Promise<string[]> {
  const problems: string[] = [];
  let totalInspected = 0;

  for (const view of views) {
    await page.goto(view);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(250);

    // Content must still be there. A page that reflows perfectly by rendering
    // nothing would otherwise pass every check below.
    await assertRendered(page, `${view} (${label})`);

    // Expand every disclosure before measuring. A closed <details> still
    // reports a layout box in Chromium, which reads as overflow that no reader
    // can actually see — and, more importantly, its contents are a real state
    // of the page that would otherwise never be measured at all.
    await page.evaluate(() => {
      for (const details of Array.from(document.querySelectorAll('details'))) details.open = true;
    });
    await page.waitForTimeout(150);

    const result = await page.evaluate(findOverflow);
    totalInspected += result.inspected;
    examinedAtLeast(result.inspected, 10, `elements in ${view} (${label})`);

    const { scrollWidth, clientWidth } = result.pageScroll;
    if (scrollWidth > clientWidth + 1) {
      problems.push(
        `[${view}] ${label}: page scrolls sideways — ${scrollWidth}px of content in ${clientWidth}px`,
      );
    }
    for (const item of result.clipped) problems.push(`[${view}] ${label}: content clipped — ${item}`);
    for (const item of result.protruding) problems.push(`[${view}] ${label}: overflows viewport — ${item}`);
  }

  examinedAtLeast(totalInspected, views.length * 10, `elements across all views (${label})`);
  return problems;
}

async function ready(page: Page, theme: 'light' | 'dark'): Promise<string[]> {
  await dismissWelcome(page);
  await forceTheme(page, theme);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('#/');
  await page.waitForLoadState('networkidle');
  // With provided notes: the card that labels somebody else's material is a
  // block of metadata on a raised panel, and it never appeared in this sweep.
  await seedEntries(page, seedWithProvidedNotes());

  console.log(`  data profile under test: ${await detectProfile(page)}`);
  return (await resolveViews(page)).map((target) => target.hash);
}

test.describe('1.4.10 Reflow — 320 CSS px, the width 1280 reflows to at 400% zoom', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`no horizontal scrolling and no lost content — ${theme}`, async ({ page }) => {
      test.setTimeout(240_000);
      const views = await ready(page, theme);
      await page.setViewportSize(REFLOW);

      const problems = await sweep(page, '320px', views);
      expect(problems.join('\n')).toBe('');
    });
  }
});

test.describe('1.4.4 Resize text — 200%', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`nothing is lost at double text size — ${theme}`, async ({ page }) => {
      test.setTimeout(240_000);
      const views = await ready(page, theme);

      // Doubling the root font size scales every rem-based size with it, which
      // is what a browser's text-only zoom does.
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.setViewportSize({ width: 1280, height: 900 });

      const problems = await sweep(page, '200% text', views);
      expect(problems.join('\n')).toBe('');
    });
  }

  test('200% text at 320px — the two criteria together', async ({ page }) => {
    // Neither criterion requires the other, but a reader who needs one usually
    // needs both, and it is the combination that breaks a layout.
    test.setTimeout(240_000);
    const views = await ready(page, 'light');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.setViewportSize(REFLOW);

    const problems = await sweep(page, '200% text @ 320px', views);
    expect(problems.join('\n')).toBe('');
  });
});

test.describe('1.4.12 Text spacing — reader-imposed line, letter and word spacing', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`nothing is lost with spacing overrides — ${theme}`, async ({ page }) => {
      test.setTimeout(240_000);
      const views = await ready(page, theme);
      await page.addStyleTag({ content: TEXT_SPACING_CSS });
      await page.setViewportSize({ width: 1280, height: 900 });

      const problems = await sweep(page, 'text spacing', views);
      expect(problems.join('\n')).toBe('');
    });
  }

  test('text spacing at 320px', async ({ page }) => {
    test.setTimeout(240_000);
    const views = await ready(page, 'light');
    await page.addStyleTag({ content: TEXT_SPACING_CSS });
    await page.setViewportSize(REFLOW);

    const problems = await sweep(page, 'text spacing @ 320px', views);
    expect(problems.join('\n')).toBe('');
  });
});
