/**
 * What a stranger needs to know before they start typing.
 *
 * This site is public, so most people arriving have no idea what it is or where
 * their writing goes. The honest facts are also the reassuring ones — nothing is
 * uploaded, no account is needed — but one of them is a hazard: clearing browser
 * data destroys the journal, and someone who learns that on the day it happens
 * has learned it too late. So it is acknowledged before anything else.
 *
 * Built on the native <dialog> element with showModal(), which is what gives
 * correct behaviour for free and without a hand-rolled trap: focus is confined
 * while it is open, Escape closes it, it renders in the top layer above
 * everything, and focus returns to wherever it came from on close. A hand-built
 * "modal" out of divs gets some of that and silently misses the rest.
 *
 * Shown once, dismissed permanently, remembered per-browser.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'journey:welcomed';

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Site data blocked. Showing the notice again is the harmless failure.
    return false;
  }
}

export function FirstVisitNotice() {
  const [open, setOpen] = useState(() => !alreadySeen());
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    if (!dialog.open) dialog.showModal();
  }, [open]);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Not being able to remember is not worth failing over.
    }
    dialogRef.current?.close();
    setOpen(false);

    // On a first visit nothing had focus, so there is nowhere for the browser
    // to return it to and it would fall back to <body>. Put it on the page
    // heading instead, which is where a keyboard user expects to resume.
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>('main [tabindex="-1"]') ?? document.querySelector('main');
      target?.focus?.();
    });
  }, []);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="welcome-heading"
      onCancel={(event) => {
        // Escape fires `cancel`; treat it as a dismissal so the notice does not
        // reappear on every navigation.
        event.preventDefault();
        dismiss();
      }}
      className="print-hidden m-auto w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-amber-300 bg-amber-50 p-0 text-amber-950 backdrop:bg-slate-900/50 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50"
    >
      <div className="p-5">
        <h2 id="welcome-heading" className="font-serif text-lg font-semibold">
          Before you start writing
        </h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed">
          <li>
            <strong>There is no server and no account.</strong> Nothing you write is uploaded, and
            nobody else can read it — not even whoever runs this site.
          </li>
          <li>
            <strong>Your notes live in this browser, on this device.</strong> They will not appear on
            your phone, or in another browser, or after you clear your browsing data.
          </li>
          <li>
            <strong>Clearing your browser data will destroy them permanently.</strong> There is no
            copy anywhere else to restore from.
          </li>
          <li>
            <strong>So export early, and often.</strong> Export gives you a file you own — plain
            text, readable without this site, yours to keep and to pass on.
          </li>
        </ul>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex min-h-11 items-center rounded-lg bg-amber-900 px-4 py-2 text-sm font-medium text-amber-50 hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current dark:bg-amber-100 dark:text-amber-950 dark:hover:bg-white"
          >
            I understand
          </button>
          <a
            href="#/data"
            onClick={dismiss}
            className="inline-flex min-h-11 items-center rounded-lg border border-amber-700 px-4 py-2 text-sm font-medium hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current dark:border-amber-400 dark:hover:bg-amber-900"
          >
            See how exporting works
          </a>
        </div>
      </div>
    </dialog>
  );
}
