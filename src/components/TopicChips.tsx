/**
 * "Topics in this passage" — the reverse link from scripture back to topics.
 *
 * Topics map to passages one way in the data. Without this, a reader in
 * Matthew 6 has no way of knowing the chapter speaks to money, anxiety and
 * prayer; the connection exists but only from the other end, which is not where
 * the reader is.
 *
 * Works identically with or without the outline layer, because it is built from
 * topics.json, which ships under every data profile. On the public build this
 * is the whole discovery layer.
 */

import { Link } from '../app/router';
import type { TopicTouch } from '../lib/topic-index';

export function TopicChips({
  touches,
  heading = 'Topics in this passage',
  headingId,
}: {
  touches: TopicTouch[];
  heading?: string;
  headingId?: string;
}) {
  if (touches.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="mt-4">
      <h2
        id={headingId}
        className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
      >
        {heading}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {touches.map(({ topic }) => (
          <li key={topic.id}>
            <Link
              to={{ name: 'topic', topicId: topic.id }}
              className="inline-flex min-h-11 max-w-full items-center rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {topic.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The same list for a whole book, where the count is what makes it useful. */
export function BookTopicList({
  topics,
  headingId,
}: {
  topics: Array<{ topic: { id: string; name: string }; passages: number }>;
  headingId?: string;
}) {
  if (topics.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="mt-8">
      <h2 id={headingId} className="font-serif text-lg font-semibold">
        Topics in this book
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        {topics.length} {topics.length === 1 ? 'topic touches' : 'topics touch'} some part of this book.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {topics.map(({ topic, passages }) => (
          <li key={topic.id}>
            <Link
              to={{ name: 'topic', topicId: topic.id }}
              className="inline-flex min-h-11 max-w-full flex-wrap items-center gap-x-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {topic.name}
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {passages} {passages === 1 ? 'passage' : 'passages'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
