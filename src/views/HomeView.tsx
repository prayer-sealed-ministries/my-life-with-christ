/**
 * The front door.
 *
 * Someone arriving here is usually in one of two moods: they want to read
 * something, or a sermon just started and they need a box to type in. Four large
 * targets cover both, and the page says plainly what the app is and where the
 * writing lives — on this device, not on someone's server. That is a promise the
 * product makes, so it is stated at the entrance rather than buried in settings.
 */

import { Link, type Route } from '../app/router';
import { useStorageQuery } from '../app/storage';
import { Spinner } from '../components/ui';
import type { Entry, EntryKind } from '../types';

/** How many recent entries the front page shows. A glance, not a list. */
const RECENT_COUNT = 3;

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
      <h1 className="font-serif text-3xl font-semibold sm:text-4xl">Journey</h1>
      <p className="mt-3 text-lg leading-relaxed text-slate-700 dark:text-slate-200">
        A place to read the Bible and keep what you hear — sermons, readings, prayers, and what they
        meant to you at the time.
      </p>
      <p className="mt-2 text-slate-600 dark:text-slate-300">
        Everything you write stays on this device. There is no account and nothing is uploaded.
        Because of that, the{' '}
        <Link
          to={{ name: 'data' }}
          className="underline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          export
        </Link>{' '}
        is what you actually own — a folder of plain files a grandchild could read without this app.
      </p>

      <h2 className="mt-8 font-serif text-xl font-semibold">Where to begin</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {DESTINATIONS.map((destination) => (
          <li key={destination.label}>
            <Link
              to={destination.route}
              className={`flex min-h-11 flex-col justify-center rounded-xl border p-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
                destination.primary
                  ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-700 dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white'
                  : 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span className="text-base font-semibold">{destination.label}</span>
              <span
                className={`mt-1 text-sm ${
                  destination.primary
                    ? 'text-slate-200 dark:text-slate-700'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                {destination.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {loading ? <Spinner label="Loading your journal" /> : null}

      {!loading && recent.length > 0 ? (
        <section className="mt-8">
          <h2 className="font-serif text-xl font-semibold">Recently written</h2>
          <ul className="mt-3 space-y-3">
            {recent.map((entry) => (
              <li key={entry.id}>
                <Link
                  to={{ name: 'entry', id: entry.id }}
                  className="block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                >
                  <span className="block font-medium text-slate-900 dark:text-slate-100">
                    {entry.title || 'Untitled entry'}
                  </span>
                  <span className="mt-1 block text-sm text-slate-600 dark:text-slate-300">
                    {[KIND_LABELS[entry.kind], formatDay(entry.date), entry.speaker]
                      .filter((part): part is string => Boolean(part))
                      .join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            <Link
              to={{ name: 'timeline' }}
              className="underline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              See the whole journey
            </Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
