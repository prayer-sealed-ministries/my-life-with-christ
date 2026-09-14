/**
 * The journal, oldest to newest.
 *
 * This is the view the whole product points at: a life of entries read in the
 * order it was lived. Two things live here and nowhere else.
 *
 * First, the export reminder. Browser storage is not a backup, and the app has
 * to say so — but never while someone is writing. The timeline is the moment a
 * person is looking back rather than composing, so the banner surfaces here.
 *
 * Second, fast capture. Most sermon notes are typed on a phone, in a pew, in the
 * first thirty seconds of a sermon. "New sermon note" is a full-width target at
 * the top of the page for exactly that reason.
 */

import { useMemo, useState } from 'react';

import { Link } from '../app/router';
import { useStorage, useStorageQuery } from '../app/storage';
import { Button, EmptyState, LiveRegion, Spinner, Tag } from '../components/ui';
import { KIND_LABELS } from '../export/context';
import { exportReminder } from '../export/reminder';
import { formatDay, formatMonth, localDate } from '../lib/dates';
import type { Entry } from '../types';

/**
 * A focus ring named against the page, not against the control.
 *
 * The global rule in index.css draws focus in currentColor, which is right for
 * ordinary text but wrong for a filled control: white-on-slate-900 puts a white
 * ring on the near-white page, and slate-900 text on a light chip puts a dark
 * ring on the dark page. Either way there is no visible focus (2.4.7), so the
 * controls here name a ring that contrasts with what sits behind them.
 */
const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:focus-visible:outline-slate-100';

/** Long unbroken text — a pasted URL in a title or a note — must wrap, not scroll the page. */
const WRAP = 'break-words';

/** First line or so of the notes, flattened for a one-glance preview. */
function excerpt(text: string, limit = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  return `${flat.slice(0, limit).trimEnd()}…`;
}

interface MonthGroup {
  /** Unique across the whole list. See the note in groupByMonth. */
  key: string;
  /** What decides whether the next entry joins this group. */
  bucket: string;
  label: string;
  entries: Entry[];
}

interface YearGroup {
  key: string;
  bucket: string;
  label: string;
  months: MonthGroup[];
}

/**
 * Group chronological entries into years and months.
 *
 * An entry whose date is missing or is not a calendar day — which an import from
 * another version could produce — is not dropped; it collects under "Undated" so
 * nothing written can silently vanish. Its own stored date still shows verbatim
 * on the row, so the record is visible even when it cannot be grouped.
 *
 * The React key is the group's position as well as its bucket, because an
 * undated run is not necessarily contiguous: a stored date of "" sorts before
 * every real date and one of "unknown" sorts after, so "Undated" can legitimately
 * open twice in one list. Keying on the bucket alone collides, and React's answer
 * to a collision is to duplicate or omit a child — which would lose an entry.
 */
function groupByMonth(entries: Entry[]): YearGroup[] {
  const years: YearGroup[] = [];

  for (const entry of entries) {
    const dated = localDate(entry.date) !== null;
    const yearBucket = dated ? entry.date.slice(0, 4) : 'undated';
    const monthBucket = dated ? entry.date.slice(0, 7) : 'undated';

    let year = years.at(-1);
    if (!year || year.bucket !== yearBucket) {
      year = {
        key: `${yearBucket}#${years.length}`,
        bucket: yearBucket,
        label: dated ? yearBucket : 'Undated',
        months: [],
      };
      years.push(year);
    }

    let month = year.months.at(-1);
    if (!month || month.bucket !== monthBucket) {
      month = {
        key: `${monthBucket}#${year.key}#${year.months.length}`,
        bucket: monthBucket,
        // An undated group can hold several different unreadable dates, so it
        // takes fixed wording rather than the first entry's raw string.
        label: dated ? formatMonth(entry.date) : 'No date recorded',
        entries: [],
      };
      year.months.push(month);
    }

    month.entries.push(entry);
  }

  return years;
}

const LINK_BUTTON = `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${FOCUS}`;

function EntryRow({ entry }: { entry: Entry }) {
  // An unknown kind falls back to the raw value: an entry written by a newer
  // version should still say what it is rather than losing the field.
  const meta = [
    KIND_LABELS[entry.kind] ?? entry.kind,
    formatDay(entry.date),
    entry.speaker,
    entry.place,
  ].filter((part): part is string => Boolean(part));
  const preview = excerpt(entry.notes);

  return (
    <li>
      <Link
        to={{ name: 'entry', id: entry.id }}
        className={`block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800 ${FOCUS}`}
      >
        <span className={`block font-medium text-slate-900 dark:text-slate-100 ${WRAP}`}>
          {entry.title || 'Untitled entry'}
        </span>
        <span className={`mt-1 block text-sm text-slate-600 dark:text-slate-300 ${WRAP}`}>
          {meta.join(' · ')}
        </span>
        {preview ? (
          <span className={`mt-2 block text-sm text-slate-500 dark:text-slate-400 ${WRAP}`}>
            {preview}
          </span>
        ) : null}
        {entry.forDescendants ? (
          <span className="mt-2 block">
            {/* Text, not a colour swatch: the flag has to survive a greyscale
                print and a screen reader alike. */}
            <Tag>For my family</Tag>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function ExportReminderBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-6 rounded-xl border border-amber-400 bg-amber-50 p-4 dark:border-amber-600/70 dark:bg-amber-950/40">
      <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
        Back up your journal
      </p>
      <p className="mt-1 text-sm text-amber-900 dark:text-amber-100">{message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          to={{ name: 'data' }}
          className={`${LINK_BUTTON} bg-amber-900 text-white hover:bg-amber-800 dark:bg-amber-100 dark:text-amber-950 dark:hover:bg-white`}
        >
          Export my journal
        </Link>
        <Button onClick={onDismiss}>Dismiss</Button>
      </div>
    </div>
  );
}

export default function TimelineView() {
  const { settings, updateSettings } = useStorage();
  const { data: entries, loading } = useStorageQuery<Entry[]>(
    (storage) => storage.listEntriesChronological(),
    [],
    [],
  );
  const [dismissed, setDismissed] = useState(false);

  const years = useMemo(() => groupByMonth(entries), [entries]);
  const reminder = exportReminder(settings, entries.length);
  const showReminder = !loading && reminder.show && !dismissed;

  const dismiss = () => {
    // Hide it immediately; the write is what makes it stay hidden. If the write
    // fails the banner simply returns next visit, which is the safe direction.
    setDismissed(true);
    void updateSettings({ reminderDismissedAt: new Date().toISOString() }).catch(() => {});
  };

  return (
    <div>
      <h1 className="font-serif text-2xl font-semibold sm:text-3xl">My journey</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-300">
        Your journal, oldest first — the way it was lived.
      </p>

      <div className="mt-4">
        <Link
          to={{ name: 'newEntry' }}
          className={`${LINK_BUTTON} w-full bg-slate-900 text-white hover:bg-slate-700 sm:w-auto dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white`}
        >
          New sermon note
        </Link>
      </div>

      <div className="mt-6">
        {/* Both regions are rendered unconditionally: a live region inserted at
            the same moment its text arrives is not reliably announced. It has to
            be there first, empty, and then change. The reminder gets its own
            rather than being folded into the count, so dismissing it does not
            re-announce the count as a side effect. */}
        <LiveRegion message={showReminder ? `Back up your journal. ${reminder.message}` : ''} />

        {showReminder ? (
          <ExportReminderBanner message={reminder.message} onDismiss={dismiss} />
        ) : null}

        {loading ? <Spinner label="Loading your journal" /> : null}

        <LiveRegion
          message={
            loading
              ? ''
              : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} in your journal.`
          }
        />

        {!loading && entries.length === 0 ? (
          <EmptyState title="Nothing written yet">
            <p>
              Your first note can be three words typed during a sermon. Start with{' '}
              <Link
                to={{ name: 'newEntry' }}
                className="underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                a new sermon note
              </Link>
              , or write against a passage from{' '}
              <Link
                to={{ name: 'browse' }}
                className="underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                the Bible
              </Link>
              .
            </p>
          </EmptyState>
        ) : null}

        {years.map((year) => (
          <section key={year.key} className="mt-8 first:mt-0">
            <h2 className="border-b border-slate-200 pb-1 font-serif text-xl font-semibold dark:border-slate-700">
              {year.label}
            </h2>
            {year.months.map((month) => (
              <section key={month.key} className="mt-5">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {month.label}
                </h3>
                <ul className="mt-2 space-y-3">
                  {month.entries.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              </section>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
