/**
 * The application shell: navigation, landmarks, and route-change focus.
 *
 * Two accessibility obligations live here because they cannot be met view by
 * view. First, a skip link and real landmarks, so a keyboard or screen-reader
 * user is not walked through the whole nav on every page. Second, focus
 * management: a hash change does not move focus on its own, so after each
 * navigation focus goes to the new page heading and the route is announced.
 * Without that, a screen-reader user hears nothing at all when the page changes.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { FirstVisitNotice } from '../components/FirstVisitNotice';
import { Link, useRouter, type Route } from './router';
import { useTheme } from './theme';

const NAV: Array<{ route: Route; label: string }> = [
  { route: { name: 'browse' }, label: 'Bible' },
  { route: { name: 'topics' }, label: 'Topics' },
  { route: { name: 'timeline' }, label: 'My journey' },
  { route: { name: 'search', query: '' }, label: 'Search' },
];

const isCurrent = (route: Route, nav: Route): boolean => {
  if (route.name === nav.name) return true;
  if (nav.name === 'browse') return route.name === 'book' || route.name === 'passage';
  if (nav.name === 'topics') return route.name === 'topic';
  if (nav.name === 'timeline') return route.name === 'entry' || route.name === 'newEntry';
  return false;
};

function ThemeToggle() {
  const { choice, setChoice } = useTheme();
  const options: Array<{ value: 'light' | 'dark' | 'system'; label: string }> = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];

  return (
    <div className="flex items-center gap-1">
      <label htmlFor="theme-choice" className="sr-only">
        Colour theme
      </label>
      <select
        id="theme-choice"
        value={choice}
        onChange={(event) => setChoice(event.target.value as 'light' | 'dark' | 'system')}
        className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Shell({ children, title }: { children: ReactNode; title: string }) {
  const { route } = useRouter();
  const headingRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const firstRender = useRef(true);

  useEffect(() => {
    document.title = title === 'Journey' ? 'Journey' : `${title} — Journey`;

    // Do not steal focus on first paint; only on an actual navigation.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setAnnouncement(title);
    headingRef.current?.focus();
    window.scrollTo(0, 0);
  }, [route, title]);

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-white dark:focus:bg-slate-100 dark:focus:text-slate-900"
      >
        Skip to main content
      </a>

      <header className="border-b border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {/*
          Two rows on a phone, one row on a desktop.

          `sm:contents` dissolves the grouping wrapper at width, so brand,
          actions and nav become siblings of the same flex row. This was one
          flex-wrap line before; at 390px it wrapped into a ragged four-line
          block 217px tall — a quarter of the viewport spent on chrome, above a
          page meant for writing.
        */}
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-4 py-2 sm:flex-row sm:items-center sm:gap-4 sm:py-3">
          <div className="flex items-center justify-between gap-3 sm:contents">
            <Link
              to={{ name: 'home' }}
              className="font-serif text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Journey
            </Link>

            {/*
              Export is not in the nav list and not buried in settings. Data
              durability is the whole point of the product, so the way out of it
              is visible on every view, always in the same place.
            */}
            <div className="flex items-center gap-2 sm:order-last">
              <Link
                to={{ name: 'data' }}
                aria-current={route.name === 'data' ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  route.name === 'data'
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                <span aria-hidden="true">↓</span> Export
              </Link>
              <ThemeToggle />
            </div>
          </div>

          {/*
            The nav scrolls sideways rather than wrapping if it ever outgrows a
            narrow screen: a second ragged line is worse than a scroll, and the
            negative margin lets it bleed to the edge so it reads as scrollable.
          */}
          <nav aria-label="Main" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:flex-1 sm:overflow-visible sm:px-0">
            <ul className="flex gap-1 whitespace-nowrap">
              {NAV.map((item) => {
                const current = isCurrent(route, item.route);
                return (
                  <li key={item.label}>
                    <Link
                      to={item.route}
                      aria-current={current ? 'page' : undefined}
                      className={`inline-flex min-h-11 items-center rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                        current
                          ? 'bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
      </header>

      <FirstVisitNotice />

      {/* Announce the new page to assistive tech, which a hash change does not. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <main id="main" className="mx-auto max-w-3xl px-4 py-6">
        {/* Focus lands here after navigation, ahead of the page heading. */}
        <div ref={headingRef} tabIndex={-1} className="outline-none">
          {children}
        </div>
      </main>

      <footer className="mx-auto max-w-3xl px-4 pb-10 pt-4 text-xs text-slate-500 dark:text-slate-400">
        <p>
          Everything here stays on this device.{' '}
          <Link to={{ name: 'data' }} className="underline focus-visible:outline-2">
            Browser storage is not a backup — export your journal
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}
