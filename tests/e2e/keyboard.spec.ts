/**
 * Pass B, part two: drive the app with the keyboard only.
 *
 * The test axe cannot run. A page can be free of axe violations and still be
 * unusable without a mouse — a focus ring that renders invisible, a control that
 * cannot be reached by Tab, a dialog that swallows focus and never gives it
 * back. So this walks the real path: arrive, get past the first-visit dialog,
 * reach the editor, write both fields, and save. No mouse.
 */

import { expect, test, type Page } from '@playwright/test';

import { examinedAtLeast } from './floor';
import { forceTheme, seedEntries } from './seed';

/** What currently has focus, described well enough to read in a failure. */
async function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: 'BODY', label: '(nothing focused)', visible: false };

    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    // "Visible focus" means the browser actually paints something: an outline,
    // a ring via box-shadow, or a border change. Checking outline alone would
    // miss ring utilities, and trusting the CSS would miss a suppressed one.
    const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
    const hasOutline = outlineWidth > 0 && style.outlineStyle !== 'none';
    const hasRing = style.boxShadow !== 'none' && style.boxShadow !== '';

    // A signature unique to this element. Without the DOM path, a run of
    // unlabelled inputs all serialise identically and read as a focus trap.
    const path: string[] = [];
    for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
      const siblings = node.parentElement ? [...node.parentElement.children] : [];
      path.unshift(`${node.tagName}:${siblings.indexOf(node)}`);
    }

    return {
      tag: el.tagName,
      label: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('name') || '').slice(0, 60).replace(/\s+/g, ' '),
      signature: path.join('>'),
      visible: rect.width > 0 && rect.height > 0,
      focusIndicator: hasOutline || hasRing,
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`,
    };
  });
}

/** How many entries the real IndexedDB holds. -1 if it could not be opened. */
async function storedEntryCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const open = indexedDB.open('journey');
        open.onsuccess = () => {
          const db = open.result;
          const count = db.transaction('entries').objectStore('entries').count();
          count.onsuccess = () => {
            db.close();
            resolve(count.result);
          };
        };
        open.onerror = () => resolve(-1);
      }),
  );
}

test('the first-visit dialog traps focus and gives it back', async ({ page }) => {
  test.setTimeout(90_000);
  await forceTheme(page, 'light');
  await page.goto('#/');
  await page.waitForLoadState('networkidle');

  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();

  // A modal <dialog> makes the rest of the page inert, so tabbing must never
  // reach page content behind it.
  //
  // Focus DOES pass through <body> once per cycle — that is the browser's
  // wrap-around when leaving the dialog's last element, and it is correct
  // native behaviour, not an escape. What would be a real failure is landing on
  // a focusable element outside the dialog, so that is what is asserted.
  const escaped: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const dlg = document.querySelector('dialog[open]');
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) return null;
      if (dlg && dlg.contains(el)) return null;
      return `${el.tagName} "${(el.textContent || '').trim().slice(0, 40)}"`;
    });
    if (where) escaped.push(`tab ${i + 1} reached ${where}, outside the dialog`);
  }
  expect(escaped.join('; ')).toBe('');

  // Every stop inside the dialog paints a focus indicator.
  await page.keyboard.press('Tab');
  const state = await focused(page);
  expect(state.focusIndicator, `no visible focus on ${state.tag} "${state.label}"`).toBe(true);

  // Dismiss from the keyboard, and focus must come back to the page.
  await page.getByRole('button', { name: /I understand/i }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await page.waitForTimeout(200);
  const after = await focused(page);
  expect(after.tag, 'focus was dropped on the floor after dismissing the dialog').not.toBe('BODY');
});

test('Escape also dismisses, and does not resurrect the dialog', async ({ page }) => {
  await forceTheme(page, 'light');
  await page.goto('#/');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('dialog[open]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);

  await page.goto('#/browse');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('skip link is the first stop and actually moves focus', async ({ page }) => {
  await forceTheme(page, 'light');
  await page.addInitScript(() => localStorage.setItem('journey:welcomed', '1'));
  await page.goto('#/');
  await page.waitForLoadState('networkidle');

  await page.keyboard.press('Tab');
  const first = await focused(page);
  expect(first.label.toLowerCase()).toContain('skip to main');
  expect(first.focusIndicator, 'the skip link has no visible focus').toBe(true);

  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const landed = await page.evaluate(() => {
    const main = document.querySelector('main');
    return !!main && (main === document.activeElement || main.contains(document.activeElement) || location.hash.includes('main'));
  });
  expect(landed, 'the skip link did not move focus into main').toBe(true);
});

test('write and save an entry using only the keyboard', async ({ page }) => {
  test.setTimeout(120_000);
  await forceTheme(page, 'light');
  await page.addInitScript(() => localStorage.setItem('journey:welcomed', '1'));
  await page.goto('#/');
  await page.waitForLoadState('networkidle');

  // Tab until the "Sermon note" action is reached. Bounded, so a focus trap
  // fails the test rather than hanging it.
  let reached = false;
  const seen: string[] = [];
  for (let i = 0; i < 40 && !reached; i += 1) {
    await page.keyboard.press('Tab');
    const state = await focused(page);
    seen.push(`${state.tag}:${state.label.slice(0, 30)}`);

    if (state.tag !== 'BODY') {
      expect(
        state.focusIndicator,
        `no visible focus indicator on ${state.tag} "${state.label}" (outline: ${state.outline})`,
      ).toBe(true);
    }
    if (/sermon note/i.test(state.label)) reached = true;
  }
  expect(reached, `never reached "Sermon note" by tabbing. Stops: ${seen.join(' → ')}`).toBe(true);

  await page.keyboard.press('Enter');
  await page.waitForURL(/#\/entry\/new/);
  await expect(page.locator('main h1')).toBeVisible();

  // Fast capture: the notes field should already hold focus on arrival.
  await page.waitForTimeout(400);
  const onArrival = await focused(page);
  expect(
    onArrival.tag,
    'the editor did not put the cursor in a text field — fast capture is broken',
  ).toBe('TEXTAREA');

  await page.keyboard.type('Typed entirely from the keyboard, no mouse touched.');
  await page.keyboard.press('Tab');
  const next = await focused(page);
  expect(next.focusIndicator, 'no visible focus after tabbing out of notes').toBe(true);
  await page.keyboard.type('And the reflection, which is a separate field on purpose.');

  // Reach Save by tabbing and activate it.
  let saved = false;
  for (let i = 0; i < 25 && !saved; i += 1) {
    await page.keyboard.press('Tab');
    const state = await focused(page);
    if (/^save$/i.test(state.label.trim())) {
      await page.keyboard.press('Enter');
      saved = true;
    }
  }
  expect(saved, 'could not reach the Save button by tabbing').toBe(true);

  await page.waitForTimeout(900);
  const stored = await storedEntryCount(page);
  expect(stored, 'the entry was not written to the database').toBeGreaterThan(0);
});

/**
 * Searching for a passage must not save the note.
 *
 * The picker's search field sits inside the entry form, and a form with a submit
 * button submits on Enter from any text input. Somebody halfway through a
 * sermon, looking for where to file what they have written, would have it saved
 * and be navigated away mid-thought. Measured, not assumed: with the handler
 * deleted entirely, this exact path saves the entry and lands on #/entry/<id>.
 *
 * The Enter is pressed with NO results showing, and that is the point. The
 * handler does two things — cancel the keystroke, and move the keyboard onto the
 * first result — and in Chrome the focus move alone is enough to suppress the
 * submission, because implicit submission needs the input still focused when the
 * default action runs. So a test that presses Enter on a list of results passes
 * with preventDefault deleted, masked by the focus move. With nothing to focus,
 * only the cancel is left standing.
 *
 * This lives here rather than in the unit suite because jsdom does not implement
 * implicit submission at all: the jsdom version asserted an empty database and
 * passed with the guard deleted, which is how it was caught being a decoration.
 */
test('searching for a passage does not submit the entry form', async ({ page }) => {
  test.setTimeout(90_000);
  await forceTheme(page, 'light');
  await page.addInitScript(() => localStorage.setItem('journey:welcomed', '1'));
  await page.goto('#/entry/new');
  await page.waitForLoadState('networkidle');

  // There has to be something worth saving, or the form would refuse to submit
  // for an unrelated reason and this test would pass having proved nothing.
  // exact: the notes box now sits under a formatting toolbar labelled
  // "Formatting for Notes", and Playwright's getByLabel matches substrings.
  const notes = page.getByLabel('Notes', { exact: true });
  await expect(notes).toBeVisible();
  await notes.fill('Written in the pew, not finished yet.');
  await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();

  // Open Details from the keyboard: Enter on a <summary> toggles it.
  await page.locator('details summary').first().focus();
  await page.keyboard.press('Enter');

  const search = page.getByLabel('Add a passage');
  await expect(search).toBeVisible();
  await search.focus();

  // A query with no results: nothing for the focus move to land on, so the
  // cancel is the only thing between this keystroke and a saved entry.
  await page.keyboard.type('zzzzznotathing');
  await expect(page.getByText(/Nothing matched/)).toBeVisible();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);

  expect(new URL(page.url()).hash, 'searching navigated away from the blank entry').toBe(
    '#/entry/new',
  );
  expect(await storedEntryCount(page), 'searching saved the entry').toBeLessThanOrEqual(0);

  // And with results, the keystroke puts the keyboard on the first one.
  await search.fill('');
  await search.focus();
  await page.keyboard.type('John 4');
  await expect(page.getByRole('button', { name: /^Add John 4/ }).first()).toBeVisible();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const landed = await focused(page);
  expect(landed.tag).toBe('BUTTON');
  expect(landed.label).toMatch(/^Add John 4/);
  expect(new URL(page.url()).hash).toBe('#/entry/new');
  expect(await storedEntryCount(page), 'picking a passage saved the entry').toBeLessThanOrEqual(0);
});

test('no keyboard trap anywhere in the journal views', async ({ page }) => {
  test.setTimeout(180_000);
  await forceTheme(page, 'light');
  await page.addInitScript(() => localStorage.setItem('journey:welcomed', '1'));
  await page.goto('#/');
  await page.waitForLoadState('networkidle');
  await seedEntries(page);

  for (const hash of ['#/browse', '#/book/matthew', '#/passage/matthew/matthew-5-1-12', '#/topics', '#/timeline', '#/data', '#/entry/seed-01']) {
    await page.goto(hash);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1').first()).toBeVisible();

    // Tab through and confirm focus keeps moving. A trap shows up as the same
    // element under focus twice in a row, repeatedly.
    const stops: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      await page.keyboard.press('Tab');
      const state = await focused(page);
      stops.push(state.signature || state.tag);
    }

    // A page with nothing focusable produces thirty identical BODY stops and
    // no "stuck" run long enough to fail — so require real, distinct stops.
    const distinct = new Set(stops.filter((stop) => stop !== 'BODY'));
    examinedAtLeast(distinct.size, 3, `distinct focus stops in ${hash}`);

    let stuck = 0;
    for (let i = 1; i < stops.length; i += 1) {
      if (stops[i] === stops[i - 1]) stuck += 1;
      else stuck = 0;
      expect(stuck, `focus appears trapped on ${stops[i]} in ${hash}`).toBeLessThan(4);
    }
  }
});
