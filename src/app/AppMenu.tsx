/**
 * The application menu: one information architecture, two widths.
 *
 * There is a single list of destinations. On a phone the header carries a
 * hamburger and the whole list lives in the drawer, which is what keeps the
 * chrome down to one row on a screen meant for writing. On a wide screen the
 * primary destinations stay visible in the header and the drawer is where the
 * application pages live — Data & Backup, Settings, Help, About. Same
 * structure, expressed to fit; not three navigation systems.
 *
 * The drawer is a real modal interaction rather than a styled dropdown:
 * focus moves into it, cannot fall behind it, Escape closes it, choosing a
 * destination closes it, and focus returns to the button that opened it. Those
 * are asserted in tests, because a menu that traps a keyboard user is worse
 * than no menu.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { PRIMARY, SECONDARY, type MenuDestination } from './destinations';
import { registerOverlay } from './overlay';
import { Link, type Route } from './router';

/** Three bars, drawn rather than imported. A font for one glyph is a bad trade. */
function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      {open ? (
        <>
          <path d="M5 5l10 10" />
          <path d="M15 5L5 15" />
        </>
      ) : (
        <>
          <path d="M3 6h14" />
          <path d="M3 10h14" />
          <path d="M3 14h14" />
        </>
      )}
    </svg>
  );
}

export interface AppMenuProps {
  /** Which destination is current, for `aria-current`. */
  isCurrent: (route: Route) => boolean;
  /** Told when the drawer opens or closes, so the shell can react. */
  onOpenChange?: (open: boolean) => void;
}

export function AppMenu({ isCurrent, onOpenChange }: AppMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** Set while closing, so focus returns only when the menu caused it. */
  const restoreFocus = useRef(false);

  const close = useCallback(() => {
    restoreFocus.current = true;
    setOpen(false);
  }, []);

  useEffect(() => {
    onOpenChange?.(open);

    // Announce itself as the thing on top, so Android's back gesture closes the
    // menu rather than navigating the page underneath it. Registered here, by
    // the component that owns the close, rather than threaded through the shell.
    registerOverlay(open ? close : null);
    return () => registerOverlay(null);
  }, [open, onOpenChange, close]);

  // Focus into the panel when it opens, and back to the trigger when it closes.
  // Returning focus matters more than it looks: without it a keyboard user who
  // dismisses the menu lands at the top of the document and has to walk back.
  useEffect(() => {
    if (open) {
      panelRef.current?.focus();
      return;
    }
    if (restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;

      // Keep Tab inside the panel while it is modal.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const item = (destination: MenuDestination) => {
    const current = isCurrent(destination.route);
    return (
      <li key={destination.label}>
        <Link
          to={destination.route}
          aria-current={current ? 'page' : undefined}
          onClick={close}
          className={`flex min-h-11 items-center rounded-control px-3 py-2 text-base transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 ${
            current
              ? 'bg-accent-soft font-semibold text-ink'
              : 'text-ink-soft hover:bg-raised hover:text-ink'
          }`}
        >
          {destination.label}
        </Link>
      </li>
    );
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-ink-soft hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <HamburgerIcon open={open} />
        <span className="sr-only sm:not-sr-only">{open ? 'Close menu' : 'Menu'}</span>
      </button>

      {open ? (
        <>
          {/* A click outside dismisses. Rendered as a sibling rather than a
              parent so the panel is not inside the element that closes it. */}
          <div
            className="fixed inset-0 z-40 bg-ink/40"
            onClick={close}
            aria-hidden="true"
          />

          <div
            id={panelId}
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            tabIndex={-1}
            /* safe-* keeps the panel clear of the status bar and the home
               indicator; overflow-y-auto keeps every item reachable at 200%
               text, where the list is taller than a phone. */
            className="safe-top safe-bottom safe-sides fixed right-0 top-0 z-50 flex h-dvh w-72 max-w-[85vw] flex-col overflow-y-auto border-l border-line bg-surface outline-none"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <span className="font-serif text-base font-semibold">Menu</span>
              <button
                type="button"
                onClick={close}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-ink-soft hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <HamburgerIcon open />
                <span className="sr-only">Close menu</span>
              </button>
            </div>

            <nav aria-label="All destinations" className="px-2 pb-4">
              {/* The primary group is repeated here on purpose: on a phone this
                  drawer is the only navigation, and a menu that omitted the
                  Bible would be a menu for the application's paperwork. */}
              <ul className="space-y-0.5">{PRIMARY.map(item)}</ul>

              <hr className="my-3 border-line" />

              <ul className="space-y-0.5">{SECONDARY.map(item)}</ul>
            </nav>
          </div>
        </>
      ) : null}
    </>
  );
}
