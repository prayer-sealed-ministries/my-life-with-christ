/**
 * The home introduction, as a disclosure.
 *
 * The agreed behaviour: the two paragraphs explaining what the app is are open
 * on a first visit and closed on every visit after it, with a "What is this?"
 * toggle to bring them back. The heading and the tagline never collapse, and
 * neither does the durability warning — that lives in the footer of every page
 * precisely so it cannot be tidied away.
 */

import { StrictMode } from 'react';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import HomeView from './HomeView';
import { readIntro } from './home-intro';
import { PlatformProvider } from '../platform/provider';
import { RouterProvider } from '../app/router';
import { StorageContextProvider } from '../app/storage';
import { DexieStorageProvider } from '../storage/db';

let dbCount = 0;
const renderHome = () =>
  render(
    <PlatformProvider>
      <RouterProvider>
        <StorageContextProvider provider={new DexieStorageProvider(`home-intro-${(dbCount += 1)}`)}>
          <HomeView />
        </StorageContextProvider>
      </RouterProvider>
    </PlatformProvider>,
  );

const toggle = () => screen.getByRole('button', { name: /what is this/i });
const INTRO = /A place to read the Bible and keep what you hear/i;
const OWNERSHIP = /These are your words, your prayers, your story/i;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a first visit', () => {
  it('shows the introduction without being asked', () => {
    renderHome();

    expect(screen.getByText(INTRO)).toBeTruthy();
    expect(screen.getByText(OWNERSHIP)).toBeTruthy();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps the name and the tagline out of the collapse entirely', () => {
    renderHome();
    fireEvent.click(toggle());

    // Whatever else folds away, the page still says what it is.
    expect(screen.getByRole('heading', { level: 1, name: 'Life With Christ' })).toBeTruthy();
    expect(screen.getByText('Your walk with God, remembered.')).toBeTruthy();
  });
});

describe('deciding what to show is a pure read', () => {
  // The bug this exists for: recording "seen" used to happen inside the
  // `useState` initializer — a write during render. React may invoke an
  // initializer more than once, and on a simulator it did: the very first
  // launch came up collapsed, in front of the one reader the section is for.
  //
  // Stated as the property that was violated. The old code answered `true` and
  // then `false` for the same untouched browser, because asking changed the
  // answer. Asking must not change the answer.
  it('gives the same answer twice for a reader who has never been here', () => {
    expect(readIntro(), 'a fresh browser should have nothing recorded').toBeNull();
    expect(readIntro(), 'reading the preference changed it').toBeNull();
    expect(readIntro()).toBeNull();
  });

  it('still reports what was genuinely stored', () => {
    // A floor: a function that always returned null would satisfy the case
    // above perfectly while knowing nothing.
    localStorage.setItem('journey:intro', 'closed');
    expect(readIntro()).toBe('closed');
    localStorage.setItem('journey:intro', 'open');
    expect(readIntro()).toBe('open');
  });

  it('renders open under StrictMode, as the application mounts it', () => {
    render(
      <StrictMode>
        <PlatformProvider>
          <RouterProvider>
            <StorageContextProvider provider={new DexieStorageProvider(`home-strict-${(dbCount += 1)}`)}>
              <HomeView />
            </StorageContextProvider>
          </RouterProvider>
        </PlatformProvider>
      </StrictMode>,
    );

    expect(toggle().getAttribute('aria-expanded'), 'a first visit came up collapsed').toBe('true');
  });
});

describe('every visit after the first', () => {
  it('starts collapsed', () => {
    // The first visit recorded that it had been seen.
    renderHome();
    cleanup();

    renderHome();
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(INTRO), 'the introduction came back uninvited').toBeNull();
  });

  it('opens again when asked, and stays open next time', () => {
    renderHome();
    cleanup();

    renderHome();
    fireEvent.click(toggle());
    expect(screen.getByText(INTRO)).toBeTruthy();

    // An explicit choice outranks the first-visit rule.
    cleanup();
    renderHome();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });
});

describe('the disclosure is a real one', () => {
  it('is a button that owns the region it opens', () => {
    renderHome();
    const button = toggle();

    expect(button.tagName).toBe('BUTTON');
    const controls = button.getAttribute('aria-controls');
    expect(controls, 'the toggle does not say what it controls').toBeTruthy();
    expect(document.getElementById(controls!), 'aria-controls points at nothing').toBeTruthy();
  });

  it('removes the collapsed prose from the tree rather than hiding it', () => {
    // Visually hidden text is still read aloud. A screen reader should not be
    // offered paragraphs the page is pretending are not there.
    renderHome();
    fireEvent.click(toggle());

    expect(screen.queryByText(INTRO)).toBeNull();
    expect(toggle().getAttribute('aria-controls')).toBeTruthy();
  });

  it('works from the keyboard', () => {
    renderHome();
    const button = toggle();
    button.focus();
    expect(document.activeElement).toBe(button);

    // A real button activates on Enter and Space without any handler of ours.
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement, 'focus moved away from the toggle').toBe(button);
  });
});

describe('when the browser refuses to remember anything', () => {
  it('still shows the introduction rather than failing', () => {
    // Private browsing, blocked site data. Showing it is the harmless outcome.
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      clear: () => {},
    });

    renderHome();
    expect(screen.getByText(INTRO)).toBeTruthy();
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });
});
