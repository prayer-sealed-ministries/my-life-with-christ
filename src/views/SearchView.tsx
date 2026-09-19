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

import { hasOutlineTitles, outlineBooks, segmentContaining, segmentsForBook } from '../app/data';
import { Link, useRouter, type Route } from '../app/router';
import { useStorageQuery } from '../app/storage';
import { EmptyState, Field, LiveRegion, Spinner } from '../components/ui';
import { KIND_LABELS } from '../export/context';
import { formatDay } from '../lib/dates';
import { matchedOnlyInProvided } from '../lib/provided-notes';
import { search } from '../lib/search';
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
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

/** Long unbroken text — a pasted URL in a title, a pasted paragraph in the box — must wrap. */
const WRAP = 'break-words';

/**
 * A result row, not a result card.
 *
 * Every hit here is two lines — a title and a line of metadata. A border and a
 * radius around each one put four boxes on the page to carry eight lines of
 * text, and the borders read louder than the results did. The list rule below
 * separates them for a fraction of the ink.
 */
const RESULT_ROW = `block px-1 py-3.5 transition-colors hover:bg-raised ${FOCUS}`;

/** The list those rows sit in: hairlines between, and one at each end. */
const RESULT_LIST = 'mt-2 divide-y divide-line border-y border-line';

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

function EntryResult({ entry, providedOnly }: { entry: Entry; providedOnly: boolean }) {
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
      <Link to={{ name: 'entry', id: entry.id }} className={RESULT_ROW}>
        <span className={`block font-medium text-ink ${WRAP}`}>
          {entry.title || 'Untitled entry'}
        </span>
        <span className={`mt-1 block text-sm text-ink-soft ${WRAP}`}>
          {meta.join(' · ')}
        </span>
        {/* Said in words, not in a colour. This entry came back because a
            church's handout matched, not because the reader wrote it — and a
            result list is exactly where those two could be confused. */}
        {providedOnly ? (
          <span className="mt-1 block text-sm text-ink-muted">
            Matched in provided notes, not in your own writing.
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function OutlineResult({ match }: { match: OutlineMatch }) {
  return (
    <li>
      <Link to={match.to} className={RESULT_ROW}>
        <span className={`block font-medium text-ink ${WRAP}`}>
          {match.title}
        </span>
        <span className={`mt-1 block text-sm text-ink-soft ${WRAP}`}>
          {match.ref}
        </span>
        {/* Said in words, not signalled by styling: this result goes somewhere
            other than where the rest of them go. */}
        {match.unplaced ? (
          <span className={`mt-1 block text-sm text-ink-muted ${WRAP}`}>
            This reference has not been resolved — opens all of {match.bookName}.
          </span>
        ) : null}
      </Link>
    </li>
  );
}

const SECTION_HEADING =
  'border-b border-line pb-1 font-serif text-xl font-semibold';

/**
 * Where a typed reference should land.
 *
 * The segment holding it, when one exists — under `refs-only` that is the whole
 * chapter, under `full` it is whichever outline entry covers the verse.
 */
function passageRouteFor(ref: { book: string; chapterStart: number; verseStart: number }) {
  const segment = segmentContaining(ref.book, ref.chapterStart, ref.verseStart);
  return segment
    ? ({ name: 'passage', bookId: ref.book, segmentId: segment.id } as const)
    : ({ name: 'book', bookId: ref.book } as const);
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

  /**
   * Everything that is not the journal: a typed reference, topics, books.
   *
   * Entries come from storage, which has them indexed; the rest is static data
   * already in memory, so it is matched here rather than round-tripping.
   *
   * This is what makes search work on a first visit. Before it, search covered
   * the journal and the outline titles — and on the public build the outline
   * titles do not exist and the journal is empty, so a stranger's first search
   * returned nothing at all.
   */
  const catalogue = useMemo(
    () => search(needle, { entries: [], outlineBooks: [], hasOutlines: hasOutlineTitles }),
    [needle],
  );

  const searching = needle.length > 0;
  const resultCount =
    entries.length +
    outlineMatches.length +
    catalogue.references.length +
    catalogue.topics.length +
    catalogue.books.length;
  const nothingFound = searching && settled && resultCount === 0;
  const showResults = searching && settled && !nothingFound;

  const announcement =
    searching && settled
      ? `${resultCount} ${resultCount === 1 ? 'result' : 'results'}: ` +
        `${entries.length} in your journal, ${catalogue.topics.length} ${catalogue.topics.length === 1 ? 'topic' : 'topics'}` +
        (hasOutlineTitles
          ? `, ${outlineMatches.length} outline ${outlineMatches.length === 1 ? 'passage' : 'passages'}`
          : '') +
        '.'
      : '';

  // The label must not offer what this build cannot do. Under `refs-only` there
  // are no outline titles to search, so it does not claim otherwise.
  // One label for every profile. What differs between builds is which sources
  // exist, and the empty state names any that are absent — the field label is
  // the wrong place to carry that, and two identical ternary branches were
  // only pretending it did.
  const label = 'Search your journal, topics and the Bible';
  const hint = 'A topic, a book, a passage like “Matt 6:25”, or anything in your own notes.';

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
            <p>
              A topic like <em>grief</em> or <em>money</em>. A book like <em>1 Cor</em>. A passage
              like <em>Matt 6:25</em>. Or anything from your own notes — a speaker, a place, a
              phrase you remember.
            </p>
          </EmptyState>
        </div>
      ) : null}

      {searching && !settled ? <Spinner label="Searching" /> : null}

      {/* An empty state that only says "no results" leaves the reader guessing
          whether the thing they want is missing or was never looked for. This
          lists what was searched, and names anything this build cannot search
          rather than silently omitting it. */}
      {nothingFound ? (
        <div className="mt-6">
          <EmptyState title={`Nothing matches “${echo}”`}>
            <p className="text-left">Searched:</p>
            <ul className="mt-2 space-y-1 text-left">
              {catalogue.searched.map((source) => (
                <li key={source.label}>
                  {source.available ? (
                    <span>{source.label}</span>
                  ) : (
                    <span className="text-ink-muted">
                      {source.label} — {source.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-left">
              Try a shorter word, a different spelling, or a passage like “Matt 6:25”.
            </p>
          </EmptyState>
        </div>
      ) : null}

      {showResults && catalogue.references.length > 0 ? (
        <section className="mt-8">
          <h2 className={SECTION_HEADING}>Go to a passage</h2>
          <ul className={RESULT_LIST}>
            {catalogue.references.map((hit) => (
              <li key={hit.label}>
                <Link
                  to={passageRouteFor(hit.ref)}
                  className="block rounded-control border border-line p-3 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span className="font-serif text-lg font-semibold">{hit.label}</span>
                  <span className="mt-0.5 block text-sm text-ink-soft">
                    Read it in the King James Version
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showResults && catalogue.topics.length > 0 ? (
        <section className="mt-8">
          <h2 className={SECTION_HEADING}>Topics ({catalogue.topics.length})</h2>
          <ul className={RESULT_LIST}>
            {catalogue.topics.map(({ topic, matchedAlias }) => (
              <li key={topic.id}>
                <Link
                  to={{ name: 'topic', topicId: topic.id }}
                  className="block rounded-control border border-line p-3 hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span className="font-medium">{topic.name}</span>
                  {matchedAlias ? (
                    <span className="ml-2 text-sm text-ink-muted">
                      matched “{matchedAlias}”
                    </span>
                  ) : null}
                  <span className="mt-0.5 block text-sm text-ink-soft">
                    {topic.description}
                  </span>
                  <span className="mt-1 block text-xs text-ink-muted">
                    {topic.refs.length} passages
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showResults && catalogue.books.length > 0 ? (
        <section className="mt-8">
          <h2 className={SECTION_HEADING}>Books of the Bible ({catalogue.books.length})</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {catalogue.books.map((book) => (
              <li key={book.id}>
                <Link
                  to={{ name: 'book', bookId: book.id }}
                  className="inline-flex min-h-11 items-center rounded-pill border border-line-strong bg-surface px-4 py-1 text-sm text-ink-soft hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {book.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showResults ? (
        <section className="mt-8">
          <h2 className={SECTION_HEADING}>
            Your journal ({entries.length})
          </h2>
          {entries.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              No entries of your own match this.
            </p>
          ) : (
            <ul className={RESULT_LIST}>
              {entries.map((entry) => (
                <EntryResult
                  key={entry.id}
                  entry={entry}
                  providedOnly={matchedOnlyInProvided(entry, needle.toLowerCase())}
                />
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
          <h2 className="border-b border-line pb-1 font-serif text-xl font-semibold">
            Bible outline ({outlineMatches.length})
          </h2>
          {outlineMatches.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              No outline passages match this.
            </p>
          ) : (
            <>
              <ul className={RESULT_LIST}>
                {outlineMatches.slice(0, OUTLINE_LIMIT).map((match) => (
                  <OutlineResult key={match.id} match={match} />
                ))}
              </ul>
              {outlineMatches.length > OUTLINE_LIMIT ? (
                <p className="mt-3 text-sm text-ink-soft">
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
