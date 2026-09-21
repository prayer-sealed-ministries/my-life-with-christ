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
import { ENTRY_KINDS, ENTRY_KIND_LABELS } from '../lib/entry-kinds';
import {
  FIELD_LABELS,
  hasActiveFilters,
  isOwnVoice,
  searchJournal,
  spellingSuggestions,
  type FieldMatch,
  type SearchFilters,
  type SearchHit,
} from '../lib/journal-search';
import { search } from '../lib/search';
import type { Entry, EntryKind } from '../types';

/** How long to wait after the last keystroke before touching the URL. */
const DEBOUNCE_MS = 200;

/**
 * Outline matches are capped for rendering.
 *
 * A two-letter query matches hundreds of the 1,312 entries. The count is always
 * honest about the total; only the list is trimmed.
 */
const OUTLINE_LIMIT = 50;
/**
 * How many journal results are rendered.
 *
 * The search itself covers the whole journal — this caps what is drawn, not
 * what is looked at. A lifetime of entries must never become a lifetime of
 * cards on one page.
 */
const ENTRY_LIMIT = 50;

/**
 * The default for "no kinds selected".
 *
 * A module constant rather than a `[]` default in the signature: a fresh array
 * every render is a new dependency every render, and the memo below that ranks
 * the whole journal would re-run on each one.
 */
const EMPTY_KINDS: EntryKind[] = [];

/*
 * There is deliberately no list of kinds here.
 *
 * There used to be, and it had drifted: it offered four of the six, called
 * `sermon` "Sermons" where every other surface says "Sermon", and carried an
 * "All" pseudo-kind that is not a kind at all. A reader who had written a
 * Service or a Letter could not narrow to it, and nothing failed — a filter
 * list missing an option looks exactly like a filter list.
 *
 * ENTRY_KINDS and ENTRY_KIND_LABELS in src/lib/entry-kinds.ts are the one
 * definition, shared with the editor, Home and the route parser. Adding a
 * seventh kind is a type error there until it is listed, and it then appears
 * here for free.
 */

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

/**
 * Why this result appeared, in the reader's language.
 *
 * A result list that cannot answer that is a list of guesses. The label names
 * the field, and "Provided notes" is never softened into "Notes" — a church's
 * handout is not the reader's writing, and this is exactly where the two could
 * be confused.
 */
function MatchReason({ match }: { match: FieldMatch }) {
  return (
    <span className="mt-1 block text-sm">
      <span className={isOwnVoice(match.field) ? 'font-medium text-ink-soft' : 'font-medium text-ink-muted'}>
        {FIELD_LABELS[match.field]}
      </span>
      {match.snippet ? (
        <span className={`ml-2 text-ink-soft ${WRAP}`}>{match.snippet}</span>
      ) : null}
    </span>
  );
}

function EntryResult({ hit }: { hit: SearchHit }) {
  const { entry } = hit;
  const providedOnly = hit.providedOnly;
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
        {/* At most two reasons: enough to recognise the entry, not a dump of it. */}
        {hit.matches.slice(0, 2).map((match) => (
          <MatchReason key={`${match.field}-${match.tier}`} match={match} />
        ))}
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
 * How the closed row describes what is narrowing the results.
 *
 * The reader must be able to tell, without opening anything, that they are not
 * looking at everything. A filter that hides results while looking identical to
 * no filter is how someone concludes an entry was lost.
 *
 * Named rather than counted up to three, because "Prayer, Reflection" answers
 * the question and "2 types selected" only tells them to go and look. Past
 * three it becomes a queue of words in a summary line, so it counts instead.
 */
function filterSummary(kinds: EntryKind[], year: string): string {
  const parts: string[] = [];
  if (kinds.length > 0 && kinds.length <= 3) {
    parts.push(kinds.map((kind) => ENTRY_KIND_LABELS[kind]).join(', '));
  } else if (kinds.length > 3) {
    parts.push(`${kinds.length} types`);
  }
  if (year) parts.push(year);
  return parts.join(' · ');
}

/** "Prayer or Reflection" — for a sentence, where a comma list reads wrong. */
function orList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`;
}

/**
 * Advanced search: a power feature, kept subordinate.
 *
 * A real `<details>`, so the expanded state is the browser's and is announced
 * without an `aria-expanded` this code would have to keep honest. Real
 * checkboxes in a real `<fieldset>`, so "selected" is communicated by the
 * control itself rather than by a colour — a toggle chip with `aria-pressed`
 * was what this replaced, and it could express only one kind at a time.
 *
 * No live region on the boxes. The result count already announces politely
 * when the results change, and a second announcement per tick would talk over
 * it.
 */
function AdvancedSearch({
  kinds,
  years,
  year,
  onToggleKind,
  onYear,
  onClear,
}: {
  kinds: EntryKind[];
  years: string[];
  year: string;
  onToggleKind: (kind: EntryKind) => void;
  onYear: (year: string) => void;
  onClear: () => void;
}) {
  const summary = filterSummary(kinds, year);
  // Open on arrival when something is already narrowing — a reader following a
  // filtered link should see why, not a closed row they have to go looking in.
  // Uncontrolled after that: the browser owns the state it is good at.
  const [open, setOpen] = useState(() => summary.length > 0);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mt-3 rounded-card border border-line bg-surface"
    >
      {/* No `flex`: a summary is display:list-item, and overriding that removes
          the browser's own disclosure triangle, leaving a row with no sign it
          opens. py-3 on text-sm already clears the 44px target. */}
      <summary className="min-h-11 cursor-pointer rounded-card px-4 py-3 text-sm font-medium text-ink-soft">
        Advanced search
        {summary ? <span className="font-normal text-ink-muted"> · {summary}</span> : null}
      </summary>

      <div className="space-y-4 border-t border-line p-4">
        <fieldset className="border-0 p-0">
          <legend className="text-sm font-medium text-ink-soft">Entry type</legend>
          <p className="mt-0.5 text-xs text-ink-muted">
            Tick none to search every kind.
          </p>
          <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
            {ENTRY_KINDS.map((kind) => (
              <label
                key={kind}
                className="flex min-h-11 items-center gap-3 text-sm text-ink-soft"
              >
                <input
                  type="checkbox"
                  checked={kinds.includes(kind)}
                  onChange={() => onToggleKind(kind)}
                  className="h-5 w-5 rounded border-line-strong"
                />
                {ENTRY_KIND_LABELS[kind]}
              </label>
            ))}
          </div>
        </fieldset>

        {years.length > 1 ? (
          <label className="flex min-h-11 items-center gap-2 text-sm text-ink-soft">
            Year
            <select
              value={year}
              onChange={(event) => onYear(event.target.value)}
              className="min-h-11 rounded-control border border-line bg-surface px-2 py-1 text-ink focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <option value="">Any</option>
              {years.map((each) => (
                <option key={each} value={each}>{each}</option>
              ))}
            </select>
          </label>
        ) : null}

        {summary ? (
          <ClearFilters onClear={onClear} />
        ) : null}
      </div>
    </details>
  );
}

/**
 * Why this list is empty, when a filter is the reason.
 *
 * Rendered in both empty states, because there are two and the reader can land
 * in either. The whole-page one is the dangerous half: with a filter on and no
 * topic or book matching either, the page said "Nothing matches" and nothing
 * else — a sentence about the journal, when the truth was about the filter.
 */
function FilterNotice({
  kinds,
  year,
  elsewhere,
  onClear,
}: {
  kinds: EntryKind[];
  year: string;
  elsewhere: number;
  onClear: () => void;
}) {
  return (
    <div className="text-left">
      <p>
        {kinds.length > 0
          ? `No matches in ${orList(kinds.map((kind) => ENTRY_KIND_LABELS[kind]))}.`
          : `No matches in ${year}.`}
      </p>
      {/* The honest distinction: the words ARE in the journal, just not in what
          is being shown. Saying only "no matches" is true of the filtered set
          and misleading about the journal. */}
      {elsewhere > 0 ? (
        <p className="mt-1">
          {elsewhere === 1
            ? '1 entry of another kind matches.'
            : `${elsewhere} entries of other kinds match.`}
        </p>
      ) : null}
      <ClearFilters onClear={onClear} className="mt-2" />
    </div>
  );
}

/** One button, one wording, wherever clearing is offered. */
function ClearFilters({ onClear, className = '' }: { onClear: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className={`min-h-11 rounded-control border border-line px-3 py-1 text-sm text-ink-soft hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
    >
      Clear filters
    </button>
  );
}

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

export default function SearchView({
  query,
  kinds = EMPTY_KINDS,
}: {
  query: string;
  kinds?: EntryKind[];
}) {
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
      //
      // `kinds` is carried through rather than dropped. Typing must never
      // clear the filters, and this navigate rewrites the whole route — the
      // one place where forgetting a field silently discards it.
      navigate({ name: 'search', query: value, kinds }, { replace: true });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, kinds, navigate]);

  const needle = query.trim();

  /**
   * Secondary, always. The box has to work on its own; these only narrow what
   * it already found, and the page is usable having never touched them.
   *
   * Kinds live in the route, not in state, so that opening a result and
   * pressing Back returns to the list the reader was actually looking at.
   * The year facet stays local: it is a transient sort-through, not something
   * anyone links to, and widening the route for it was not asked for.
   */
  const [yearFilter, setYearFilter] = useState('');

  /**
   * Write the route from what the reader can see.
   *
   * `value` rather than `query`, because during the debounce the box is ahead
   * of the URL. Ticking a filter mid-word would otherwise rewrite the route
   * with the last committed query and visibly undo the letters just typed.
   *
   * `routed` moves with it so the debounce effect, which re-runs when `kinds`
   * changes, sees no work left to do and does not navigate a second time.
   */
  const commit = (nextValue: string, nextKinds: EntryKind[]) => {
    routed.current = nextValue;
    // replace, not push: ticking three boxes is one decision, not three pages
    // of history to press Back through.
    navigate({ name: 'search', query: nextValue, kinds: nextKinds }, { replace: true });
  };

  const setKinds = (next: EntryKind[]) => commit(value, next);

  const toggleKind = (kind: EntryKind) =>
    setKinds(
      kinds.includes(kind)
        ? kinds.filter((each) => each !== kind)
        : // Canonical order, so the URL for a given selection is always the
          // same string whatever order the boxes were ticked in.
          ENTRY_KINDS.filter((each) => each === kind || kinds.includes(each)),
    );

  const filters: SearchFilters = { kinds, year: yearFilter };
  const filtered = hasActiveFilters(filters);

  const clearFilters = () => {
    // The query is not a filter. Clearing must never empty the box.
    setYearFilter('');
    setKinds([]);
  };

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
  /**
   * The whole journal, read once, then ranked in memory.
   *
   * It used to ask storage for `{ text: needle }`, which is a raw substring
   * match over a blob of every field — so "worry surgery" found nothing unless
   * those two words appeared together in that order, and results came back in
   * date order with no notion of relevance at all.
   *
   * Reading everything and ranking here costs one pass over the journal per
   * query and buys real retrieval. It also means there is no derived index to
   * fall out of step with the entries: nothing to invalidate on edit, delete,
   * import or restore, because the entries ARE the index. Measured at 5,000
   * entries before choosing it.
   *
   * Keyed on `revision` rather than the query, so typing does not re-read
   * storage on every keystroke.
   */
  const { data: all, loading } = useStorageQuery<Entry[]>(
    (storage) => storage.listEntries(),
    [],
    [],
  );

  const ranked = useMemo(
    () => (needle ? searchJournal(needle, all, { kinds, year: yearFilter, limit: ENTRY_LIMIT }) : []),
    [needle, all, kinds, yearFilter],
  );

  /**
   * What the same query finds with nothing narrowing it.
   *
   * Only computed when the filtered set is empty and a filter is on, which is
   * the one moment it matters: "nothing matches" and "nothing of that kind
   * matches, though three other entries do" are different answers, and showing
   * the first when the second is true tells the reader their words are not in
   * the journal when they are.
   */
  const unfilteredCount = useMemo(
    () =>
      needle && filtered && ranked.length === 0
        ? searchJournal(needle, all, { limit: ENTRY_LIMIT }).length
        : 0,
    [needle, all, filtered, ranked.length],
  );

  /** Only computed when nothing was found, so it costs nothing in the normal case. */
  const suggestions = useMemo(
    () => (needle && ranked.length === 0 ? spellingSuggestions(needle, all) : []),
    [needle, ranked.length, all],
  );

  /** Years the journal actually has, so the facet never offers an empty one. */
  const years = useMemo(
    () => [...new Set(all.map((e) => e.date.slice(0, 4)))].sort().reverse(),
    [all],
  );

  const settled = !loading;
  const entries = ranked.map((hit) => hit.entry);

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

      {/* Directly under the box, above everything it narrows — and only once
          there is something to narrow. The hierarchy stays: box, then this,
          then results. */}
      {searching ? (
        <AdvancedSearch
          kinds={kinds}
          years={years}
          year={yearFilter}
          onToggleKind={toggleKind}
          onYear={setYearFilter}
          onClear={clearFilters}
        />
      ) : null}

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
            {/* Said before the list of sources, because it is the likelier
                explanation and the one the reader can undo. Without it the
                page reports that their words are nowhere in the journal while
                a filter is quietly holding the answer back. */}
            {filtered ? (
              <div className="mb-3">
                <FilterNotice
                  kinds={kinds}
                  year={yearFilter}
                  elsewhere={unfilteredCount}
                  onClear={clearFilters}
                />
              </div>
            ) : null}
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
            <div className="mt-3 text-sm text-ink-soft">
              {filtered ? (
                <FilterNotice
                  kinds={kinds}
                  year={yearFilter}
                  elsewhere={unfilteredCount}
                  onClear={clearFilters}
                />
              ) : (
                <p>No entries of your own match this.</p>
              )}
              {/* Help, without blaming them for the spelling. */}
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Try fewer words.</li>
                <li>Check another spelling.</li>
                <li>Search by Scripture, speaker, or series.</li>
              </ul>
              {suggestions.length > 0 ? (
                <p className="mt-2">
                  {/* Offered as a question. "You meant" would be a claim this
                      cannot support. */}
                  Search for{' '}
                  {suggestions.map((word, index) => (
                    <span key={word}>
                      {index > 0 ? ' or ' : ''}
                      <button
                        type="button"
                        className="min-h-11 underline focus-visible:outline-2 focus-visible:outline-offset-2"
                        onClick={() => setValue(word)}
                      >
                        &ldquo;{word}&rdquo;
                      </button>
                    </span>
                  ))}{' '}
                  instead?
                </p>
              ) : null}
            </div>
          ) : (
            <ul className={RESULT_LIST}>
              {ranked.map((hit) => (
                <EntryResult key={hit.entry.id} hit={hit} />
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
