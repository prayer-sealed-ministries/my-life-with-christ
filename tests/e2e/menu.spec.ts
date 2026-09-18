/**
 * The application menu, driven in a real browser at real widths.
 *
 * The unit tests prove the menu's behaviour in isolation. What they cannot show
 * is whether it is actually reachable in the shipped layout: a drawer can be
 * perfectly accessible and still sit off-screen, under the header, or behind a
 * z-index at 320px. So this walks it at phone width and at desktop width, and
 * checks the things only a rendered page can answer.
 */

import { expect, test, type Page } from '@playwright/test';

import { examinedAtLeast } from './floor';
import { dismissWelcome, forceTheme } from './seed';

const PHONE = { width: 390, height: 780 };
const NARROW = { width: 320, height: 640 };
const DESKTOP = { width: 1280, height: 900 };

/** The header button, identified by the attribute only it carries. */
const trigger = (page: Page) => page.locator('button[aria-controls][aria-expanded]').first();
const panel = (page: Page) => page.getByRole('dialog', { name: 'Menu' });

async function arrive(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await dismissWelcome(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
}

test.describe('the menu on a phone', () => {
  test('opens, lists every destination, and closes again', async ({ page }) => {
    await arrive(page, PHONE);

    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(panel(page)).toBeHidden();

    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');

    const labels = ['Home', 'Bible', 'Topics', 'My journey', 'Search', 'Data & Backup', 'Settings', 'Help', 'About'];
    for (const label of labels) {
      await expect(panel(page).getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    examinedAtLeast(labels.length, 9, 'menu destinations checked');

    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
  });

  test('navigates to Settings, Help and About, closing each time', async ({ page }) => {
    await arrive(page, PHONE);

    for (const [label, heading] of [
      ['Settings', 'Settings'],
      ['Help', 'Help'],
      ['About', 'About'],
    ] as const) {
      await trigger(page).click();
      await expect(panel(page)).toBeVisible();
      await panel(page).getByRole('link', { name: label, exact: true }).click();

      await expect(panel(page), `the menu stayed open after choosing ${label}`).toBeHidden();
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page).toHaveTitle(`${heading} — My Life With Christ`);
    }
  });

  test('reaches Data & Backup, which is the existing journal page', async ({ page }) => {
    await arrive(page, PHONE);

    await trigger(page).click();
    await panel(page).getByRole('link', { name: 'Data & Backup', exact: true }).click();

    // The friendly name leads to the real page, not a new one.
    await expect(page.getByRole('heading', { level: 1, name: 'Your journal' })).toBeVisible();
    await expect(page.getByRole('button', { name: /export everything/i })).toBeVisible();
  });

  test('changes the theme from Settings, through the existing implementation', async ({ page }) => {
    await arrive(page, PHONE);

    await trigger(page).click();
    await panel(page).getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('radio', { name: 'Dark' }).check();

    // The same attribute the header's control has always set.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'Light' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('browser Back returns from a menu destination', async ({ page }) => {
    await arrive(page, PHONE);

    await trigger(page).click();
    await panel(page).getByRole('link', { name: 'About', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'My Life With Christ' })).toBeVisible();
  });

  test('returns focus to the button it came from', async ({ page }) => {
    await arrive(page, PHONE);

    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');

    const focusedIsTrigger = await page.evaluate(
      () => document.activeElement?.getAttribute('aria-controls') !== null,
    );
    expect(focusedIsTrigger, 'focus did not return to the menu button').toBe(true);
  });
});

test.describe('the menu survives narrow and enlarged text', () => {
  test('is usable at 320px', async ({ page }) => {
    await arrive(page, NARROW);
    await trigger(page).click();

    const box = await panel(page).boundingBox();
    expect(box, 'the menu did not render').not.toBeNull();
    // Entirely on screen horizontally: a drawer wider than the viewport puts
    // its close button out of reach.
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(NARROW.width + 1);

    await expect(panel(page).getByRole('link', { name: 'About', exact: true })).toBeVisible();
  });

  test('keeps every item reachable at 200% text', async ({ page }) => {
    await arrive(page, NARROW);
    // The same lever reflow.spec.ts pulls: text doubled, layout unchanged.
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await trigger(page).click();
    await expect(panel(page)).toBeVisible();

    // The last item must be reachable — by scrolling the panel if necessary,
    // which is why the panel scrolls rather than the page.
    const about = panel(page).getByRole('link', { name: 'About', exact: true });
    await about.scrollIntoViewIfNeeded();
    await expect(about).toBeVisible();

    // And the page itself must not have grown sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'the open menu pushed the page sideways').toBeLessThanOrEqual(1);
  });
});

test.describe('the menu on a desktop', () => {
  test('keeps the primary navigation visible without opening anything', async ({ page }) => {
    await arrive(page, DESKTOP);

    const nav = page.getByRole('navigation', { name: 'Main' });
    for (const label of ['Bible', 'Topics', 'My journey', 'Search']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
    // The drawer is shut: a desktop user does not open a menu to read a psalm.
    await expect(panel(page)).toBeHidden();
  });

  test('does not clip the primary navigation at any desktop width', async ({ page }) => {
    await arrive(page, DESKTOP);

    // `toBeVisible()` is not enough and that is not hypothetical: a crowded
    // header squeezed this nav to 205px while its content needed 306px, so
    // "Search" was cut off — and every visibility assertion still passed,
    // because the element was rendered and merely hidden by its own overflow.
    for (const width of [1280, 1024, 900]) {
      await page.setViewportSize({ width, height: 860 });
      await page.waitForTimeout(100);

      const clipped = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Main"]');
        if (!nav) return { found: false, overflow: 0, links: 0 };
        return {
          found: true,
          overflow: nav.scrollWidth - nav.clientWidth,
          links: nav.querySelectorAll('a').length,
        };
      });

      expect(clipped.found, `no main nav at ${width}px`).toBe(true);
      // A floor: an empty nav cannot be clipped, and would pass silently.
      expect(clipped.links, `main nav is empty at ${width}px`).toBeGreaterThanOrEqual(4);
      expect(clipped.overflow, `the main nav is cut off at ${width}px`).toBeLessThanOrEqual(0);
    }
  });

  test('still offers the application pages through the menu', async ({ page }) => {
    await arrive(page, DESKTOP);

    await trigger(page).click();
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole('link', { name: 'Help', exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible();
    await expect(panel(page)).toBeHidden();
  });

  test('both themes render the open menu', async ({ page }) => {
    for (const theme of ['light', 'dark'] as const) {
      await arrive(page, DESKTOP);
      await forceTheme(page, theme);
      await trigger(page).click();
      await expect(panel(page)).toBeVisible();
      await expect(panel(page).getByRole('link', { name: 'Settings', exact: true })).toBeVisible();
    }
  });
});
