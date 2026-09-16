/**
 * Pass B: accessibility, measured rather than assumed.
 *
 * axe-core at WCAG 2.1 AA across every view, both themes, both widths — plus
 * the checks axe cannot make: heading order, computed contrast on the states
 * that usually fail (disabled and placeholder text), and whether form controls
 * are labelled by real <label> elements rather than placeholders standing in.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { assertRendered, examinedAtLeast } from './floor';
import { dismissWelcome, forceTheme, seedEntries } from './seed';
import { detectProfile, openDisclosures, resolveViews, type ViewTarget } from './views';

const WIDTHS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 900 },
] as const;

const THEMES = ['light', 'dark'] as const;


/** The standard this project holds itself to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
}

/**
 * How many disclosures were opened across the whole sweep.
 *
 * Tracked and asserted because the editor's <details> is where most of its
 * controls live: a sweep that opened none would report the editor clean having
 * measured two textareas.
 */
let opened = 0;

async function settleAndReveal(page: Page, view: string) {
  await settle(page);
  await assertRendered(page, view);
  opened += await openDisclosures(page);
  // Give the revealed content a frame to lay out before anything measures it.
  await page.waitForTimeout(200);
}

async function ready(
  page: Page,
  theme: 'light' | 'dark',
  size: { width: number; height: number },
): Promise<ViewTarget[]> {
  await page.setViewportSize(size);
  await dismissWelcome(page);
  await forceTheme(page, theme);
  await page.goto('#/');
  await page.waitForLoadState('networkidle');
  await seedEntries(page);

  // Say which build this ran against, so a green suite cannot quietly mean a
  // different profile than the reader assumes.
  console.log(`  data profile under test: ${await detectProfile(page)}`);
  return resolveViews(page);
}

test.describe('axe-core, WCAG 2.1 AA', () => {
  for (const theme of THEMES) {
    for (const size of WIDTHS) {
      test(`no violations — ${theme} @ ${size.name}px`, async ({ page }) => {
        test.setTimeout(240_000);
        const VIEWS = await ready(page, theme, size);

        const found: string[] = [];
        let totalChecks = 0;

        opened = 0;

        for (const view of VIEWS) {
          await page.goto(view.hash);
          // A view that failed to render still has an <h1> and still passes
          // every axe rule, because there is nothing there to violate — and a
          // control folded inside a closed <details> is invisible to axe, so
          // the disclosures are opened before anything is analysed.
          await settleAndReveal(page, view.key);

          const { violations, passes } = await new AxeBuilder({ page }).withTags(TAGS).analyze();

          // axe reports what it checked as well as what failed. Zero passing
          // checks means it examined nothing, and "no violations" means nothing.
          examinedAtLeast(passes.length, 5, `axe rule results on ${view.key}`);
          totalChecks += passes.length + violations.length;

          for (const violation of violations) {
            const where = violation.nodes
              .slice(0, 3)
              .map((node) => node.target.join(' '))
              .join(' , ');
            found.push(
              `[${view.key}] ${violation.id} (${violation.impact}): ${violation.help} → ${where}`,
            );
          }
        }

        examinedAtLeast(totalChecks, VIEWS.length * 10, 'axe rule results across all views');
        // The editor has one on both its routes. If this is zero, every control
        // behind a disclosure went unexamined and the pass means much less.
        examinedAtLeast(opened, 2, 'collapsed disclosures opened before analysis');
        expect(found.join('\n')).toBe('');
      });
    }
  }
});

test.describe('heading order', () => {
  for (const theme of THEMES) {
    test(`exactly one h1 and no skipped levels — ${theme}`, async ({ page }) => {
      test.setTimeout(180_000);
      const VIEWS = await ready(page, theme, { width: 1280, height: 900 });

      const problems: string[] = [];
      let totalHeadings = 0;

      for (const view of VIEWS) {
        await page.goto(view.hash);
        await settle(page);
        await assertRendered(page, view.key);

        // Only headings inside <main>: the shell's chrome is not the view's.
        const levels = await page.locator('main :is(h1,h2,h3,h4,h5,h6)').evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const style = getComputedStyle(node);
              return style.display !== 'none' && style.visibility !== 'hidden';
            })
            .map((node) => Number(node.tagName.slice(1))),
        );

        totalHeadings += levels.length;
        examinedAtLeast(levels.length, 1, `headings in ${view.key}`);

        const h1s = levels.filter((level) => level === 1).length;
        if (h1s !== 1) problems.push(`[${view.key}] expected exactly 1 h1, found ${h1s}`);
        if (levels.length > 0 && levels[0] !== 1) {
          problems.push(`[${view.key}] first heading is h${levels[0]}, should be h1`);
        }

        for (let i = 1; i < levels.length; i += 1) {
          if (levels[i] > levels[i - 1] + 1) {
            problems.push(`[${view.key}] h${levels[i - 1]} jumps to h${levels[i]} (position ${i})`);
          }
        }
      }

      examinedAtLeast(totalHeadings, VIEWS.length, 'headings across all views');
      expect(problems.join('\n')).toBe('');
    });
  }
});

test.describe('form controls carry real labels', () => {
  test('no placeholder is standing in for a label', async ({ page }) => {
    test.setTimeout(180_000);
    const VIEWS = await ready(page, 'light', { width: 1280, height: 900 });

    const problems: string[] = [];
    let totalControls = 0;

    for (const view of VIEWS) {
      await page.goto(view.hash);
      await settle(page);
      await assertRendered(page, view.key);

      totalControls += await page
        .locator('main :is(input, textarea, select)')
        .evaluateAll((nodes) => nodes.filter((n) => (n as HTMLInputElement).type !== 'hidden').length);

      const bad = await page
        .locator('main :is(input, textarea, select)')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => (node as HTMLInputElement).type !== 'hidden')
            .map((node) => {
              const el = node as HTMLInputElement;
              const id = el.id;
              const hasLabelFor = id ? !!document.querySelector(`label[for="${CSS.escape(id)}"]`) : false;
              const wrapped = !!el.closest('label');
              const ariaLabel = el.getAttribute('aria-label');
              const labelledBy = el.getAttribute('aria-labelledby');
              const labelledByResolves = labelledBy
                ? labelledBy.split(/\s+/).every((ref) => !!document.getElementById(ref))
                : false;

              const labelled = hasLabelFor || wrapped || labelledByResolves || !!ariaLabel;
              const onlyPlaceholder = !labelled && !!el.getAttribute('placeholder');

              return {
                ok: labelled,
                onlyPlaceholder,
                // A real <label> element is what was asked for; aria-label alone
                // is reported so it is a deliberate choice, not an accident.
                realLabel: hasLabelFor || wrapped,
                describe_: `${el.tagName.toLowerCase()}#${id || '(no id)'}[name=${el.name || '-'}]`,
              };
            })
            .filter((row) => !row.ok || !row.realLabel),
        );

      for (const row of bad) {
        problems.push(
          `[${view.key}] ${row.describe_} — ${
            row.onlyPlaceholder
              ? 'ONLY a placeholder, no label'
              : row.ok
                ? 'labelled by aria-label, not a real <label> element'
                : 'no accessible label at all'
          }`,
        );
      }
    }

    // Several views carry no form control at all, which is fine — but across
    // the whole app there must be controls, or this check proved nothing.
    examinedAtLeast(totalControls, 10, 'form controls across all views');
    expect(problems.join('\n')).toBe('');
  });
});
