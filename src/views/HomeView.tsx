/**
 * The front door.
 *
 * Someone arriving here is usually in one of two moods: they want to read
 * something, or a sermon just started and they need a box to type in. Four large
 * targets cover both, and the page says plainly what the app is and where the
 * writing lives — on this device, not on someone's server. That is a promise the
 * product makes, so it is stated at the entrance rather than buried in settings.
 */

import { useEffect, useId, useState } from 'react';

import { Link, type Route } from '../app/router';
import { useStorageQuery } from '../app/storage';
import { readIntro, rememberIntro } from './home-intro';
import { cardClasses } from '../components/styles';
import { Spinner } from '../components/ui';
import type { Entry, EntryKind } from '../types';

/** How many recent entries the front page shows. A glance, not a list. */
const RECENT_COUNT = 3;

/**
 * The two paragraphs that say what this is.
 *
 * A real disclosure: a button that owns the region, says whether it is open,
 * and can be reached and operated from the keyboard. Collapsed content is
 * removed from the tree rather than visually hidden, so a screen reader is not
 * offered prose the page is pretending is not there.
 *
 * What is NOT in here: the durability warning. "The copy on this device is not
 * a backup" sits in the footer of every page, including this one, and that is
 * the sentence a person must not be able to collapse away.
 */
function Introduction() {
  // Never seen before means open. Anything else is what the reader last left.
  const [open, setOpen] = useState(() => readIntro() !== 'closed');
  const regionId = useId();

  // Record that it has now been seen, so the next visit is quiet. In an effect
  // rather than in the initializer above: this is a side effect, it must not
  // run during render, and running it twice changes nothing.
  useEffect(() => {
    if (readIntro() === null) rememberIntro(false);
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    rememberIntro(next);
  };

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={regionId}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-control text-sm font-medium text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span
          aria-hidden="true"
          className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
        What is this?
      </button>

      {open ? (
        <div id={regionId} className="mt-2">
          <p className="measure text-lg leading-relaxed text-ink-soft">
            A place to read the Bible and keep what you hear — sermons, readings, prayers, and what
            they meant to you at the time. Over the years it becomes{' '}
            <em>My Journey With Christ</em>: a record you can keep, print and pass on.
          </p>
          <p className="measure mt-4 leading-relaxed text-ink-muted">
            Everything you write stays on this device. There is no account and nothing is uploaded.
            Because of that, the{' '}
            <Link
              to={{ name: 'data' }}
              className="rounded-control underline decoration-line-strong underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              export
            </Link>{' '}
            is what you actually own — a folder of plain files a grandchild could read without this
            app. These are your words, your prayers, your story.
          </p>
        </div>
      ) : null}
    </div>
  );
}

const KIND_LABELS: Record<EntryKind, string> = {
  sermon: 'Sermon',
  reading: 'Reading',
  service: 'Service',
  prayer: 'Prayer',
  reflection: 'Reflection',
  letter: 'Letter',
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local-date parse: see the note in TimelineView — a UTC parse loses a day. */
function formatDay(iso: string): string {
  const match = ISO_DATE.exec(iso);
  if (!match) return 'No date recorded';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return 'No date recorded';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

const DESTINATIONS: Array<{ route: Route; label: string; description: string; primary?: boolean }> =
  [
    {
      route: { name: 'newEntry' },
      label: 'New sermon note',
      description: 'Start writing now — the details can wait until afterwards.',
      primary: true,
    },
    {
      route: { name: 'browse' },
      label: 'Bible',
      description: 'Read any passage, and write against it.',
    },
    {
      route: { name: 'topics' },
      label: 'Topics',
      description: 'Fear, forgiveness, grief — scripture gathered by what you are facing.',
    },
    {
      route: { name: 'timeline' },
      label: 'My journey',
      description: 'Everything you have written, oldest first.',
    },
  ];

export default function HomeView() {
  const { data: entries, loading } = useStorageQuery<Entry[]>(
    (storage) => storage.listEntries(),
    [],
    [],
  );

  const recent = entries.slice(0, RECENT_COUNT);

  return (
    <div>
      {/*
        Vertical rhythm, deliberately uneven: the title and its opening line
        belong together, the privacy note is a separate thought, and "Where to
        begin" starts a new section. Equal gaps everywhere would have said all
        three were equally related.
      */}
      {/*
        The page's heading, read but not seen.

        The name and the tagline are shown once, in the header, which is what
        took a repeated title off the top of this screen. A page still needs a
        heading though: screen-reader users navigate by them, and the
        accessibility gate requires exactly one h1 per view, inside <main>.
        Hiding it visually keeps the space and keeps the structure.
      */}
      <h1 className="sr-only">My Life With Christ</h1>

      <Introduction />

      <section className="mt-10">
        <h2 className="font-serif text-xl font-semibold tracking-tight">Where to begin</h2>
        {/*
          `auto-rows-fr` is what makes this one component family rather than four
          boxes that happen to sit near each other: every row gets an equal
          track, so a description one line longer than its neighbour's no longer
          makes its card structurally taller. The card itself is h-full, so it
          fills whatever the track gives it.
        */}
        <ul className="mt-4 grid gap-4 sm:auto-rows-fr sm:grid-cols-2">
          {DESTINATIONS.map((destination) => (
            <li key={destination.label} className="flex">
              <Link
                to={destination.route}
                // Featured is a tint and a border, not a different component.
                // Inverting this card to a solid fill made it a stark white
                // rectangle in dark mode — plainly not one of the four.
                className={`flex h-full w-full flex-col p-5 ${cardClasses({
                  featured: destination.primary,
                  interactive: true,
                })}`}
              >
                <span className="font-serif text-base font-semibold text-ink">
                  {destination.label}
                </span>
                <span className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                  {destination.description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {loading ? <Spinner label="Loading your journal" /> : null}

      {!loading && recent.length > 0 ? (
        <section className="mt-10">
          <h2 className="font-serif text-xl font-semibold tracking-tight">Recently written</h2>
          {/*
            A list, not four more cards. These are rows of text the reader scans;
            boxing each one would have said they were the same kind of thing as
            the navigation above, and doubled the number of borders on the page.
          */}
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {recent.map((entry) => (
              <li key={entry.id}>
                <Link
                  to={{ name: 'entry', id: entry.id }}
                  className="block px-1 py-3.5 transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
                >
                  <span className="block font-medium text-ink">
                    {entry.title || 'Untitled entry'}
                  </span>
                  <span className="mt-1 block text-sm text-ink-muted">
                    {[KIND_LABELS[entry.kind], formatDay(entry.date), entry.speaker]
                      .filter((part): part is string => Boolean(part))
                      .join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm">
            <Link
              to={{ name: 'timeline' }}
              className="rounded-control underline decoration-line-strong underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              See the whole journey
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
