/**
 * What a stranger needs to know before they start typing.
 *
 * This site is public, so most people arriving have no idea what it is or where
 * their writing goes. The honest facts are also the reassuring ones — nothing is
 * uploaded, no account is needed — but one of them is a hazard: clearing browser
 * data destroys the journal, and someone who learns that on the day it happens
 * has learned it too late.
 *
 * Shown once, dismissed permanently, stored per-browser. Rendered as a real
 * dialog so it is announced and can be closed from the keyboard, but it is
 * deliberately not modal-with-no-escape: it never blocks reading.
 */

import { useEffect, useRef, useState } from 'react';

import { Button } from './ui';

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
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {
      // Not being able to remember is not worth failing over.
    }
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="welcome-heading"
      className="print-hidden border-b border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950"
    >
      <div className="mx-auto max-w-3xl px-4 py-4">
        <h2 id="welcome-heading" className="font-serif text-base font-semibold text-amber-900 dark:text-amber-100">
          Before you start writing
        </h2>
        <ul className="mt-2 space-y-1 text-sm text-amber-900 dark:text-amber-100">
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
        <div className="mt-3 flex flex-wrap gap-2">
          <Button ref={closeRef} variant="primary" onClick={dismiss}>
            I understand
          </Button>
          <a
            href="#/data"
            onClick={dismiss}
            className="inline-flex min-h-11 items-center rounded-lg border border-amber-400 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-amber-600 dark:text-amber-100 dark:hover:bg-amber-900"
          >
            See how exporting works
          </a>
        </div>
      </div>
    </div>
  );
}
