/**
 * Topics — the 40 life topics.
 *
 * This is the door for someone who arrives with a situation rather than a
 * reference: "my marriage is hard", "I am afraid", "we buried my father". The
 * list is short enough to read straight through on a phone, so the filter is a
 * convenience rather than the primary means of finding something.
 *
 * Topics map to scripture refs, never to outline ids, so nothing on this page
 * changes between data profiles.
 */

import { useMemo, useRef, useState } from 'react';

import { topics } from '../app/data';
import { Link } from '../app/router';
import { Button, EmptyState, Field, LiveRegion } from '../components/ui';
import type { Topic } from '../types';

/** "1 passage" / "9 passages" — a count on its own reads as a stray number. */
function passageCount(topic: Topic): string {
  return `${topic.refs.length} ${topic.refs.length === 1 ? 'passage' : 'passages'}`;
}

function matchesFilter(topic: Topic, needle: string): boolean {
  return (
    topic.name.toLowerCase().includes(needle) || topic.description.toLowerCase().includes(needle)
  );
}

export default function TopicsView() {
  const [filter, setFilter] = useState('');
  // A live region only speaks when its text changes, so it has to start empty:
  // announcing the full count on first paint would talk over the page heading.
  const [hasFiltered, setHasFiltered] = useState(false);
  // Field owns its own input id and does not forward a ref, so the container is
  // the handle used to put focus back after the filter is cleared. Without it,
  // clearing removes the focused button and focus falls to the document body.
  const filterBox = useRef<HTMLDivElement>(null);

  const needle = filter.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? topics.filter((topic) => matchesFilter(topic, needle)) : topics),
    [needle],
  );

  const changeFilter = (value: string) => {
    setFilter(value);
    setHasFiltered(true);
  };

  const clearFilter = () => {
    changeFilter('');
    filterBox.current?.querySelector<HTMLInputElement>('input')?.focus();
  };

  // Emptying the filter changes the count just as much as typing into it does,
  // and neither moves focus, so both are spoken. Saying nothing on a clear left
  // the reader with 40 restored topics and no indication anything had happened.
  const announcement = !hasFiltered
    ? ''
    : needle
      ? `${shown.length} of ${topics.length} topics match ${filter.trim()}.`
      : `Filter cleared. Showing all ${topics.length} topics.`;

  return (
    <>
      <h1 className="font-serif text-2xl font-semibold sm:text-3xl">Topics</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-300">
        Life topics — money, grief, marriage, doubt, thankfulness. Each one leads to the passages
        that speak to it.
      </p>

      <div ref={filterBox} className="mt-5">
        <Field
          label="Filter topics"
          hint="Matches the topic name and its description."
          type="search"
          autoComplete="off"
          value={filter}
          onChange={(event) => changeFilter(event.target.value)}
        />
        {filter ? (
          <Button className="mt-2" onClick={clearFilter}>
            Clear filter
          </Button>
        ) : null}
      </div>

      <h2 className="mt-6 font-serif text-lg font-semibold">
        {needle ? 'Matching topics' : 'All topics'}
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Showing {shown.length} of {topics.length} topics.
      </p>
      {/* Filtering changes the page under the reader with no focus move, so the
          new count is spoken rather than left to be discovered. */}
      <LiveRegion message={announcement} />

      {shown.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={`No topic matches “${filter.trim()}”`}>
            <p>
              Try a shorter word — the filter looks at topic names and their descriptions, not at
              the scripture text.
            </p>
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {shown.map((topic) => (
            <li key={topic.id}>
              <Link
                to={{ name: 'topic', topicId: topic.id }}
                className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-500 dark:hover:bg-slate-800"
              >
                <span className="font-serif text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {topic.name}
                </span>
                <span className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  {topic.description}
                </span>
                <span className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                  {passageCount(topic)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
