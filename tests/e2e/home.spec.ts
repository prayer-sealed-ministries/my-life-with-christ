/**
 * Home, in a real browser, at the sizes and text settings people actually use.
 *
 * The unit tests own what Home offers and where each thing goes. What only a
 * rendered page can answer is whether it survives being narrow, being enlarged,
 * and being looked at: whether the action cards reflow instead of clipping,
 * whether the page ever scrolls sideways, and whether the one sentence a reader
 * must never lose is still on screen.
 */

import { expect, test, type Page } from '@playwright/test';

import { examinedAtLeast } from './floor';
import { dismissWelcome, seedEntries, SEED_ENTRIES } from './seed';

/** In the order Home offers them: the three that write, then the three that find. */
const ACTIONS = [
  { name: 'Sermon note', href: '#/entry/new?kind=sermon' },
  { name: 'Prayer', href: '#/entry/new?kind=prayer' },
  { name: 'Reflection', href: '#/entry/new?kind=reflection' },
  { name: 'Read Scripture', href: '#/browse' },
  { name: 'Topics', href: '#/topics' },
  { name: 'Search', href: '#/search' },
] as const;

/** The action grid: one column, then two at 22.5rem, then three at 48rem. */
const expectedColumns = (width: number) => (width >= 768 ? 3 : width >= 360 ? 2 : 1);

// Scoped to <main>: from 768px the header's own navigation also has links
// called Topics and Search, and an unscoped match finds both.
const actionCard = (page: Page, name: string) =>
  page.locator('main').getByRole('link', { name: new RegExp(`^${name}`) });

async function arrive(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height });
  await dismissWelcome(page);
  await page.addInitScript(() => localStorage.setItem('journey:intro', 'closed'));
  await page.goto('/#/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main h1')).toHaveCount(1);
}

/** What the rendered page is doing, measured rather than assumed. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const grid = document.querySelector('main ul');
    return {
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      // A card shorter than its own content is a card that is hiding text.
      clipped: [...document.querySelectorAll('main a')].filter(
        (el) => el.scrollHeight > el.clientHeight + 2,
      ).length,
      h1InMain: document.querySelectorAll('main h1').length,
      h1Anywhere: document.querySelectorAll('h1').length,
    };
  });

test.describe('the way in', () => {
  test('offers every action, each to somewhere that exists', async ({ page }) => {
    await arrive(page, 390);

    const hrefs: string[] = [];
    for (const { name } of ACTIONS) {
      const card = actionCard(page, name);
      await expect(card, `${name} is not on Home`).toBeVisible();
      hrefs.push((await card.getAttribute('href')) ?? '');
    }
    examinedAtLeast(hrefs.length, 6, 'quick actions checked');
    expect(hrefs).toEqual(ACTIONS.map((action) => action.href));
  });

  test('opens Prayer and Reflection already set to that kind', async ({ page }) => {
    // The point of the two new cards. A card that opened the ordinary sermon
    // form would look identical from the outside and be a lie, so the check is
    // what the editor's Kind field says after following the link.
    for (const { name, href } of [
      { name: 'Prayer', href: '#/entry/new?kind=prayer' },
      { name: 'Reflection', href: '#/entry/new?kind=reflection' },
    ]) {
      await arrive(page, 390);
      await actionCard(page, name).click();
      await expect(page).toHaveURL(new RegExp(href.replace('?', '\\?')));
      await expect(page.getByLabel('Kind', { exact: true })).toHaveValue(name.toLowerCase());
    }
  });

  test('opens the same sermon destination the launcher shortcut does', async ({ page }) => {
    // Sermon note used to link to the bare `#/entry/new` and lean on the
    // editor's default kind. It now names the kind, because it is the same
    // destination the Android shortcut selects — one door, two ways to it. A
    // shortcut relying on that default would have quietly pointed elsewhere
    // the day it changed, with nothing failing.
    await arrive(page, 390);
    await actionCard(page, 'Sermon note').click();
    await expect(page).toHaveURL(/#\/entry\/new\?kind=sermon$/);
    await expect(page.getByLabel('Kind', { exact: true })).toHaveValue('sermon');
    // And the caret is already where the writing goes.
    await expect(page.getByRole('textbox', { name: 'Notes' })).toBeFocused();
  });

  test('the bare new-entry route still works, for any link that predates this', async ({ page }) => {
    // The route was not narrowed: `#/entry/new` remains a blank sermon, so an
    // old bookmark or a saved link still opens what it always did.
    await page.goto('/#/entry/new');
    await page.waitForLoadState('networkidle');
    await expect(page.getByLabel('Kind', { exact: true })).toHaveValue('sermon');
  });

  test('gives each card a tap target worth aiming at', async ({ page }) => {
    await arrive(page, 390);

    for (const { name } of ACTIONS) {
      const box = await actionCard(page, name).boundingBox();
      expect(box, `${name} did not render`).not.toBeNull();
      // The whole card navigates, so the whole card has to be comfortably
      // tappable — not a small label inside a large-looking box.
      expect(box!.height, `${name} is too short to tap`).toBeGreaterThanOrEqual(44);
      expect(box!.width, `${name} is too narrow to tap`).toBeGreaterThanOrEqual(120);
    }
  });

  test('takes focus in order, and shows where it is', async ({ page }) => {
    await arrive(page, 1280);
    await actionCard(page, 'Sermon note').focus();

    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const outline = el ? getComputedStyle(el, ':focus-visible').outlineStyle : 'none';
      return { href: el?.getAttribute('href'), outline };
    });
    expect(focused.href, 'focus did not land on the first action').toBe('#/entry/new?kind=sermon');
    expect(focused.outline, 'the focused card shows no outline').not.toBe('none');
  });
});

test.describe('it does not repeat the header', () => {
  test('says the app name once, and not as a heading in the page', async ({ page }) => {
    await arrive(page, 390);

    // The name and tagline live in the header. Home carries the name only as a
    // visually hidden h1, which is structure rather than a second banner.
    const h1 = page.locator('main h1');
    await expect(h1).toHaveText('My Life With Christ');

    // `sr-only` is clipped to a 1px box rather than removed, so Playwright
    // rightly calls it visible. What matters is that it takes no space and
    // shows nothing: measure the box rather than trust the class name.
    const box = await h1.boundingBox();
    expect(box, 'the page heading did not render at all').not.toBeNull();
    expect(box!.height, 'the page title is displayed again, repeating the header').toBeLessThanOrEqual(2);

    const taglineInMain = await page.locator('main').getByText('Your walk, remembered.').count();
    expect(taglineInMain, 'the tagline is repeated inside the page').toBe(0);
  });
});

test.describe('it holds together when squeezed', () => {
  for (const width of [320, 360, 390, 768, 1280]) {
    test(`at ${width}px`, async ({ page }) => {
      await arrive(page, width);
      const result = await layout(page);

      expect(result.columns, `wrong action layout at ${width}px`).toBe(expectedColumns(width));
      expect(result.pageOverflow, `the page scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
      expect(result.clipped, `a card is clipping its own text at ${width}px`).toBe(0);
      expect(result.h1InMain).toBe(1);
      expect(result.h1Anywhere, `more than one h1 at ${width}px`).toBe(1);

      for (const { name } of ACTIONS) {
        await expect(actionCard(page, name), `${name} vanished at ${width}px`).toBeVisible();
      }
    });
  }

  test('drops to one column when the reader enlarges their text', async ({ page }) => {
    // The real mechanism, not a page-level font override: media queries cannot
    // see `html { font-size: 200% }`, and the breakpoint is in rem precisely so
    // that a reader's own text size moves it. See nav-breakpoint.spec.ts.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Page.enable');
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 32 } });

    await arrive(page, 390);
    await expect(page.locator('html')).toHaveCSS('font-size', '32px');

    const result = await layout(page);
    expect(result.columns, 'two columns of doubled text on a phone').toBe(1);
    expect(result.pageOverflow, 'the page scrolls sideways at doubled text').toBeLessThanOrEqual(1);
    expect(result.clipped, 'a card clipped its text at doubled text').toBe(0);
  });
});

test.describe('what a journal shows of itself', () => {
  test('welcomes an empty journal instead of leaving a gap', async ({ page }) => {
    await arrive(page, 390);

    await expect(page.getByRole('heading', { level: 2, name: 'Recently written' })).toBeVisible();
    await expect(page.getByText('Your journey begins here.')).toBeVisible();
  });

  test('shows a bounded handful of entries, each opening its own', async ({ page }) => {
    await arrive(page, 390);
    await seedEntries(page, SEED_ENTRIES);
    await page.waitForLoadState('networkidle');

    // Scoped to the "Recently written" region, not filtered by label. The quick
    // actions now include Prayer and Reflection, whose hrefs also begin
    // `#/entry/` — an exclusion list of names would have had to grow with every
    // card added, and would have silently stopped excluding anything.
    const cards = page.locator('section[aria-labelledby="recent-heading"] a[href^="#/entry/"]');
    const count = await cards.count();
    expect(count, 'Home grew into a second timeline').toBeLessThanOrEqual(3);
    expect(count, 'no recent entries showed at all').toBeGreaterThan(0);

    // Each card goes to the entry it is showing, not merely to the timeline.
    const href = await cards.first().getAttribute('href');
    expect(href).toMatch(/^#\/entry\/[^/]+$/);
    await cards.first().click();
    await expect(page).toHaveURL(new RegExp(href!.replace('#', '\\#')));
    await expect(page.getByRole('heading', { level: 1, name: 'Edit entry' })).toBeVisible();
  });
});

test.describe('the promise that cannot be collapsed', () => {
  test('keeps the durability warning visible whatever Home is doing', async ({ page }) => {
    await arrive(page, 390);

    const warning = page.getByText(/The copy on this device is not a backup — export your journal/);
    await expect(warning).toBeVisible();

    // Still there with the explanation collapsed, which is the state a
    // returning reader is always in.
    await expect(page.getByRole('button', { name: /what is this/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(warning, 'the warning went away with the explanation').toBeVisible();
  });

  test('keeps the disclosure working, and secondary', async ({ page }) => {
    await arrive(page, 390);

    const toggle = page.getByRole('button', { name: /what is this/i });
    await toggle.click();
    await expect(page.getByText(/A place to read the Bible and keep what you hear/)).toBeVisible();

    // Below the things a person came to do, not above them.
    const order = await page.evaluate(() => {
      const actions = document.querySelector('main ul a');
      const intro = [...document.querySelectorAll('main button')].find((b) =>
        /what is this/i.test(b.textContent ?? ''),
      );
      if (!actions || !intro) return 'missing';
      return actions.compareDocumentPosition(intro) & Node.DOCUMENT_POSITION_FOLLOWING
        ? 'after'
        : 'before';
    });
    expect(order, 'the explanation is back above the actions').toBe('after');
  });
});

test.describe('the cards stay readable when the reader enlarges their text', () => {
  /** How many lines each action's own name is broken across. */
  const labelLines = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('main ul a')].map((card) => {
        const label = card.querySelector('span:last-child > span') as HTMLElement;
        const lineHeight = Number.parseFloat(getComputedStyle(label).lineHeight) || 1;
        return {
          text: (label.textContent ?? '').trim(),
          lines: Math.round(label.getBoundingClientRect().height / lineHeight),
        };
      }),
    );

  for (const width of [320, 390]) {
    test(`does not break a card's own name apart at ${width}px and 200% text`, async ({ page }) => {
      // Found by looking at the screenshots rather than by any assertion, which
      // is why this one exists: at 320px with doubled text the icon took most
      // of the row and "Sermon note" came out as "Ser / mo / n / not / e" down
      // five lines. Nothing overflowed and reflow passed — `break-word` did
      // exactly as it was told — so every check in the suite was satisfied by a
      // card no one could read.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Page.enable');
      await cdp.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 32 } });

      await arrive(page, width);
      await expect(page.locator('html')).toHaveCSS('font-size', '32px');

      const labels = await labelLines(page);
      examinedAtLeast(labels.length, 6, `action labels measured at ${width}px`);

      const broken = labels.filter((label) => label.lines > 2);
      expect(
        broken.map((label) => `${label.text}: ${label.lines} lines`).join('\n'),
        `a card's name is broken across more than two lines at ${width}px and 200% text`,
      ).toBe('');

      const result = await layout(page);
      expect(result.pageOverflow, `the page scrolls sideways at ${width}px`).toBeLessThanOrEqual(1);
      expect(result.clipped, 'a card clipped its text').toBe(0);
    });
  }
});
