/**
 * Search across the two things a reader might be hunting for.
 *
 * "Where is that note about forgiveness?" and "where is the outline on the
 * prodigal son?" are the same question to the person asking and two completely
 * different lookups underneath. They are answered together, in clearly separated
 * sections, so nobody has to know which half of the app holds their answer.
 *
 * The outline half disappears entirely under the `refs-only` data profile: the
 * titles are not in the build, so there is nothing to search and a section
 * promising results — or a label offering to search them — would be a lie.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { hasOutlineTitles, outlineBooks, segmentsForBook } from '../app/data';
import { Link, useRouter, type Route } from '../app/router';
import { useStorageQuery } from '../app/storage';
import { EmptyState, Field, LiveRegion, Spinner } from '../components/ui';
import { KIND_LABELS } from '../export/context';
import { formatDay } from '../lib/dates';
import type { Entry } from '../types';

/** How long to wait after the last keystroke before touching the URL. */
const DEBOUNCE_MS = 200;

/**
 * Outline matches are capped for rendering.
 *
 * A two-letter query matches hundreds of the 1,312 entries. The count is always
 * honest about the total; only the list is trimmed.
 */
const OUTLINE_LIMIT = 50;

/** How much of the query to echo back in the empty state. */
const ECHO_LIMIT = 60;

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 dark:focus-visible:outline-slate-100';

/** Long unbroken text — a pasted URL in a title, a pasted paragraph in the box — must wrap. */
const WRAP = 'break-words';

const RESULT_CARD = `block rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800 ${FOCUS}`;

interface OutlineMatch {
  id: string;
  title: string;
  ref: string;
  bookName: string;
  to: Route;
  /** True when the entry's printed reference resolves to no passage to open. */
  unplaced: boolean;
}

/**
 * Which segment ids a book actually browses to, remembered per book.
 *
 * An outline entry whose printed reference is impossible — "Matthew 9:18-6",
 * still awaiting adjudication — claims no verses, so buildSegments gives it no
 * segment and `#/passage/matthew/matthew-9-18-6` is a page that does not exist.
 * The entry is still findable by title, so the result links to the book instead
 * of to a dead end, and says why.
 *
 * Built once per book and cached, never once per result: segmentsForBook is
 * itself cached, but scanning its output for every match would turn one lookup
 * into hundreds.
 */
const segmentIdsByBook = new Map<string, Set<string>>();

function browsableSegmentIds(bookId: string): Set<string> {
  let ids = segmentIdsByBook.get(bookId);
  if (!ids) {
    ids = new Set(segmentsForBook(bookId).map((segment) => segment.id));
    segmentIdsByBook.set(bookId, ids);
  }
  return ids;
}

/**
 * Outline entries whose title mentions the query.
 *
 * Both `title` (verbatim from the source) and `displayTitle` (the readable
 * wording) are searched, because a reader may remember either spelling, but only
 * the display wording is shown.
 */
function searchOutlines(needle: string): OutlineMatch[] {
  if (!needle || !hasOutlineTitles) return [];

  const matches: OutlineMatch[] = [];
  for (const book of outlineBooks) {
    let ids: Set<string> | null = null;

    for (const entry of book.entries) {
      const haystack = `${entry.title} ${entry.displayTitle}`.toLowerCase();
      if (!haystack.includes(needle)) continue;

      // Resolved lazily, so a book with no match never pays for its segments.
      if (ids === null) ids = browsableSegmentIds(book.id);
      const placed = ids.has(entry.id);

      matches.push({
        id: entry.id,
        title: entry.displayTitle || entry.title || entry.ref,
        ref: entry.ref,
        bookName: book.name,
        to: placed
          ? { name: 'passage', bookId: book.id, segmentId: entry.id }
          : { name: 'book', bookId: book.id },
        unplaced: !placed,
      });
    }
  }
  return matches;
}

function EntryResult({ entry }: { entry: Entry }) {
  // An unknown kind falls back to the raw value rather than vanishing from the
  // line, the same way the timeline treats it.
  const meta = [
    KIND_LABELS[entry.kind] ?? entry.kind,
    formatDay(entry.date),
    entry.speaker,
    entry.place,
  ].filter((part): part is string => Boolean(part));

  return (
    <li>
      <Link to={{ name: 'entry', id: entry.id }} className={RESULT_CARD}>
        <span className={`block font-medium text-slate-900 dark:text-slate-100 ${WRAP}`}>
          {entry.title || 'Untitled entry'}
        </span>
        <span className={`mt-1 block text-sm text-slate-600 dark:text-slate-300 ${WRAP}`}>
          {meta.join(' · ')}
        </span>
      </Link>
    </li>
  );
}

function OutlineResult({ match }: { match: OutlineMatch }) {
  return (
    <li>
      <Link to={match.to} className={RESULT_CARD}>
        <span className={`block font-medium text-slate-900 dark:text-slate-100 ${WRAP}`}>
          {match.title}
        </span>
        <span className={`mt-1 block text-sm text-slate-600 dark:text-slate-300 ${WRAP}`}>
          {match.ref}
        </span>
        {/* Said in words, not signalled by styling: this result goes somewhere
            other than where the rest of them go. */}
        {match.unplaced ? (
          <span className={`mt-1 block text-sm text-slate-500 dark:text-slate-400 ${WRAP}`}>
            This reference has not been resolved — opens all of {match.bookName}.
          </span>
        ) : null}
      </Link>
    </li>
  );
}

export default function SearchView({ query }: { query: string }) {
  const { navigate } = useRouter();
  const [value, setValue] = useState(query);

  // What the URL currently holds, as far as this view knows. It is the seam
  // between two directions of change — typing pushes the route forward, and the
  // back button pushes it back — and without it the two overwrite each other.
  const routed = useRef(query);

  useEffect(() => {
    if (query === routed.current) return;
    routed.current = query;
    setValue(query);
  }, [query]);

  useEffect(() => {
    if (value === routed.current) return;
    const timer = setTimeout(() => {
      routed.current = value;
      // replace, not push: a search box that pushes per keystroke buries the
      // page the user came from under forty history entries.
      navigate({ name: 'search', query: value }, { replace: true });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, navigate]);

  const needle = query.trim();

  /**
   * Results carry the needle they were read for.
   *
   * The query can change a full render before the read for it is even
   * scheduled, so `loading` is still false while the *previous* query's entries
   * are in hand. Without the tag, that render shows the old results and
   * announces the old count under the new search term.
   *
   * The tag is also why the read swallows its own failure. A rejected read
   * leaves the previous value in place, which would leave the tag behind the
   * query for good and spin the "Searching" state forever. Storage trouble is
   * already reported where it happens, at open time.
   */
  const { data: found, loading } = useStorageQuery<{ needle: string; entries: Entry[] }>(
    async (storage) => {
      if (!needle) return { needle, entries: [] };
      try {
        return { needle, entries: await storage.listEntries({ text: needle }) };
      } catch {
        return { needle, entries: [] };
      }
    },
    [needle],
    { needle: '', entries: [] },
  );

  const settled = !loading && found.needle === needle;
  const entries = settled ? found.entries : [];

  const outlineMatches = useMemo(() => searchOutlines(needle.toLowerCase()), [needle]);

  const searching = needle.length > 0;
  const nothingFound =
    searching && settled && entries.length === 0 && outlineMatches.length === 0;
  const showResults = searching && settled && !nothingFound;

  const announcement =
    searching && settled
      ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}` +
        (hasOutlineTitles
          ? `, ${outlineMatches.length} outline ${outlineMatches.length === 1 ? 'passage' : 'passages'}`
          : '') +
        '.'
      : '';

  // The label must not offer what this build cannot do. Under `refs-only` there
  // are no outline titles to search, so it does not claim otherwise.
  const label = hasOutlineTitles
    ? 'Search your journal and the Bible outline'
    : 'Search your journal';
  const hint = hasOutlineTitles
    ? 'Titles, notes, reflections, speakers, places and tags, plus outline passage titles.'
    : 'Titles, notes, reflections, speakers, places and tags.';

  // A pasted paragraph is still a query; echoing all of it would not be.
  const echo = needle.length > ECHO_LIMIT ? `${needle.slice(0, ECHO_LIMIT).trimEnd()}…` : needle;

  return (
    <div>
      <h1 className="font-serif text-2xl font-semibold sm:text-3xl">Search</h1>

      <Field
        className="mt-4"
        label={label}
        hint={hint}
        type="search"
        value={value}
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
      />

      <LiveRegion message={announcement} />

      {!searching ? (
        <div className="mt-6">
          <EmptyState title="What are you looking for?">
            <p>Type a word above — a speaker, a phrase you remember, a tag, a place.</p>
          </EmptyState>
        </div>
      ) : null}

      {searching && !settled ? <Spinner label="Searching" /> : null}

      {nothingFound ? (
        <div className="mt-6">
          <EmptyState title={`Nothing matches “${echo}”`}>
            <p>Try a shorter word, or a different spelling.</p>
          </EmptyState>
        </div>
      ) : null}

      {showResults ? (
        <section className="mt-8">
          <h2 className="border-b border-slate-200 pb-1 font-serif text-xl font-semibold dark:border-slate-700">
            Your journal ({entries.length})
          </h2>
          {entries.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              No entries of your own match this.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {entries.map((entry) => (
                <EntryResult key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* No outline titles in this build means no outline section at all — an
          empty "0 results" heading would imply the search failed rather than
          that the data was never shipped. */}
      {showResults && hasOutlineTitles ? (
        <section className="mt-8">
          <h2 className="border-b border-slate-200 pb-1 font-serif text-xl font-semibold dark:border-slate-700">
            Bible outline ({outlineMatches.length})
          </h2>
          {outlineMatches.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
              No outline passages match this.
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-3">
                {outlineMatches.slice(0, OUTLINE_LIMIT).map((match) => (
                  <OutlineResult key={match.id} match={match} />
                ))}
              </ul>
              {outlineMatches.length > OUTLINE_LIMIT ? (
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                  Showing the first {OUTLINE_LIMIT} of {outlineMatches.length}. Narrow the search to
                  see fewer.
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
