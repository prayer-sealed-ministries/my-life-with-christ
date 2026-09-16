/**
 * One book, as a complete list of journalable passages.
 *
 * `segmentsForBook` returns a gapless run: outline-backed passages where the
 * outlines cover the text, and `uncovered` spans where they do not. Both kinds
 * render as the same link to the same passage view, because a reader who opens
 * Genesis 35 and finds no way to write a note has hit a product bug, not a data
 * limitation. The uncovered rows are labelled in words — the lighter styling is
 * a hint, never the carrier of the meaning.
 *
 * Nothing here assumes the outline layer exists. Under `refs-only` there are no
 * outline entries at all: every segment is a whole chapter, `segmentTitle` hands
 * back the reference, `intro` is empty, and `series` is absent. Each is guarded
 * on the data itself rather than branched on a profile flag, with one exception
 * — the muted treatment for an uncovered row, which only means anything when
 * there are covered rows to contrast it with.
 */

import { Fragment, useMemo } from 'react';

import {
  hasOutlines,
  outlineBooksById,
  segmentNote,
  segmentTitle,
  segmentsForBook,
} from '../app/data';
import { Link } from '../app/router';
import { useStorage, useStorageQuery } from '../app/storage';
import { EmptyState, Tag } from '../components/ui';
import { BookTopicList } from '../components/TopicChips';
import { topicsForBook } from '../lib/topic-index';
import { BOOK_NAMES } from '../lib/canon';
import { segmentRef } from '../lib/passages';
import type { Entry, PassageSegment, ScriptureRef } from '../types';

/** Stable identity for the page's initial (empty) read. */
const NO_ENTRIES: Entry[] = [];

function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The verse range of a scripture anchor, as a comparable key.
 *
 * `findEntriesForAnchor({kind:'scripture', ...})` matches an anchor whose range
 * is exactly the segment's range. This reproduces that rule locally so the whole
 * book can be answered from one read instead of one query per segment — a long
 * book has 80+ segments, and 80 round trips for an already-indexed read is the
 * kind of thing that makes a phone feel broken in a pew.
 */
type VerseRange = Pick<ScriptureRef, 'chapterStart' | 'verseStart' | 'chapterEnd' | 'verseEnd'>;

function rangeKey(ref: VerseRange): string {
  return `${ref.chapterStart}:${ref.verseStart}:${ref.chapterEnd}:${ref.verseEnd}`;
}

function SegmentItem({
  segment,
  bookId,
  journalCount,
}: {
  segment: PassageSegment;
  bookId: string;
  journalCount: number;
}) {
  const title = segmentTitle(segment);
  // Profile-aware wording, and null for an outline-backed passage.
  const note = segmentNote(segment);
  // Only distinguish an uncovered row where there are covered rows to contrast
  // it with. Under `refs-only` every segment is a chapter, and muting all fifty
  // of them would say "something is missing here" about the whole Bible.
  const muted = hasOutlines && segment.kind === 'uncovered';
  // Under `refs-only` the title *is* the reference; do not print it twice.
  const showRef = title !== segment.ref;
  // Absent under `refs-only`, where no outline entry ships at all.
  const series = segment.kind === 'outline' ? segment.entry.series : null;
  const classicStory = segment.kind === 'outline' && segment.entry.classicStory;
  // Built as one list so each chip can carry its own spoken separator. Without
  // one they run together — "Series: MiracleClassic story".
  const tags = [
    series ? `Series: ${series}` : null,
    classicStory ? 'Classic story' : null,
    journalCount > 0 ? countLabel(journalCount, 'journal entry', 'journal entries') : null,
  ].filter((label): label is string => label !== null);

  return (
    <li>
      <Link
        to={{ name: 'passage', bookId, segmentId: segment.id }}
        // A row in a contents list, not a card. Matthew alone has 153 of these,
        // and a border and a radius around each one put 153 boxes on a page whose
        // job is to be read down. The list rule below separates them for a
        // fraction of the ink, which is what makes the BSB headings read as part
        // of the Bible rather than as application chrome.
        //
        // An uncovered span keeps its distinction, carried by the muted title
        // and by `note` below rather than by a dashed box — never by colour
        // alone, since the note says it in words.
        className="block min-h-11 px-3 py-3 transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span
          className={`block font-medium ${
            muted ? 'text-ink-soft' : 'text-ink'
          }`}
        >
          {title}
        </span>

        {/* The row is read aloud as one string, and without punctuation the
            title runs straight into the reference — "Creation Story Days
            1-6Genesis 1". `sr-only` is absolutely positioned, so the separator
            never affects the layout. */}
        {showRef ? (
          <>
            <span className="sr-only">, </span>
            <span className="mt-0.5 block text-sm text-ink-soft">
              {segment.ref}
            </span>
          </>
        ) : null}

        {/* Under `refs-only` every segment is uncovered, so the same sentence
            on all fifty rows says nothing. It is stated once above the list
            instead; here it earns its place by marking the exceptions. */}
        {note && hasOutlines ? (
          <>
            <span className="sr-only">, </span>
            <span className="mt-0.5 block text-sm text-ink-soft">{note}</span>
          </>
        ) : null}

        {tags.length > 0 ? (
          <span className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((label) => (
              <Fragment key={label}>
                <span className="sr-only">, </span>
                <Tag>{label}</Tag>
              </Fragment>
            ))}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function NotFound({ bookId }: { bookId: string }) {
  return (
    <>
      <h1 className="font-serif text-2xl font-semibold sm:text-3xl">Book not found</h1>
      <div className="mt-4">
        <EmptyState title={`There is no book called “${bookId}”.`}>
          <p>
            <Link
              to={{ name: 'browse' }}
              className="underline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Back to the list of books
            </Link>
          </p>
        </EmptyState>
      </div>
    </>
  );
}

export default function BookView({ bookId }: { bookId: string }) {
  // Explicitly optional: the id comes from the URL and may be anything.
  const name: string | undefined = BOOK_NAMES[bookId];
  const segments = useMemo(() => segmentsForBook(bookId), [bookId]);
  // Empty under `refs-only`, where the author's prose is not in the build.
  const intro = outlineBooksById.get(bookId)?.intro ?? '';
  const bookTopics = useMemo(() => topicsForBook(bookId), [bookId]);

  // A journal that could not be opened must never be reported as an empty one;
  // private browsing and blocked site data both land here.
  const { error: storageError } = useStorage();

  // One indexed read for the whole book; matched to segments below.
  const { data: entries, loading } = useStorageQuery(
    (storage) => storage.listEntries({ books: [bookId] }),
    [bookId],
    NO_ENTRIES,
  );

  const countsByRange = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      // An entry that anchors twice to the same passage is still one entry.
      const seen = new Set<string>();
      for (const anchor of entry.anchors) {
        if (anchor.kind !== 'scripture' || anchor.book !== bookId) continue;
        const key = rangeKey(anchor);
        if (seen.has(key)) continue;
        seen.add(key);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [entries, bookId]);

  if (!name || segments.length === 0) return <NotFound bookId={bookId} />;

  const paragraphs = intro.split(/\n{2,}/).map((text) => text.trim()).filter(Boolean);

  const journalSummary = storageError
    ? `${storageError} Entry counts may be missing.`
    : loading
      ? 'Checking your journal…'
      : entries.length === 0
        ? `No journal entries in ${name} yet.`
        : `${countLabel(entries.length, 'journal entry', 'journal entries')} in ${name}.`;

  return (
    <>
      <h1 className="font-serif text-2xl font-semibold sm:text-3xl">{name}</h1>

      {paragraphs.length > 0 ? (
        <div className="mt-4 space-y-3 text-ink-soft">
          {paragraphs.map((text, index) => (
            <p key={index} className="leading-relaxed">
              {text}
            </p>
          ))}
        </div>
      ) : null}

      {/* Every topic touching any part of this book, with how much of it is
          here. Independent of the outline layer by design. */}
      <BookTopicList topics={bookTopics} headingId="book-topics" />

      <h2 className="mt-8 font-serif text-xl font-semibold">
        Passages{' '}
        <span className="text-sm font-normal text-ink-soft">
          ({countLabel(segments.length, 'passage', 'passages')})
        </span>
      </h2>

      {/* A visible status line rather than a hidden one: the count is useful to
          everyone, and role="status" announces it once it has been read. A
          storage failure is reported in this same region rather than a second
          one, so it is announced once; the red is redundant to the words. */}
      <p
        role="status"
        className={`mt-1 text-sm ${
          storageError
            ? 'text-red-800 dark:text-red-300'
            : 'text-ink-soft'
        }`}
      >
        {journalSummary}
      </p>

      {/* The per-row version of this belongs on the exceptions. With no outline
          layer there are no exceptions, so the promise is made once, here. */}
      {hasOutlines ? null : (
        <p className="mt-1 text-sm text-ink-soft">
          Open any chapter to read it and add your own note.
        </p>
      )}

      <ul className="mt-4 divide-y divide-line border-y border-line">
        {segments.map((segment) => (
          <SegmentItem
            key={segment.id}
            segment={segment}
            bookId={bookId}
            journalCount={countsByRange.get(rangeKey(segmentRef(segment, bookId))) ?? 0}
          />
        ))}
      </ul>
    </>
  );
}
