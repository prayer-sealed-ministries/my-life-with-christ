/**
 * The name and the tagline, now that the header is the only place they appear.
 *
 * They used to be said twice on the home screen — once in the header and again
 * as a large heading with the tagline beneath it — which spent most of a
 * phone's first screen repeating itself. Moving them here bought that space
 * back, and moved a guarantee with them: the home view no longer proves it says
 * what the app is, so this does.
 *
 * The heading level is the part worth holding. Home has no heading of its own
 * any more, so the name has to be its h1; every other view still has one, so
 * the name must NOT be an h1 there. Get it wrong in either direction and the
 * accessibility gate fails — two h1s on a page, or none.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RouterProvider } from './router';
import { Shell } from './Shell';
import { StorageContextProvider } from './storage';
import { DexieStorageProvider } from '../storage/db';

const APP_NAME = 'My Life With Christ';
const TAGLINE = 'Your walk, remembered.';
let database = 0;

function renderAt(hash: string, title: string, body = <h1>A page</h1>) {
  window.location.hash = hash;
  return render(
    <StorageContextProvider provider={new DexieStorageProvider(`shell-header-${database += 1}`)}>
      <RouterProvider>
        <Shell title={title}>{body}</Shell>
      </RouterProvider>
    </StorageContextProvider>,
  );
}

beforeEach(() => {
  window.location.hash = '';
  // The shell renders the first-visit notice, which opens a native <dialog>
  // with showModal() — a method jsdom does not implement. Standing the notice
  // down with the app's own flag is closer to a returning reader than stubbing
  // the DOM would be.
  localStorage.setItem('journey:welcomed', '1');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the header says what the app is', () => {
  it('shows the name and the tagline together', () => {
    renderAt('#/', 'My Life With Christ', <p>Home body</p>);

    expect(screen.getByRole('link', { name: APP_NAME })).toBeTruthy();
    expect(screen.getByText(TAGLINE)).toBeTruthy();
  });

  it('keeps saying both on a page that is not home', () => {
    // The tagline follows the app rather than belonging to one screen; a reader
    // who lands on Settings from a link should still learn what this is.
    renderAt('#/settings', 'Settings', <h1>Settings</h1>);

    expect(screen.getByRole('link', { name: APP_NAME })).toBeTruthy();
    expect(screen.getByText(TAGLINE)).toBeTruthy();
  });
});

describe('the header is chrome, not the page heading', () => {
  // The accessibility suite says it outright: only headings inside <main>
  // count, because the shell's chrome is not the view's. An h1 in the banner
  // was tried and it put the home view at zero headings of its own, which the
  // sweep reported as "[home] expected exactly 1 h1, found 0".
  it('never renders a heading of its own, on any route', () => {
    for (const [hash, title] of [
      ['#/', 'My Life With Christ'],
      ['#/settings', 'Settings'],
      ['#/timeline', 'My journey'],
    ] as const) {
      renderAt(hash, title, <p>Body with no heading</p>);
      expect(
        screen.queryAllByRole('heading'),
        `the header rendered a heading on ${hash}`,
      ).toHaveLength(0);
      cleanup();
    }
  });

  it('leaves the h1 to the view', () => {
    renderAt('#/settings', 'Settings', <h1>Settings</h1>);

    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s, 'a second h1 appeared alongside the page heading').toHaveLength(1);
    expect(h1s[0].textContent, 'the header took the page heading').toBe('Settings');
  });
});

describe('the document title', () => {
  it('is the name alone on home, not the name twice', () => {
    renderAt('#/', 'My Life With Christ', <p>Home body</p>);
    expect(document.title).toBe(APP_NAME);
  });

  it('names the page first elsewhere', () => {
    renderAt('#/settings', 'Settings', <h1>Settings</h1>);
    expect(document.title).toBe(`Settings — ${APP_NAME}`);
  });
});
