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
    <div className="flex min-w-0 items-center gap-1">
      <label htmlFor="theme-choice" className="sr-only">
        Colour theme
      </label>
      <select
        id="theme-choice"
        value={choice}
        onChange={(event) => setChoice(event.target.value as 'light' | 'dark' | 'system')}
        className="min-h-11 max-w-full min-w-0 rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2"
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
    document.title = title === 'Life With Christ' ? 'Life With Christ' : `${title} — Life With Christ`;

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
    <div className="min-h-dvh bg-app text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink"
      >
        Skip to main content
      </a>

      <header className="border-b border-line bg-surface">
        {/*
          Two rows on a phone, one row on a desktop.

          `sm:contents` dissolves the grouping wrapper at width, so brand,
          actions and nav become siblings of the same flex row. This was one
          flex-wrap line before; at 390px it wrapped into a ragged four-line
          block 217px tall — a quarter of the viewport spent on chrome, above a
          page meant for writing.
        */}
        <div className="mx-auto flex max-w-3xl flex-col gap-1 px-5 py-2 sm:flex-row sm:items-center sm:gap-5 sm:py-2.5">
          {/* `flex-wrap` and `min-w-0` are what make 1.4.4 and 1.4.12 survivable.
              A flex item defaults to min-width:auto, so it refuses to shrink below
              its content and pushes the page wider instead of letting the nav's
              own overflow take over. At 200% text in a 320px viewport that was
              536px of page in a 320px window. */}
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:contents">
            <Link
              to={{ name: 'home' }}
              className="rounded-control font-serif text-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Life With Christ
            </Link>

            {/*
              The journal page is not in the nav list and not buried in
              settings. Data durability is the whole point of the product, so
              the way out of it — and, now, the way in — is visible on every
              view, always in the same place.

              One control rather than two. Import belongs beside Export because
              they are the same subject, and a third button in a header that
              already has to survive 200% text at 320px would cost more than it
              bought. `aria-current` marks it on either page.
            */}
            <div className="flex min-w-0 flex-wrap items-center gap-2 sm:order-last">
              <Link
                to={{ name: 'data' }}
                aria-current={route.name === 'data' || route.name === 'import' ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-control border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  route.name === 'data' || route.name === 'import'
                    ? 'border-accent bg-accent text-accent-ink'
                    : 'border-line-strong bg-surface text-ink-soft hover:bg-raised'
                }`}
              >
                {/* Named for both directions now that it is both. "Journal"
                    alone would sit next to "My journey" in the same bar and
                    mean something different. */}
                <span aria-hidden="true">↓</span> Import / export
              </Link>
              <ThemeToggle />
            </div>
          </div>

          {/*
            The nav scrolls sideways rather than wrapping if it ever outgrows a
            narrow screen: a second ragged line is worse than a scroll, and the
            negative margin lets it bleed to the edge so it reads as scrollable.
          */}
          <nav
            aria-label="Main"
            className="-mx-5 min-w-0 overflow-x-auto px-5 sm:mx-0 sm:flex-1 sm:overflow-visible sm:px-0"
          >
            <ul className="flex gap-1 whitespace-nowrap">
              {NAV.map((item) => {
                const current = isCurrent(route, item.route);
                return (
                  <li key={item.label}>
                    <Link
                      to={item.route}
                      aria-current={current ? 'page' : undefined}
                      className={`inline-flex min-h-11 items-center rounded-control border px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
                        // A quiet tinted chip, not a filled slab. Weight carries
                        // the state as well as colour does, so the cue is not
                        // colour alone — and aria-current says it outright.
                        current
                          ? 'border-accent/40 bg-accent-soft font-semibold text-ink'
                          : 'border-transparent text-ink-soft hover:bg-raised hover:text-ink'
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

      <main id="main" className="mx-auto max-w-3xl px-5 py-8 sm:py-10">
        {/* Focus lands here after navigation, ahead of the page heading. */}
        <div ref={headingRef} tabIndex={-1} className="outline-none">
          {children}
        </div>
      </main>

      <footer className="mx-auto max-w-3xl border-t border-line px-5 pb-12 pt-6 text-xs text-ink-muted">
        <p>
          Everything here stays on this device.{' '}
          <Link to={{ name: 'data' }} className="underline focus-visible:outline-2">
            Browser storage is not a backup — export your journal
          </Link>
          .
        </p>
        {/* The product home, as text rather than a link.
            A link would be a destination this application does not need and
            cannot vouch for offline; naming it costs nothing and adds no
            network dependency of any kind. */}
        <p className="mt-1">Life With Christ · myjourneywithchrist.com</p>
      </footer>
    </div>
  );
}
