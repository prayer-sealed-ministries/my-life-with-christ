/**
 * The application shell: navigation, landmarks, and route-change focus.
 *
 * Two accessibility obligations live here because they cannot be met view by
 * view. First, a skip link and real landmarks, so a keyboard or screen-reader
 * user is not walked through the whole nav on every page. Second, focus
 * management: a hash change does not move focus on its own, so after each
 * navigation focus goes to the new page heading and the route is announced.
 * Without that, a screen-reader user hears nothing at all when the page changes.
 *
 * It also owns the third obligation, which is the opposite of the first two:
 * getting out of the way. In focus mode the header, the navigation and the
 * footer are not rendered at all — not hidden with CSS, which would leave them
 * in the tab order and in the accessibility tree — so the editor has the
 * viewport and a reader writing in a pew is not tabbing past four destinations
 * to reach their own sentence. Everything the app must still be able to say —
 * the route announcement, the save confirmation, the first-visit notice — stays.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { FirstVisitNotice } from '../components/FirstVisitNotice';
import { AppMenu } from './AppMenu';
import { useFocusMode } from './focus-context';
import { useNotice } from './notice-context';
import { Link, useRouter, type Route } from './router';

/**
 * The product name and what it is, said once.
 *
 * Both used to appear twice on the home screen — in the header and again as a
 * large heading with the tagline under it — which spent most of a phone's first
 * screen repeating what the header had already said. They live here now, and
 * the home view goes straight to what a reader came for.
 */
const APP_NAME = 'My Life With Christ';
const TAGLINE = 'Your walk, remembered.';

const NAV: Array<{ route: Route; label: string }> = [
  { route: { name: 'browse' }, label: 'Bible' },
  { route: { name: 'topics' }, label: 'Topics' },
  { route: { name: 'timeline' }, label: 'My journey' },
  { route: { name: 'search', query: '' }, label: 'Search' },
];

/** The name, as a link home. Never a heading — see the note at its use. */
function BrandMark() {
  return (
    <div className="min-w-0">
      <Link
        to={{ name: 'home' }}
        className="rounded-control font-serif text-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {APP_NAME}
      </Link>
    </div>
  );
}

const isCurrent = (route: Route, nav: Route): boolean => {
  if (route.name === nav.name) return true;
  if (nav.name === 'browse') return route.name === 'book' || route.name === 'passage';
  if (nav.name === 'topics') return route.name === 'topic';
  if (nav.name === 'timeline') return route.name === 'entry' || route.name === 'newEntry';
  return false;
};



export function Shell({ children, title }: { children: ReactNode; title: string }) {
  const { route } = useRouter();
  const { notice } = useNotice();
  const { focused } = useFocusMode();
  const headingRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const firstRender = useRef(true);

  useEffect(() => {
    document.title =
      title === APP_NAME ? APP_NAME : `${title} — ${APP_NAME}`;

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

      {focused ? null : (
        <header className="safe-top safe-sides border-b border-line bg-surface">
          {/*
            Two rows on a phone, one row on a desktop — and the switch is at `md`
            (768px), not `sm` (640px).

            Measured, not chosen: the brand is 174px, the actions 238px and the
            primary nav needs 293px, which with a 12px gap either side and 40px of
            padding comes to ~768px. At 640 the same row was asked to fit in 125px
            less than it needs and cut "Search" off the end. Because this row is
            capped at max-w-3xl it can never be wider than 768, so fitting at 768
            means fitting at every width above it — one boundary settles all of
            them. Below it the hamburger is the navigation, which is what it
            already is on a phone, and it reaches all nine destinations.

            `md:contents` dissolves the grouping wrapper at width, so brand,
            actions and nav become siblings of the same flex row. This was one
            flex-wrap line before; at 390px it wrapped into a ragged four-line
            block 217px tall — a quarter of the viewport spent on chrome, above a
            page meant for writing.
          */}
          <div className="mx-auto flex max-w-3xl flex-col gap-1 px-5 py-2 md:flex-row md:items-center md:gap-3 md:py-2.5">
            {/* `flex-wrap` and `min-w-0` are what make 1.4.4 and 1.4.12 survivable.
                A flex item defaults to min-width:auto, so it refuses to shrink below
                its content and pushes the page wider instead of letting the nav's
                own overflow take over. At 200% text in a 320px viewport that was
                536px of page in a 320px window. */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 md:contents">
              {/* Deliberately not a heading. The accessibility suite states the
                  rule outright — "only headings inside <main>: the shell's
                  chrome is not the view's" — so every view owns its own h1 and
                  this stays a link. Home keeps an h1 that is read but not seen,
                  which is what let the visible title come out of that page. */}
              <BrandMark />

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
              <div className="flex min-w-0 flex-wrap items-center gap-2 md:order-last">
                {/* The menu is the only navigation on a phone and the way to the
                    application pages on a desktop, so it is always present. */}
                <AppMenu isCurrent={(nav) => isCurrent(route, nav)} />
                {/* Desktop only. Data durability stays one click away on a wide
                    screen, where there is room; on a phone it is in the drawer as
                    "Data & Backup" rather than spending a second header row. */}
                <Link
                  to={{ name: 'data' }}
                  aria-current={route.name === 'data' || route.name === 'import' ? 'page' : undefined}
                  className={`hidden min-h-11 items-center gap-1.5 rounded-control border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 md:inline-flex ${
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
              </div>
            </div>

            {/*
              The nav scrolls sideways rather than wrapping if it ever outgrows a
              narrow screen: a second ragged line is worse than a scroll, and the
              negative margin lets it bleed to the edge so it reads as scrollable.
            */}
            <nav
              aria-label="Main"
              className="hidden min-w-0 overflow-x-auto md:mx-0 md:block md:flex-1 md:overflow-visible md:px-0"
            >
              <ul className="flex gap-1 whitespace-nowrap">
                {NAV.map((item) => {
                  const current = isCurrent(route, item.route);
                  return (
                    <li key={item.label}>
                      <Link
                        to={item.route}
                        aria-current={current ? 'page' : undefined}
                        className={`inline-flex min-h-11 items-center rounded-control border px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
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

          {/*
            The tagline sits under the row rather than beside the name.

            Inside the row it was a third thing competing for a header capped at
            max-w-3xl: the main nav needs about 306px and was left 260, which cut
            "Search" off the end. On its own line it costs one small line of
            height and can never squeeze the navigation, at any width.
          */}
          <p className="mx-auto max-w-3xl px-5 pb-2 text-xs leading-tight text-ink-soft">
            {TAGLINE}
          </p>
        </header>
      )}

      <FirstVisitNotice />

      {/* Announce the new page to assistive tech, which a hash change does not. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {/*
        Above the routed view so it survives the navigation a save causes, and
        pinned to the viewport so it can actually be seen.

        Both halves were learned on a phone. Rendered in the document flow it
        worked for a new entry — that navigates and lands at the top — and was
        invisible for an edit, because the Save button is at the bottom of a
        long form and the message appeared somewhere above the fold. A
        confirmation nobody can see is the defect this whole change is about.

        Fixed, not a modal: it takes no focus, blocks nothing, and leaves on its
        own. Polite rather than assertive, because it must not interrupt
        somebody mid-sentence.
      */}
      {/* In focus mode the top of the screen belongs to the focus bar — its
          Save button is what produced this message, and a pill centred over it
          would cover the control the reader just used. So the confirmation goes
          to the bottom there, still fixed, still polite, still unmissable. */}
      <div
        aria-live="polite"
        className={`pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 ${
          focused ? 'bottom-0' : 'top-0'
        }`}
        style={
          focused
            ? { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }
            : { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }
        }
      >
        {notice ? (
          <p
            key={notice.key}
            className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink shadow-lg"
          >
            <span aria-hidden="true">✓</span>
            {notice.text}
          </p>
        ) : null}
      </div>

      {/* In focus mode the page IS the editor: the same reading width, but
          without the top padding that exists to separate content from a header
          that is no longer there.

          The side padding goes inline rather than through `.safe-sides`. That
          utility sets `padding-left` outright, and the header can use it only
          because the header itself carries no `px-*` — here `px-5` is in the
          utilities layer, which comes after base, so the class would quietly
          win and the inset would be lost on a notched phone in landscape. The
          header's safe-sides is gone with the header; this replaces it. */}
      <main
        id="main"
        className={focused ? 'mx-auto max-w-3xl pb-8' : 'mx-auto max-w-3xl px-5 py-8 sm:py-10'}
        style={
          focused
            ? {
                paddingLeft: 'calc(env(safe-area-inset-left, 0px) + 1.25rem)',
                paddingRight: 'calc(env(safe-area-inset-right, 0px) + 1.25rem)',
              }
            : undefined
        }
      >
        {/* Focus lands here after navigation, ahead of the page heading. */}
        <div ref={headingRef} tabIndex={-1} className="outline-none">
          {children}
        </div>
      </main>

      {focused ? null : (
        <footer className="mx-auto max-w-3xl border-t border-line px-5 pb-12 pt-6 text-xs text-ink-muted">
          <p>
            Everything here is stored on this device.{' '}
            <Link to={{ name: 'data' }} className="underline focus-visible:outline-2">
              The copy on this device is not a backup — export your journal
            </Link>
            .
          </p>
          {/* The product home, as text rather than a link.
              A link would be a destination this application does not need and
              cannot vouch for offline; naming it costs nothing and adds no
              network dependency of any kind. */}
          <p className="mt-1">{APP_NAME} · mylifewithchrist.com</p>
        </footer>
      )}
    </div>
  );
}
