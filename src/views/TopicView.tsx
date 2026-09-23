/**
 * One topic: the passages that speak to it, and what has been written about it.
 *
 * The scripture list is the page. A topic carries scripture refs and nothing
 * else, so this view works identically whether or not the outline layer is in
 * the build — under `refs-only` the outline section simply has nothing to show
 * and the refs still read, link and journal exactly the same.
 *
 * A ref is linked by resolving it to the segment that *contains* its first
 * verse, because segments — not refs — are what the passage view addresses. A
 * ref that lands in no segment still renders as readable text: a curated
 * reference must never become a dead end.
 */

import { useMemo } from 'react';

import {
  topicsById,
  versification,
} from '../app/data';
import { useSections } from '../app/sections';
import { Link } from '../app/router';
import { useStorageQuery } from '../app/storage';
import { EmptyState, Spinner, Tag } from '../components/ui';
import { BOOK_NAMES } from '../lib/canon';
import { formatRef, resolveTopicEntries } from '../lib/passages';
import type { Entry, EntryKind, ScriptureRef } from '../types';

const KIND_LABELS: Record<EntryKind, string> = {
  sermon: 'Sermon',
  reading: 'Reading',
  service: 'Service',
  prayer: 'Prayer',
  reflection: 'Reflection',
  letter: 'Letter',
};

const LINK =
  'underline decoration-line-strong underline-offset-4 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2';

const CARD =
  'rounded-card border border-line bg-surface p-4';

/**
 * The curated one-liner topics.json keeps beside each ref.
 *
 * `ScriptureRef` is the portable anchor type and deliberately carries no prose,
 * so the note is read off the object rather than widening that contract for the
 * sake of one view.
 */
function refNote(ref: ScriptureRef): string | undefined {
  // `in` narrows without a cast, so the note is read only when it is really there.
  if (!('note' in ref)) return undefined;
  return typeof ref.note === 'string' ? ref.note : undefined;
}

/** Human reference, e.g. "Genesis 2:18-25". */
function refLabel(ref: ScriptureRef): string {
  const bookName = BOOK_NAMES[ref.book] ?? ref.book;
  const counts = versification[ref.book];
  return counts ? formatRef(ref, bookName, counts) : bookName;
}

/** A local date rendered from its parts: `new Date('2026-03-15')` is UTC and can slip a day. */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function TopicNotFound({ topicId }: { topicId: string }) {
  return (
    <>
      <h1 className="font-serif text-2xl font-semibold sm:text-3xl">Topic not found</h1>
      <p className="measure mt-2 text-ink-soft">
        There is no topic called{' '}
        {/* The id comes straight off the URL and has no spaces to wrap at, so it
            is broken mid-word rather than pushing the page sideways on a phone. */}
        <code className="break-words rounded bg-raised px-1">{topicId}</code>{' '}
        in this build.
      </p>
      <p className="mt-4">
        <Link
          to={{ name: 'topics' }}
          className={`inline-flex min-h-11 items-center text-ink ${LINK}`}
        >
          See all topics
        </Link>
      </p>
    </>
  );
}

export default function TopicView({ topicId }: { topicId: string }) {
  // A topic resolves to spans of Scripture, and naming them needs the divisions.
  const sections = useSections();
  const topic = topicsById.get(topicId);

  // Outline entries are the enhancement direction and only that: resolved from
  // the topic's refs, never the other way round. Empty under `refs-only`
  // whenever the outline layer is not in the build.
  const outlineEntries = useMemo(
    () =>
      topic && sections
        ? resolveTopicEntries(topic, sections.outlineBooksById, versification)
        : [],
    [topic, sections],
  );

  const { data: entries, loading } = useStorageQuery<Entry[]>(
    (storage) =>
      topic ? storage.findEntriesForExactAnchor({ kind: 'topic', topicId }) : Promise.resolve([]),
    [topicId],
    [],
  );

  // After every hook. A topic's own name and prose are ready immediately; what
  // waits is the Scripture the topic points at, and naming those spans is what
  // needs the divisions.
  if (!sections) return <Spinner label="Loading" />;
  if (!topic) return <TopicNotFound topicId={topicId} />;

  return (
    <>
      <p className="mb-3">
        <Link
          to={{ name: 'topics' }}
          className={`inline-flex min-h-11 items-center gap-1 text-sm text-ink-soft hover:text-ink ${LINK}`}
        >
          <span aria-hidden="true">←</span> All topics
        </Link>
      </p>

      <h1 className="font-serif text-2xl font-semibold sm:text-3xl">{topic.name}</h1>
      <p className="measure mt-2 text-ink-soft">{topic.description}</p>

      <h2 className="mt-8 font-serif text-xl font-semibold">Passages</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {topic.refs.length} {topic.refs.length === 1 ? 'passage' : 'passages'}, with a line on why
        each one is here.
      </p>

      <ul className="mt-4 space-y-3">
        {topic.refs.map((ref, index) => {
          const label = refLabel(ref);
          // Segments are gapless within a book, so this resolves for any ref
          // inside the book's verse count. It comes back undefined for a book
          // this build has no versification for, which the fallback below
          // handles rather than dropping the reference.
          const segment = sections.segmentContaining(ref.book, ref.chapterStart, ref.verseStart);
          const note = refNote(ref);
          // Under `refs-only` this is just the segment's reference; it is shown
          // only when it says something the ref label does not.
          const context = segment ? sections.segmentTitle(segment) : null;

          return (
            <li
              key={`${ref.book}-${ref.chapterStart}-${ref.verseStart}-${index}`}
              className={CARD}
            >
              {segment ? (
                <Link
                  to={{ name: 'passage', bookId: ref.book, segmentId: segment.id }}
                  className={`inline-flex min-h-11 items-center font-serif text-lg font-semibold text-ink ${LINK}`}
                >
                  {label}
                </Link>
              ) : (
                <p className="font-serif text-lg font-semibold">{label}</p>
              )}

              {note ? (
                <p className="mt-1 text-sm text-ink-soft">{note}</p>
              ) : null}

              {context && context !== label ? (
                <p className="mt-2 text-xs text-ink-muted">
                  Reading view: {context}
                </p>
              ) : null}

              {/* Never a dead end: the reference still reads even with nowhere to open. */}
              {!segment ? (
                <p className="mt-2 text-xs text-ink-muted">
                  No reading view for this reference in this build.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {outlineEntries.length > 0 ? (
        <>
          <h2 className="mt-8 font-serif text-xl font-semibold">Also in the outline</h2>
          <p className="mt-1 text-sm text-ink-soft">
            The outline study sections that overlap the passages above. An extra, not the point —
            the passages stand on their own.
          </p>
          <ul className="mt-4 space-y-2">
            {outlineEntries.map((entry) => {
              const segment = sections.findSegment(entry.book, entry.id);
              const label = segment ? sections.segmentTitle(segment) : entry.ref;
              return (
                <li key={entry.id}>
                  {segment ? (
                    <Link
                      to={{ name: 'passage', bookId: entry.book, segmentId: entry.id }}
                      className={`inline-flex min-h-11 items-center text-ink ${LINK}`}
                    >
                      {label}
                    </Link>
                  ) : (
                    <p className="py-2">{label}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      <h2 className="mt-8 font-serif text-xl font-semibold">Your entries on this topic</h2>

      {loading ? (
        <Spinner label="Loading your entries" />
      ) : entries.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={`Nothing written under ${topic.name} yet`}>
            <p>An entry tagged with this topic will appear here.</p>
            <p className="mt-3">
              <Link
                to={{ name: 'newEntry', anchor: `topic:${topic.id}` }}
                className="inline-flex min-h-11 items-center rounded-control border border-accent bg-accent text-accent-ink hover:bg-accent-hover px-4 py-2 font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Write about {topic.name}
              </Link>
            </p>
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                to={{ name: 'entry', id: entry.id }}
                className={`block ${CARD} transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2`}
              >
                {/* A title is whatever was typed; a long unbroken one must wrap
                    rather than widen the page on a phone. */}
                <span className="block break-words font-medium text-ink">
                  {entry.title || 'Untitled entry'}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  <span>{formatDate(entry.date)}</span>
                  {/* An entry imported from a newer version can carry a kind this
                      build has no label for. Show the raw kind rather than an
                      empty badge, which would read as no kind at all. */}
                  <Tag>{KIND_LABELS[entry.kind] ?? entry.kind}</Tag>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
