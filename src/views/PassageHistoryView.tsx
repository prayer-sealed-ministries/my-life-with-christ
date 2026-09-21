/**
 * My history with a passage.
 *
 * Not commentary, not study notes, not search results — the reader's own saved
 * moments connected to one place in Scripture, in the order they happened.
 * Oldest first, because this is a story across a life rather than a lookup.
 *
 * Everything here is derived from the entries at read time. There is no stored
 * passage index, so nothing can go stale when an entry is written, edited,
 * deleted, imported or restored: the anchors already carry the relationship and
 * this view reads them.
 */

import { useEffect, useMemo } from 'react';

import { Link, useRouter } from '../app/router';
import { useStorageQuery } from '../app/storage';
import { EmptyState, Spinner } from '../components/ui';
import { KIND_LABELS } from '../export/context';
import { formatDay } from '../lib/dates';
import {
  excerptFor,
  matchingAnchors,
  passageHistory,
  type HistoryYear,
} from '../lib/passage-history';
import { parseReferenceQuery, refLabel } from '../lib/search';
import { segmentContaining } from '../app/data';
import type { Entry, ScriptureRef } from '../types';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * Where "read the passage itself" should land, under either data profile.
 *
 * Under `public` that is the outline span holding the first verse; under
 * `refs-only` it is the whole chapter. Resolved rather than constructed, for
 * the same reason the search view resolves it.
 */
function passageRouteFor(ref: ScriptureRef) {
  const segment = segmentContaining(ref.book, ref.chapterStart, ref.verseStart);
  return segment
    ? ({ name: 'passage', bookId: ref.book, segmentId: segment.id } as const)
    : ({ name: 'book', bookId: ref.book } as const);
}

/**
 * The value `#/entry/new?anchor=` actually understands.
 *
 * It is a SEGMENT id, not a reference label — `anchorFromParam` resolves
 * `john-15-1-17`, `topic:…` and `book:…`, and nothing else. Passing "John 15"
 * would resolve to null and quietly open an unanchored entry, so the empty
 * state would invite someone to write about this passage and then not attach
 * it. Same convention as the passage view's own "Add entry".
 */
function newEntryAnchor(ref: ScriptureRef): string | undefined {
  return segmentContaining(ref.book, ref.chapterStart, ref.verseStart)?.id;
}

/** The whole chapter a verse or part-chapter reference sits in, if that is wider. */
function chapterOf(ref: ScriptureRef): string | null {
  if (ref.chapterStart !== ref.chapterEnd) return null;
  const whole = parseReferenceQuery(`${ref.book} ${ref.chapterStart}`);
  if (!whole) return null;
  const label = refLabel(whole);
  return label === refLabel(ref) ? null : label;
}

/**
 * One saved moment.
 *
 * `passage`, never `ref`: React reserves that prop name.
 *
 * The heading level follows the page rather than being fixed. With several
 * years the cards sit inside year sections and are h3; with one year there are
 * no year headings at all and a fixed h3 would jump straight from the h1 —
 * which the heading-order sweep caught, and which a screen-reader user
 * navigating by heading would hear as a missing level.
 */
function MomentCard({
  entry,
  passage,
  level,
}: {
  entry: Entry;
  passage: ScriptureRef;
  level: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  const excerpt = excerptFor(entry);
  const anchors = matchingAnchors(entry, passage);
  // Facts about the moment, each labelled for assistive tech; visually the
  // order and the gaps do the work, so nothing depends on position alone.
  const facts = [entry.speaker, entry.place, entry.sermonSeries].filter(Boolean) as string[];

  return (
    <article className="rounded-card border border-line bg-surface p-4">
      <Heading className="font-serif text-lg font-semibold">
        <Link
          to={{ name: 'entry', id: entry.id }}
          className={`inline-flex min-h-11 items-center underline decoration-line-strong underline-offset-4 hover:decoration-current ${FOCUS}`}
        >
          {entry.title.trim() || 'Untitled entry'}
        </Link>
      </Heading>

      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-ink-soft">
        <time dateTime={entry.date}>{formatDay(entry.date)}</time>
        <span>{KIND_LABELS[entry.kind] ?? entry.kind}</span>
        {anchors.map((anchor) => (
          <span key={`${anchor.chapterStart}:${anchor.verseStart}-${anchor.chapterEnd}:${anchor.verseEnd}`}>
            <span className="sr-only">Attached to: </span>
            {refLabel(anchor)}
          </span>
        ))}
        {facts.map((fact) => (
          <span key={fact}>{fact}</span>
        ))}
      </p>

      {excerpt ? (
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          {/* Said in words, not in a colour: these are not the reader's words,
              and a page about their own history is exactly where that could be
              mistaken. */}
          {excerpt.label ? (
            <span className="font-medium text-ink-muted">{excerpt.label} </span>
          ) : null}
          {excerpt.text}
        </p>
      ) : null}
    </article>
  );
}

function Year({ year, entries, passage }: HistoryYear & { passage: ScriptureRef }) {
  return (
    <section aria-labelledby={`year-${year}`}>
      <h2
        id={`year-${year}`}
        className="border-b border-line pb-1 font-serif text-xl font-semibold"
      >
        {year}
      </h2>
      <ul className="mt-3 space-y-3">
        {entries.map((entry) => (
          <li key={entry.id}>
            <MomentCard entry={entry} passage={passage} level={3} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function PassageHistoryView({ reference }: { reference: string }) {
  const { navigate } = useRouter();

  // One parser, the one the rest of the app uses. A reference that does not
  // resolve never reaches retrieval.
  const ref = useMemo(() => parseReferenceQuery(reference.trim()), [reference]);
  const label = ref ? refLabel(ref) : null;

  /*
   * Settle the URL on the canonical spelling.
   *
   * "Jn 15" and "John 15" name one passage and should be one address, so a
   * link someone keeps says what it means. `replace`, not push, so this never
   * costs a Back press — pressing Back from here must reach wherever the
   * reader came from, not the same page under its other name.
   *
   * It cannot loop: the canonical label parses to itself, so the second pass
   * finds nothing to change.
   */
  useEffect(() => {
    if (label && label !== reference) {
      navigate({ name: 'passageHistory', reference: label }, { replace: true });
    }
  }, [label, reference, navigate]);

  const { data: all, loading } = useStorageQuery<Entry[]>((storage) => storage.listEntries(), [], []);

  const history = useMemo(() => (ref ? passageHistory(all, ref) : null), [all, ref]);
  const chapter = ref ? chapterOf(ref) : null;

  if (!ref || !label) {
    return (
      <div>
        <h1 className="font-serif text-2xl font-semibold sm:text-3xl">Passage history</h1>
        <div className="mt-6">
          <EmptyState title={`“${reference}” is not a passage this app recognises`}>
            <p>
              Try a book, a chapter, or a verse — <em>John 15</em>, <em>Jn 15</em>, or{' '}
              <em>John 15:5</em>.
            </p>
            <p className="mt-3">
              <Link to={{ name: 'search', query: reference }} className={`underline ${FOCUS}`}>
                Search your journal for “{reference}” instead
              </Link>
            </p>
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-serif text-2xl font-semibold sm:text-3xl">My history with {label}</h1>

      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link to={passageRouteFor(ref)} className={`underline text-ink-soft ${FOCUS}`}>
          Read {label}
        </Link>
        {chapter ? (
          <Link
            to={{ name: 'passageHistory', reference: chapter }}
            className={`underline text-ink-soft ${FOCUS}`}
          >
            My history with {chapter}
          </Link>
        ) : null}
      </p>

      {loading ? <Spinner label="Loading your history" /> : null}

      {!loading && history ? (
        history.total === 0 ? (
          <div className="mt-6">
            {/* Calm, and without a verdict attached. Nothing here says they
                should have written, because that is not this app's business. */}
            <EmptyState title={`You haven’t written about ${label} yet`}>
              <p>When you do, it will appear here — in the order it happened.</p>
              <p className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
                <Link
                  to={{ name: 'newEntry', kind: 'reading', anchor: newEntryAnchor(ref) }}
                  className={`underline ${FOCUS}`}
                >
                  Start a Bible reading
                </Link>
                <Link
                  to={{ name: 'newEntry', kind: 'reflection', anchor: newEntryAnchor(ref) }}
                  className={`underline ${FOCUS}`}
                >
                  Write a reflection
                </Link>
              </p>
            </EmptyState>
          </div>
        ) : (
          <>
            {/* Descriptive, not a score. See the terminology note: this is
                memory, not measurement. */}
            <p className="mt-4 text-sm text-ink-muted">
              {history.total === 1 ? '1 saved moment' : `${history.total} saved moments`}
            </p>

            {/* Below a handful, year headings are scaffolding around nothing —
                the dates on the cards already say when. */}
            {history.years.length > 1 ? (
              <div className="mt-6 space-y-8">
                {history.years.map((year) => (
                  <Year key={year.year} {...year} passage={ref} />
                ))}
              </div>
            ) : (
              <ul className="mt-6 space-y-3">
                {history.entries.map((entry) => (
                  <li key={entry.id}>
                    <MomentCard entry={entry} passage={ref} level={2} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      ) : null}
    </div>
  );
}
