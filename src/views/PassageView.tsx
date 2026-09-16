/**
 * One passage: the scripture text, and everything written against it.
 *
 * This is the hinge of the whole app. Reading and writing meet on one screen, so
 * a person sitting in a pew can follow along and capture a thought without
 * navigating anywhere. Two consequences shape the layout:
 *
 * 1. The text is typeset for *reading* — serif, generous leading, superscript
 *    verse numbers — not for scanning. It is also labelled as the King James
 *    Version, plainly, so scripture is never mistaken for someone's note.
 * 2. "Add entry" is reachable before the reader has scrolled the passage, and
 *    again at the bottom where their own notes live.
 *
 * The passage may be an outline segment or an uncovered span; both render the
 * same and journal through the identical action. Under the `refs-only` data
 * profile there is no title to show, so everything goes through segmentTitle().
 */

import { useEffect, useMemo, useState } from 'react';

import {
  findSegment,
  hasOutlines,
  segmentContaining,
  segmentNote,
  segmentsForBook,
  segmentTitle,
} from '../app/data';
import { Link } from '../app/router';
import { useStorageQuery } from '../app/storage';
import { EmptyState, LiveRegion, Spinner, Tag } from '../components/ui';
import { TopicChips } from '../components/TopicChips';
import { topicsForSpan } from '../lib/topic-index';
import { KIND_LABELS } from '../export/context';
import { loadPassage, refToString, type PassageVerse } from '../lib/bible';
import { BOOK_NAMES } from '../lib/canon';
import { segmentRef } from '../lib/passages';
import type { Entry, PassageSegment, ScriptureRef } from '../types';

/** Which passage a read answers for. Stamped on the result, checked on render. */
const refKey = (ref: ScriptureRef): string =>
  `${ref.book}:${ref.chapterStart}:${ref.verseStart}:${ref.chapterEnd}:${ref.verseEnd}`;

/** Stable identity for the first render, before any read has answered. */
const NO_JOURNAL: { key: string; entries: Entry[] } = { key: '', entries: [] };

/** Shared with the shell's other link-shaped actions; a real anchor, never a div. */
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current';

/** Verses grouped into the chapters they fall in, in order. */
function byChapter(verses: PassageVerse[]): Array<{ chapter: number; verses: PassageVerse[] }> {
  const groups: Array<{ chapter: number; verses: PassageVerse[] }> = [];
  for (const verse of verses) {
    const last = groups[groups.length - 1];
    if (last && last.chapter === verse.chapter) last.verses.push(verse);
    else groups.push({ chapter: verse.chapter, verses: [verse] });
  }
  return groups;
}

/**
 * An ISO event date, written out.
 *
 * A malformed date is shown verbatim rather than hidden: an imported journal
 * should never lose information to a formatter.
 */
function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function PassageNav({
  bookId,
  bookName,
  previous,
  next,
}: {
  bookId: string;
  bookName: string;
  previous: PassageSegment | undefined;
  next: PassageSegment | undefined;
}) {
  const linkClass = `flex h-full min-h-11 flex-col justify-center rounded-control border border-line-strong px-3 py-2 transition-colors hover:bg-raised ${FOCUS}`;

  return (
    <nav aria-label="Passages in this book" className="mt-10 border-t border-line pt-6">
      <ul className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:justify-between">
        {previous ? (
          <li className="sm:flex-1">
            <Link
              to={{ name: 'passage', bookId, segmentId: previous.id }}
              rel="prev"
              className={linkClass}
            >
              <span className="text-xs uppercase tracking-wide text-ink-muted">
                Previous
              </span>
              <span className="font-medium">{segmentTitle(previous)}</span>
            </Link>
          </li>
        ) : null}
        <li className="sm:flex-none">
          <Link
            to={{ name: 'book', bookId }}
            className={`${linkClass} sm:items-center sm:text-center`}
          >
            <span className="font-medium">All of {bookName}</span>
          </Link>
        </li>
        {next ? (
          <li className="sm:flex-1">
            <Link
              to={{ name: 'passage', bookId, segmentId: next.id }}
              rel="next"
              className={`${linkClass} sm:items-end sm:text-right`}
            >
              <span className="text-xs uppercase tracking-wide text-ink-muted">
                Next
              </span>
              <span className="font-medium">{segmentTitle(next)}</span>
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

function EntryCard({ entry }: { entry: Entry }) {
  return (
    <article className="rounded-card border border-line bg-surface p-4">
      <h3 className="font-serif text-lg font-semibold">
        <Link
          to={{ name: 'entry', id: entry.id }}
          className={`inline-flex min-h-11 items-center underline decoration-line-strong underline-offset-4 hover:decoration-current ${FOCUS}`}
        >
          {entry.title.trim() || 'Untitled entry'}
        </Link>
      </h3>
      {/* Each fact carries its own label for assistive tech; visually the gap and
          the order do the work, so nothing depends on position alone. */}
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-ink-soft">
        <time dateTime={entry.date}>{formatDate(entry.date)}</time>
        <span>{KIND_LABELS[entry.kind]}</span>
        {entry.speaker ? (
          <span>
            <span className="sr-only">Speaker: </span>
            {entry.speaker}
          </span>
        ) : null}
        {entry.place ? (
          <span>
            <span className="sr-only">Place: </span>
            {entry.place}
          </span>
        ) : null}
      </p>
    </article>
  );
}

export default function PassageView({ bookId, segmentId }: { bookId: string; segmentId: string }) {
  // Explicitly optional: the id comes from the URL and may be anything.
  const bookName: string | undefined = BOOK_NAMES[bookId];

  // segmentsForBook caches per book, so these memos hold a stable identity and
  // the passage effect below does not re-fire on every render.
  const segment = useMemo(() => findSegment(bookId, segmentId), [bookId, segmentId]);
  const neighbours = useMemo(() => {
    const all = segmentsForBook(bookId);
    const at = all.findIndex((candidate) => candidate.id === segmentId);
    return at < 0
      ? { previous: undefined, next: undefined }
      : { previous: all[at - 1], next: all[at + 1] };
  }, [bookId, segmentId]);

  const ref = useMemo(() => (segment ? segmentRef(segment, bookId) : null), [segment, bookId]);

  const topicTouches = useMemo(
    () =>
      segment
        ? topicsForSpan(
            bookId,
            segment.chapterStart,
            segment.verseStart,
            segment.chapterEnd,
            segment.verseEnd,
          )
        : [],
    [segment, bookId],
  );

  /**
   * Where a segment id this build does not have was pointing.
   *
   * Ids are `<book>-<numbers>` in both schemes the app produces: a whole chapter
   * is `genesis-3`, a chapter range `genesis-6-9`, a verse range
   * `genesis-4-25-26`, a cross-chapter range `genesis-1-5-2-3`. Across all four
   * the first number is the start chapter, and the second is the start verse
   * only when there are three or more — with two, it is the end chapter. That is
   * enough to offer the passage the link was reaching for. Only computed when
   * the id did not resolve, which is the case it exists for: a re-ingest moves
   * outline ids, and under `refs-only` there are no outline divisions at all.
   */
  const nearest = useMemo(() => {
    if (segment || !segmentId.startsWith(`${bookId}-`)) return undefined;
    const parts = segmentId.slice(bookId.length + 1).split('-');
    if (!parts.every((part) => /^\d+$/.test(part))) return undefined;
    const numbers = parts.map(Number);
    return segmentContaining(bookId, numbers[0], parts.length >= 3 ? numbers[1] : 1);
  }, [segment, bookId, segmentId]);

  // null means "still loading"; an empty array means the text did not resolve.
  const [verses, setVerses] = useState<PassageVerse[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Reset synchronously rather than a tick later: this runs when the passage
    // changes, and the previous passage's text must not sit under the new
    // passage's heading for even a frame. Showing the wrong scripture is worse
    // than an extra render pass, so the lint rule — a performance heuristic —
    // is deliberately overridden here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVerses(ref ? null : []);

    if (ref) {
      loadPassage(ref)
        .then((loaded) => {
          if (!cancelled) setVerses(loaded);
        })
        .catch(() => {
          // loadPassage already returns [] for a reference that does not resolve;
          // this catches a missing book file. Either way the reader gets a plain
          // message instead of a blank page.
          if (!cancelled) setVerses([]);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [ref]);

  // One indexed read for the whole passage, stamped with the passage it answers
  // for. Moving to the next passage re-renders this same component instance, and
  // the read in hand is still the last one until the new one lands — an answer
  // that does not carry this passage's key would put the previous passage's
  // notes under this passage's heading, which is worse than a spinner.
  const passageKey = ref ? refKey(ref) : '';
  const { data: journal, loading } = useStorageQuery<{ key: string; entries: Entry[] }>(
    async (storage) => ({
      key: passageKey,
      entries: ref ? await storage.findEntriesForAnchor({ kind: 'scripture', ...ref }) : [],
    }),
    [ref],
    NO_JOURNAL,
  );
  const entriesReady = !loading && journal.key === passageKey;
  const entries = entriesReady ? journal.entries : [];

  if (!segment || !ref) {
    return (
      <>
        <h1 className="font-serif text-2xl font-semibold sm:text-3xl">Passage not found</h1>
        <p className="measure mt-3 text-ink-soft">
          There is no passage{' '}
          <code className="break-words rounded bg-raised px-1">{segmentId}</code>{' '}
          in {bookName ?? 'that book'}.{' '}
          {hasOutlines
            ? 'An outline id can change when the outlines are re-ingested.'
            : 'This build browses whole chapters, so a link to an outline division does not open here.'}
        </p>

        {/* Every passage stays reachable. The division that link named has gone,
            but the scripture it named has not, so offer the passage that holds
            it rather than leaving the reader to hunt through the book. */}
        {nearest ? (
          <p className="mt-4">
            <Link
              to={{ name: 'passage', bookId, segmentId: nearest.id }}
              className={`inline-flex min-h-11 items-center underline underline-offset-4 ${FOCUS}`}
            >
              Read {segmentTitle(nearest)}, which contains it
            </Link>
          </p>
        ) : null}

        <p className="mt-4">
          {bookName ? (
            <Link
              to={{ name: 'book', bookId }}
              className={`inline-flex min-h-11 items-center underline underline-offset-4 ${FOCUS}`}
            >
              Browse all of {bookName}
            </Link>
          ) : (
            <Link
              to={{ name: 'browse' }}
              className={`inline-flex min-h-11 items-center underline underline-offset-4 ${FOCUS}`}
            >
              Browse the Bible
            </Link>
          )}
        </p>
      </>
    );
  }

  const title = segmentTitle(segment);
  const reference = refToString(ref, bookName ?? bookId);
  const outlineEntry = segment.kind === 'outline' ? segment.entry : null;
  // `series` is one of the fields stripped under `refs-only`, so it is simply
  // absent there and the tag does not render. `classicStory` is a bare fact and
  // survives both profiles.
  const series = outlineEntry?.series ?? null;
  const classicStory = outlineEntry?.classicStory === true;
  const note = segmentNote(segment);

  const chapters = byChapter(verses ?? []);
  const multiChapter = chapters.length > 1;

  const addEntry = (
    <Link
      to={{ name: 'newEntry', anchor: segmentId }}
      className={`inline-flex min-h-11 w-full items-center justify-center rounded-control border border-accent bg-accent text-accent-ink hover:bg-accent-hover px-5 py-2.5 text-base font-medium transition-colors sm:w-auto ${FOCUS}`}
    >
      Add entry for this passage
    </Link>
  );

  // A Spinner announces itself on the way in; nothing announces its removal, so
  // the outcome of each load is reported too.
  const scriptureStatus =
    verses === null
      ? ''
      : verses.length === 0
        ? `No scripture text available for ${reference}.`
        : `${reference} loaded, ${verses.length} ${verses.length === 1 ? 'verse' : 'verses'}.`;

  const entriesStatus = !entriesReady
    ? ''
    : entries.length === 0
      ? `No entries yet for ${reference}.`
      : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} on ${reference}.`;

  return (
    <>
      <h1 className="font-serif text-2xl font-semibold sm:text-3xl">{title}</h1>

      {/* For an uncovered span — and for every segment under `refs-only` — the
          heading already *is* the reference. Repeating it would be noise. */}
      {reference !== title ? (
        <p className="mt-1 text-base text-ink-soft">{reference}</p>
      ) : null}

      {/* Only ever set for a segment with no outline entry behind it, and worded
          by profile — under `refs-only` there is no outline layer to be missing
          from, so it must not say anything is absent. */}
      {note ? <p className="mt-2 text-sm text-ink-muted">{note}</p> : null}

      {series || classicStory ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {series ? (
            <li>
              <Tag>Series: {series}</Tag>
            </li>
          ) : null}
          {classicStory ? (
            <li>
              <Tag>Classic story</Tag>
            </li>
          ) : null}
        </ul>
      ) : null}

      {/* The reverse link. Built from topics.json, so it is here under every
          data profile — on the public build it is the only discovery layer
          there is. */}
      <TopicChips touches={topicTouches} headingId="passage-topics" />

      <div className="mt-5">{addEntry}</div>

      <section aria-labelledby="scripture-heading" className="mt-8">
        <h2
          id="scripture-heading"
          className="text-sm font-semibold uppercase tracking-wide text-ink-muted"
        >
          King James Version
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Scripture, word for word. Your own notes are further down this page.
        </p>
        <LiveRegion message={scriptureStatus} />

        {verses === null ? (
          <Spinner label={`Loading ${reference}`} />
        ) : verses.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="This passage has no text to show">
              <p>
                {reference} did not resolve to any verses in the King James text on this device. You
                can still write a note here.
              </p>
            </EmptyState>
          </div>
        ) : (
          <div className="measure mt-4 font-serif text-lg leading-loose text-ink">
            {chapters.map((group, groupIndex) => (
              <div key={group.chapter}>
                {/* A passage may run across a chapter boundary. When it does, every
                    chapter gets a heading — including the first — so the reader can
                    see where one ends and the next begins, not just that it changed.
                    The rule is drawn between chapters only, hence the index test
                    rather than a `first:` variant: each group is its own element,
                    so `first:` would match every heading. */}
                {multiChapter ? (
                  <h3
                    className={`font-sans text-sm font-semibold uppercase tracking-wide text-ink-muted ${
                      groupIndex === 0 ? '' : 'mt-8 border-t border-line pt-4'
                    }`}
                  >
                    {bookName ?? bookId} chapter {group.chapter}
                  </h3>
                ) : null}
                {group.verses.map((verse) => (
                  <p key={`${verse.chapter}:${verse.number}`} className="mt-3 first:mt-0">
                    {/* A superscript is typography, not punctuation: read aloud,
                        the number runs straight into the first word — "1In the
                        beginning". The spoken form is a short sentence of its
                        own, and the visual one is hidden from the reader that
                        would otherwise hear it twice. */}
                    <sup
                      aria-hidden="true"
                      className="mr-1 align-super font-sans text-xs font-semibold text-ink-muted"
                    >
                      {verse.number}
                    </sup>
                    <span className="sr-only">Verse {verse.number}. </span>
                    {verse.text}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="entries-heading" className="mt-10">
        <h2 id="entries-heading" className="font-serif text-xl font-semibold">
          Your entries on this passage
        </h2>
        <LiveRegion message={entriesStatus} />

        {!entriesReady ? (
          <Spinner label="Loading your entries" />
        ) : entries.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="Nothing written here yet">
              <p>The first note on {reference} can be yours.</p>
              <div className="mt-4 flex justify-center">{addEntry}</div>
            </EmptyState>
          </div>
        ) : (
          <>
            <ul className="mt-4 space-y-3">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <EntryCard entry={entry} />
                </li>
              ))}
            </ul>
            {/* The promise at the top of this file: writing is reachable at the
                bottom too. Without this the only way to add a second note is to
                scroll back past the whole passage — on a phone, past a chapter. */}
            <div className="mt-6">{addEntry}</div>
          </>
        )}
      </section>

      <PassageNav
        bookId={bookId}
        bookName={bookName ?? bookId}
        previous={neighbours.previous}
        next={neighbours.next}
      />
    </>
  );
}
