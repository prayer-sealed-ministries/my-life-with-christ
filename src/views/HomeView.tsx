/**
 * The front door.
 *
 * Someone arriving here is usually in one of two moods: they want to read
 * something, or a sermon just started and they need a box to type in. Six large
 * targets cover both, and the page says plainly what the app is and where the
 * writing lives — on this device, not on someone's server. That is a promise the
 * product makes, so it is stated at the entrance rather than buried in settings.
 */

import { useEffect, useId, useState, type ReactElement } from 'react';

import { Link, type Route } from '../app/router';
import { useStorageQuery } from '../app/storage';
import { readIntro, rememberIntro } from './home-intro';
import { cardClasses } from '../components/styles';
import {
  BookIcon,
  PenIcon,
  PrayIcon,
  ReflectIcon,
  SearchIcon,
  TopicsIcon,
  VolumeIcon,
} from '../components/icons';
import { Spinner } from '../components/ui';
import type { Entry, EntryDraft, EntryKind } from '../types';
import { isResumable } from '../lib/drafts';
import { ENTRY_KIND_LABELS } from '../lib/entry-kinds';
import { LAUNCH_ACTIONS } from '../app/launch-actions';

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
            Everything you write is stored on this device. There is no account, and this app
              uploads nothing.
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

/**
 * The six things a person actually opens this app to do.
 *
 * Three of them write and three of them look something up, and they are
 * ordered that way: a sermon has started and you need a box, or it has not and
 * you are reading. Prayer and Reflection are here because the route can now
 * say which kind it wants — `#/entry/new?kind=prayer` opens a blank entry
 * already set to Prayer. Before that the only honest thing was to leave them
 * out, because a card that opened the ordinary sermon form would have been a
 * card that lied.
 *
 * Only the sermon note is featured, and that is a statement about frequency
 * rather than worth: it is the one written in a hurry, standing up, while
 * somebody is still talking. The other five carry the ordinary card surface,
 * which is the same surface every other tappable thing on this page has.
 */
const ACTIONS: Array<{
  route: Route;
  label: string;
  description: string;
  Icon: (props: { className?: string }) => ReactElement;
  /**
   * The icon chip's colour.
   *
   * A tint per action, so the row reads as a considered set rather than one
   * bright tile among five grey ones. These are decoration and nothing else —
   * the accent is still reserved for interaction and selection, and the
   * primary action is the only thing wearing it. See the note beside the
   * tokens in src/index.css.
   */
  tint?: string;
  primary?: boolean;
}> = [
  {
    // The same destination the Android launcher shortcut selects, read from
    // the one table rather than written twice. Home and the shortcut are two
    // doorways into one editor, and a second spelling here is how they would
    // quietly stop being the same door.
    route: LAUNCH_ACTIONS['sermon-fast-capture'],
    label: 'Sermon note',
    description: 'Start writing now',
    Icon: PenIcon,
    primary: true,
  },
  {
    route: { name: 'newEntry', kind: 'prayer' },
    label: 'Prayer',
    description: 'Record a prayer',
    tint: 'bg-chip-prayer text-chip-prayer-ink',
    Icon: PrayIcon,
  },
  {
    route: { name: 'newEntry', kind: 'reflection' },
    label: 'Reflection',
    description: 'Write what this meant to you',
    tint: 'bg-chip-reflect text-chip-reflect-ink',
    Icon: ReflectIcon,
  },
  {
    route: { name: 'browse' },
    label: 'Read Scripture',
    description: 'Open the Bible',
    Icon: BookIcon,
    tint: 'bg-chip-scripture text-chip-scripture-ink',
  },
  {
    route: { name: 'topics' },
    label: 'Topics',
    description: 'What you are facing',
    Icon: TopicsIcon,
    tint: 'bg-chip-topics text-chip-topics-ink',
  },
  {
    route: { name: 'search', query: '' },
    label: 'Search',
    description: 'Find anything you wrote',
    Icon: SearchIcon,
    tint: 'bg-chip-search text-chip-search-ink',
  },
];

/**
 * Today, in the reader's own locale, computed on the device.
 *
 * No network, no "day 14 of a streak", no count of anything. It is a quiet
 * orientation line — the sort of thing a paper journal has printed at the top
 * of the page — and nothing about it keeps score.
 */
function today(now = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
}

/**
 * A short, safe line from an entry: its own first line, never the whole note.
 *
 * `notes` and `reflection` only. An entry can carry sermon notes a church
 * provided, and those are emphatically NOT what "Recently written" means — a
 * reader who imported a handout on Sunday and has not written anything yet
 * must not open this page to find a line of somebody else's outline sitting
 * under a heading claiming they wrote it. With nothing of their own here, the
 * card falls back to its title, kind and date, and says plainly what it has.
 */
function previewOf(entry: Entry): string {
  const source = (entry.notes || entry.reflection || '').trim();
  if (!source) return '';
  const firstLine = source.split('\n').find((line) => line.trim().length > 0) ?? '';
  const clean = firstLine.replace(/^[#>*\-\s]+/, '').trim();
  return clean.length > 96 ? `${clean.slice(0, 95)}\u2026` : clean;
}

/** "Started 11:04 AM", or the date if it was not today. */
function startedAt(iso: string, now = new Date()): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  const sameDay = when.toDateString() === now.toDateString();
  return sameDay
    ? `Started ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : `Started ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`;
}

export default function HomeView() {
  const { data: entries, loading } = useStorageQuery<Entry[]>(
    (storage) => storage.listEntries(),
    [],
    [],
  );

  /**
   * Unfinished writing, offered back.
   *
   * Kept apart from "Recently written" on purpose. A draft is not a finished
   * entry, and showing the two in one list would make a half-sentence look like
   * something that had been decided on — this journal's whole promise is that
   * the finished record means something.
   */
  const { data: drafts } = useStorageQuery<EntryDraft[]>(
    (storage) => storage.listDrafts(),
    [],
    [],
  );
  const resumable = drafts.filter(isResumable);
  const continueWith = resumable[0];

  const recent = entries.slice(0, RECENT_COUNT);

  return (
    <div>
      {/*
        The page's heading, read but not seen.

        The name and the tagline are shown once, in the header. A page still
        needs a heading though: screen-reader users navigate by them, and the
        accessibility gate requires exactly one h1 per view, inside <main>.
        Hiding it visually keeps the space and keeps the structure.
      */}
      <h1 className="sr-only">My Life With Christ</h1>

      {/*
        The opening: a date and an invitation, three lines tall.

        Not a hero. The old page spent its first screen repeating the app's name
        and explaining itself; what a person wants at the top of a journal is
        today's date and somewhere to write.
      */}
      <header>
        <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">{today()}</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-ink">
          Continue your journey
        </h2>
      </header>

      {/*
        Two columns where there is room, one where there is not.

        The breakpoint is in `rem`, not pixels, and that is the whole trick: a
        reader who enlarges their browser text moves it with them. At the default
        size 22.5rem is 360px, so an ordinary phone gets two columns; at doubled
        text it is 720px, so the same phone gets one — which is what you want,
        because two columns of 32px text on a 390px screen is three words on four
        lines. `auto-rows-fr` keeps a card whose description wraps from leaving
        its neighbour short.

        Three across once there is room, not four. With six actions four
        columns makes a row of four and an orphaned row of two, which reads as
        a page that ran out rather than a set; three gives two full rows of
        three. At two columns a 768px page gave each card 530px with the words
        in the top-left corner, which read as empty rectangles rather than
        things to do, so the wide breakpoint stays.

        `min-w-0` on each item is not decoration: a grid item defaults to
        min-width:auto and refuses to shrink below its own content, so at 320px
        with doubled text the cards rendered 338px wide in a 280px column and
        took the whole page sideways with them.
      */}
      <ul className="mt-5 grid auto-rows-fr gap-3 min-[22.5rem]:grid-cols-2 min-[48rem]:grid-cols-3">
        {ACTIONS.map(({ route, label, description, Icon, primary, tint }) => (
          <li key={label} className="flex min-w-0">
            <Link
              to={route}
              /*
                Icon beside the words in the middle, icon above them at both
                ends — and the low end is the one that was wrong.

                A card puts the icon on the left when there is room for the
                label beside it. Measured: the icon, the gap, the card's own
                padding and the page's come to 8.1rem, and the longest label
                needs about 8 — so below roughly 17rem of viewport the label
                has nowhere to go. It did not fail by overflowing, which is why
                nothing caught it: `break-word` did as it was told and a reader
                at 320px with 200% text got "Ser / mo / n / not / e" down five
                lines of a card. Stacking gives the label the whole width.

                Both bounds are in rem so the reader's own text size moves
                them, which is the entire point: at 200% text a 320px phone is
                a 10rem viewport, and 10rem of anything cannot hold a row.
              */
              className={`flex h-full w-full items-center gap-3.5 p-4 ${cardClasses({
                featured: primary,
                interactive: true,
              })} active:brightness-95 max-[17rem]:flex-col max-[17rem]:items-start max-[17rem]:gap-3 min-[22.5rem]:flex-col min-[22.5rem]:items-start min-[22.5rem]:gap-3 min-[22.5rem]:p-5`}
            >
              <span
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control ${
                  primary ? 'bg-accent text-accent-ink' : (tint ?? 'bg-raised text-ink-soft')
                }`}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-serif text-base font-semibold text-ink">{label}</span>
                <span className="mt-0.5 block text-sm text-ink-soft">{description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/*
        Picking up where they left off, before anything else on the page.

        Above "Recently written" because unfinished work is the thing most
        likely to be why someone opened the app, and starting a second copy of
        the note they already began is the outcome this prevents. Restrained: a
        card, not a dashboard — if there are more, they are reachable from the
        timeline like everything else.
      */}
      {continueWith ? (
        <section className="mt-8" aria-labelledby="continue-heading">
          <h2 id="continue-heading" className="sr-only">
            Unfinished writing
          </h2>
          <Link
            to={
              continueWith.entryId
                ? { name: 'entry', id: continueWith.entryId }
                : { name: 'newEntry', draft: continueWith.id }
            }
            className={`flex w-full items-center gap-3.5 p-4 ${cardClasses({
              interactive: true,
            })} active:brightness-95`}
          >
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {/* Labelled, so it can never be mistaken for a finished entry. */}
                <span className="rounded-control bg-raised px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-ink-soft">
                  Draft
                </span>
                <span className="font-serif text-base font-semibold text-ink">
                  Continue {ENTRY_KIND_LABELS[continueWith.form.kind].toLowerCase()}
                </span>
              </span>
              <span className="mt-1 block truncate text-sm text-ink-soft">
                {continueWith.form.title.trim() || startedAt(continueWith.updatedAt)}
              </span>
              {resumable.length > 1 ? (
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {resumable.length - 1} more unfinished
                </span>
              ) : null}
            </span>
          </Link>
        </section>
      ) : null}

      {loading ? <Spinner label="Loading your journal" /> : null}

      {!loading ? (
        <section className="mt-10" aria-labelledby="recent-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="recent-heading" className="font-serif text-xl font-semibold tracking-tight">
              Recently written
            </h2>
            {recent.length > 0 ? (
              <Link
                to={{ name: 'timeline' }}
                className="rounded-control text-sm text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                See the whole journey
              </Link>
            ) : null}
          </div>

          {recent.length === 0 ? (
            /* An empty journal is the beginning of one, and should read that
               way. No illustration, no encouragement to "get started" — just
               what this page is for. */
            <div className={`mt-4 p-5 ${cardClasses()}`}>
              <p className="font-serif text-base font-semibold text-ink">
                Your journey begins here.
              </p>
              <p className="measure mt-1.5 text-sm leading-relaxed text-ink-soft">
                Write a sermon note, a prayer or a reflection, and it will be waiting here
                afterwards.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {recent.map((entry) => {
                const preview = previewOf(entry);
                return (
                  <li key={entry.id} className="flex">
                    <Link
                      to={{ name: 'entry', id: entry.id }}
                      className={`w-full p-4 ${cardClasses({ interactive: true })} active:brightness-95`}
                    >
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                        <span className="rounded-full bg-raised px-2 py-0.5 font-medium text-ink-soft">
                          {KIND_LABELS[entry.kind]}
                        </span>
                        <span>{formatDay(entry.date)}</span>
                        {entry.scriptureRefs?.[0] ? <span>· {entry.scriptureRefs[0]}</span> : null}
                      </span>
                      <span className="mt-1.5 block font-serif text-base font-semibold text-ink">
                        {entry.title || 'Untitled entry'}
                      </span>
                      {preview ? (
                        <span className="measure mt-1 block text-sm leading-relaxed text-ink-soft">
                          {preview}
                        </span>
                      ) : entry.sourceMaterial ? (
                        <span className="mt-1 block text-sm text-ink-muted">
                          Imported sermon notes · nothing written yet
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      {/*
        The book the journal becomes, offered quietly.

        It is the point of the whole product and still not the thing to do on a
        Tuesday, so it sits below the writing and reading, once, without a
        picture of a family on it.
      */}
      <section className="mt-10" aria-labelledby="book-heading">
        <Link
          to={{ name: 'legacy' }}
          className={`flex items-start gap-3.5 p-5 ${cardClasses({ interactive: true })} active:brightness-95`}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-raised text-ink-soft">
            <VolumeIcon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span
              id="book-heading"
              className="block font-serif text-base font-semibold text-ink"
            >
              My Journey With Christ
            </span>
            <span className="measure mt-1 block text-sm leading-relaxed text-ink-soft">
              See the story your journal is becoming — one long page, ready to print.
            </span>
          </span>
        </Link>
      </section>

      {/* Secondary now, and below the things a person came to do. */}
      <div className="mt-10 border-t border-line pt-6">
        <Introduction />
      </div>
    </div>
  );
}
