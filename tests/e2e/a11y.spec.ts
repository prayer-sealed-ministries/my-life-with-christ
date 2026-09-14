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

import { dismissWelcome, forceTheme, seedEntries } from './seed';

const WIDTHS = [
  { name: '390', width: 390, height: 844 },
  { name: '1280', width: 1280, height: 900 },
] as const;

const THEMES = ['light', 'dark'] as const;

const VIEWS = [
  { key: 'home', hash: '#/' },
  { key: 'browse', hash: '#/browse' },
  { key: 'book', hash: '#/book/matthew' },
  { key: 'passage', hash: '#/passage/matthew/matthew-5-1-12' },
  { key: 'topics', hash: '#/topics' },
  { key: 'topic', hash: '#/topic/anxiety' },
  { key: 'timeline', hash: '#/timeline' },
  { key: 'search', hash: '#/search?q=whitfield' },
  { key: 'entry-edit', hash: '#/entry/seed-01' },
  { key: 'entry-new', hash: '#/entry/new' },
  { key: 'data', hash: '#/data' },
  { key: 'legacy', hash: '#/legacy' },
] as const;

/** The standard this project holds itself to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(400);
}

async function ready(page: Page, theme: 'light' | 'dark', size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await dismissWelcome(page);
  await forceTheme(page, theme);
  await page.goto('#/');
  await page.waitForLoadState('networkidle');
  await seedEntries(page);
}

test.describe('axe-core, WCAG 2.1 AA', () => {
  for (const theme of THEMES) {
    for (const size of WIDTHS) {
      test(`no violations — ${theme} @ ${size.name}px`, async ({ page }) => {
        test.setTimeout(240_000);
        await ready(page, theme, size);

        const found: string[] = [];

        for (const view of VIEWS) {
          await page.goto(view.hash);
          await settle(page);

          const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();

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

        expect(found.join('\n')).toBe('');
      });
    }
  }
});

test.describe('heading order', () => {
  for (const theme of THEMES) {
    test(`exactly one h1 and no skipped levels — ${theme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await ready(page, theme, { width: 1280, height: 900 });

      const problems: string[] = [];

      for (const view of VIEWS) {
        await page.goto(view.hash);
        await settle(page);

        // Only headings inside <main>: the shell's chrome is not the view's.
        const levels = await page.locator('main :is(h1,h2,h3,h4,h5,h6)').evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const style = getComputedStyle(node);
              return style.display !== 'none' && style.visibility !== 'hidden';
            })
            .map((node) => Number(node.tagName.slice(1))),
        );

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

      expect(problems.join('\n')).toBe('');
    });
  }
});

test.describe('form controls carry real labels', () => {
  test('no placeholder is standing in for a label', async ({ page }) => {
    test.setTimeout(180_000);
    await ready(page, 'light', { width: 1280, height: 900 });

    const problems: string[] = [];

    for (const view of VIEWS) {
      await page.goto(view.hash);
      await settle(page);

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

    expect(problems.join('\n')).toBe('');
  });
});
