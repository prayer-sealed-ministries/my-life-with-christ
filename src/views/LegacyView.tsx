/**
 * The book, on screen: one long page that prints straight to PDF.
 *
 * The archive already contains `book/my-journey-with-christ.html`, which is the
 * copy meant to outlive the app. This view is the same idea reached in one tap
 * from the app itself, for the person who wants paper now — a printed copy for
 * a parent, a folder in a drawer, something a grandchild can hold.
 *
 * So it is one scrollable document rather than a paginated reader: the browser's
 * own print dialog is the pagination, and anything that fights it (virtual
 * scrolling, collapsed sections, lazy loading) would print as blank paper.
 *
 * Notes are stored as Markdown and shown here as written, line breaks intact,
 * rather than rendered. Rendering would mean either injecting generated HTML
 * into the app or keeping a second Markdown implementation alongside the
 * archive's — and the archive's `book/` file is where rendered Markdown belongs.
 */

import { useMemo, useState } from 'react';

import { Link } from '../app/router';
import { useStorage, useStorageQuery } from '../app/storage';
import { usePrinter } from '../platform/context';
import { topicsById } from '../app/data';
import { Button, EmptyState, LiveRegion, Spinner, Tag } from '../components/ui';
import { KIND_LABELS } from '../export/context';
import { refToString } from '../lib/bible';
import { BOOK_NAMES, BOOK_ORDER } from '../lib/canon';
import { Markdown } from '../components/Markdown';
import type { Entry, EntryAnchor } from '../types';

type Order = 'date' | 'book';

/** A stable empty array: a fresh literal would re-run the query every render. */
const NO_ENTRIES: Entry[] = [];

const entryWords = (count: number): string => (count === 1 ? '1 entry' : `${count} entries`);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * An entry's date is a calendar date, not an instant.
 *
 * `new Date('2026-03-15')` parses as UTC midnight, which renders as the 14th
 * anywhere west of Greenwich. Reading the parts and building a local date keeps
 * an entry on the day it actually happened.
 */
function localDate(iso: string): Date | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The weekday matters in a journal kept on Sundays. */
const fullFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const shortFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function formatShort(iso: string): string {
  const date = localDate(iso);
  return date ? shortFormat.format(date) : iso;
}

/** "What is this entry about", in words a reader with no app can follow. */
function subjects(entry: Entry): string[] {
  return entry.anchors.map((anchor) => {
    if (anchor.kind === 'topic') {
      return `Topic: ${topicsById.get(anchor.topicId)?.name ?? anchor.topicId}`;
    }
    if (anchor.kind === 'book') return BOOK_NAMES[anchor.book] ?? anchor.book;
    // A passage anchor always carries a resolved range, so it reads correctly
    // whether or not the outline layer is in this build.
    return refToString(anchor, BOOK_NAMES[anchor.book] ?? anchor.book);
  });
}

/**
 * The anchor that decides where an entry files under canonical order.
 *
 * Book and position must come from the SAME anchor. Reading the book from one
 * and the chapter from another files an entry about Romans at Genesis 35's
 * position, and the printed book silently comes out in the wrong order.
 */
function primaryAnchor(entry: Entry): Exclude<EntryAnchor, { kind: 'topic' }> | null {
  for (const anchor of entry.anchors) {
    if (anchor.kind !== 'topic') return anchor;
  }
  return null;
}

/** The book an entry sits under when the journal is ordered canonically. */
function primaryBook(entry: Entry): string | null {
  return primaryAnchor(entry)?.book ?? null;
}

/** Where in that book, so Genesis 3 prints before Genesis 35. */
function positionInBook(entry: Entry): number {
  const anchor = primaryAnchor(entry);
  // A whole-book anchor names no position, so it leads the book it belongs to;
  // entries with no anchor at all share one group and fall back to date.
  return anchor?.kind === 'scripture' ? anchor.chapterStart * 1000 + anchor.verseStart : 0;
}

interface Section {
  key: string;
  label: string;
  entries: Entry[];
}

/**
 * Group the journal by book of the Bible, in canonical order.
 *
 * Entries anchored only to a topic, or to nothing, are not dropped — they
 * gather at the end under their own heading. A journal that loses entries when
 * you change the ordering is worse than useless for an inheritance.
 */
function byBook(entries: Entry[]): Section[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = primaryBook(entry) ?? '';
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      // The unanchored group sorts last; everything else by canonical order.
      if (a === '') return 1;
      if (b === '') return -1;
      return (BOOK_ORDER[a] ?? 99) - (BOOK_ORDER[b] ?? 99);
    })
    .map(([key, group]) => ({
      key: key || 'unanchored',
      label: key ? (BOOK_NAMES[key] ?? key) : 'Not tied to a book of the Bible',
      entries: [...group].sort(
        (a, b) => positionInBook(a) - positionInBook(b) || a.date.localeCompare(b.date),
      ),
    }));
}

function EntryPart({ heading, text, tone }: { heading: string; text: string; tone?: 'reflection' }) {
  return (
    <div className="mt-3">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
        {heading}
      </h4>
      {/*
        Rendered as Markdown, which is what this field has always been typed as.
        A note written before anything rendered it is plain text, and plain text
        is valid Markdown, so it comes out looking exactly as it did.

        break-words is inside the renderer for the same reason it was here: one
        pasted URL would otherwise push a 360px page sideways.
      */}
      <Markdown
        source={text}
        className={
          tone === 'reflection'
            ? // Set apart by shape, not by colour: an indent rule, italics, and
              // its own heading all survive a black-and-white print.
              'mt-1 border-l-4 border-line-strong pl-4 italic leading-relaxed'
            : 'mt-1 leading-relaxed'
        }
      />
    </div>
  );
}

function JournalEntry({ entry }: { entry: Entry }) {
  const about = subjects(entry);
  const mentioned = entry.scriptureRefs.map((ref) => ref.trim()).filter(Boolean);
  const tags = entry.tags.map((tag) => tag.trim()).filter(Boolean);
  const date = localDate(entry.date);

  return (
    <article className="break-inside-avoid border-t border-line pt-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-serif text-lg font-semibold break-words">{entry.title || 'Untitled'}</h3>
        {/* An unknown kind still prints its own word rather than a blank tag. */}
        <Tag>{KIND_LABELS[entry.kind] ?? entry.kind}</Tag>
      </div>

      <p className="mt-1 text-sm text-ink-soft">
        {/* <time> only when the date actually parses: datetime="" is not a date,
            and a machine reading this page should not be told that it is. */}
        {date ? (
          <time dateTime={entry.date}>{fullFormat.format(date)}</time>
        ) : (
          <span>No date recorded</span>
        )}
        {entry.place ? <span> · {entry.place}</span> : null}
        {entry.speaker ? <span> · Speaker: {entry.speaker}</span> : null}
        {entry.sermonSeries ? <span> · Series: {entry.sermonSeries}</span> : null}
      </p>

      {about.length > 0 ? (
        <p className="mt-1 text-sm text-ink-soft">On: {about.join('; ')}</p>
      ) : null}

      {entry.notes.trim() ? <EntryPart heading="Notes" text={entry.notes} /> : null}
      {entry.reflection.trim() ? (
        <EntryPart heading="Reflection" text={entry.reflection} tone="reflection" />
      ) : null}
      {entry.prayer?.trim() ? <EntryPart heading="Prayer" text={entry.prayer} /> : null}

      {mentioned.length > 0 ? (
        <p className="mt-3 text-sm text-ink-soft">
          Scripture mentioned: {mentioned.join('; ')}
        </p>
      ) : null}

      {/* break-words: a URL is one long unbreakable word, and would otherwise
          scroll a 360px page sideways. */}
      {entry.links.length > 0 ? (
        <ul className="mt-2 space-y-1 break-words text-sm text-ink-soft">
          {/* The same URL can legitimately appear twice on one entry, so the
              index is part of the key: url alone collides and drops a line. */}
          {entry.links.map((link, index) => (
            <li key={`${index}-${link.url}`}>
              {link.label || link.capturedTitle || 'Link'} — {link.url}
            </li>
          ))}
        </ul>
      ) : null}

      {tags.length > 0 ? (
        <p className="mt-2 text-sm text-ink-soft">Tags: {tags.join(', ')}</p>
      ) : null}
    </article>
  );
}

export default function LegacyView() {
  // Without this, a journal that failed to open renders as "nothing to print
  // yet" — telling someone with ten years of writing that they have none.
  const { error: storageError } = useStorage();
  const printer = usePrinter();
  const { data: entries, loading } = useStorageQuery(
    (storage) => storage.listEntriesChronological(),
    [],
    NO_ENTRIES,
  );
  const [order, setOrder] = useState<Order>('date');

  const forDescendants = useMemo(
    () => entries.filter((entry) => entry.forDescendants),
    [entries],
  );
  const sections = useMemo(
    (): Section[] =>
      order === 'book'
        ? byBook(entries)
        : [{ key: 'journal', label: 'The journal', entries }],
    [entries, order],
  );

  const dated = entries.map((entry) => entry.date).filter(Boolean);
  const span =
    dated.length > 0
      ? `${formatShort(dated[0])} to ${formatShort(dated[dated.length - 1])}`
      : null;

  const orderOptions: Array<{ value: Order; label: string }> = [
    { value: 'date', label: 'The day it happened' },
    { value: 'book', label: 'Where it falls in the Bible' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl font-semibold">My Journey With Christ</h1>

      {storageError ? (
        <p
          role="alert"
          className="rounded-control border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100"
        >
          {storageError} Nothing can be gathered or printed until that is fixed — and this page
          being empty does not mean your journal is.
        </p>
      ) : null}

      {/* Only once the journal is actually read: "0 entries" during the load,
          or while storage is broken, is a claim about someone's life's work. */}
      {!loading && !storageError ? (
        <p className="text-sm text-ink-soft">
          {entryWords(entries.length)}
          {span ? `, ${span}` : ''}. Ordered by{' '}
          {order === 'date' ? 'the day each was written' : 'book of the Bible'}.
        </p>
      ) : null}

      {/* The controls are not part of the book. */}
      <div className="print-hidden space-y-4 rounded-card border border-line p-4 print:hidden">
        <fieldset className="border-0 p-0">
          <legend className="text-sm font-medium text-ink-soft">
            Order the journal by
          </legend>
          <div className="mt-1 flex flex-col gap-x-6 sm:flex-row">
            {orderOptions.map((option) => (
              <label
                key={option.value}
                className="flex min-h-11 items-center gap-3 text-sm text-ink-soft"
              >
                <input
                  type="radio"
                  name="legacy-order"
                  value={option.value}
                  checked={order === option.value}
                  onChange={() => setOrder(option.value)}
                  className="h-5 w-5"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        {/*
          Offered only where the platform can actually print. A button that does
          nothing is worse than an absent one: the reader taps it, waits, and
          concludes the app is broken. Where printing is unavailable the book is
          still obtainable — it is inside every archive they export — so the
          alternative is named rather than the capability quietly missing.
        */}
        {printer.canPrint === false ? (
          <p className="text-sm text-ink-soft">
            Printing is not available in the app. The same book is inside every archive you
            export, as a single HTML file you can open and print on a computer —{' '}
            <Link to={{ name: 'data' }} className="underline">
              export your journal
            </Link>
            .
          </p>
        ) : (
          <>
            <Button variant="primary" className="w-full sm:w-auto" onClick={() => printer.print()}>
              Print or save as PDF
            </Button>

            <p className="text-sm text-ink-soft">
              Printing uses the order chosen above. Your device’s print dialog can save this as a
              PDF instead of sending it to a printer. For a copy that needs no app at all,{' '}
              <Link to={{ name: 'data' }} className="underline">
                export your journal
              </Link>
              .
            </p>
          </>
        )}
      </div>

      <LiveRegion
        message={
          loading || storageError
            ? ''
            : `${entryWords(entries.length)}, ordered by ${
                order === 'date' ? 'date' : 'book of the Bible'
              }.`
        }
      />

      {loading ? <Spinner label="Gathering your journal" /> : null}

      {!loading && !storageError && entries.length === 0 ? (
        <EmptyState title="There is nothing to print yet">
          <p>
            Once you have written something, it will gather here as one book you can print or save
            as a PDF.{' '}
            <Link to={{ name: 'newEntry' }} className="underline">
              Write the first entry
            </Link>
            .
          </p>
        </EmptyState>
      ) : null}

      {!loading && forDescendants.length > 0 ? (
        <section aria-labelledby="descendants-heading" className="space-y-6">
          <div>
            <h2
              id="descendants-heading"
              className="break-after-avoid font-serif text-2xl font-semibold"
            >
              For those who come after
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              These entries were marked, as they were written, as meant for whoever came later. They
              appear again below in their place in the journal; they are gathered here first because
              they were not meant to be come upon by accident.
            </p>
          </div>
          {forDescendants.map((entry) => (
            <JournalEntry key={`front-${entry.id}`} entry={entry} />
          ))}
        </section>
      ) : null}

      {!loading &&
        entries.length > 0 &&
        sections.map((section, index) => (
          <section
            key={section.key}
            aria-labelledby={`section-${section.key}`}
            className={
              // Start the body on a fresh sheet when a front section precedes it,
              // so the two are not run together on paper.
              index === 0 && forDescendants.length > 0
                ? 'space-y-6 print:break-before-page'
                : 'space-y-6'
            }
          >
            <h2
              id={`section-${section.key}`}
              className="break-after-avoid font-serif text-2xl font-semibold"
            >
              {section.label}
            </h2>
            {section.entries.map((entry) => (
              <JournalEntry key={entry.id} entry={entry} />
            ))}
          </section>
        ))}
    </div>
  );
}
