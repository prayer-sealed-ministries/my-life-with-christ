/**
 * Browse the Bible: all 66 books, in canonical order.
 *
 * Every book is listed whether or not the outline layer has anything to say
 * about it. The product promise is that any passage can be reached and written
 * against, and that starts with never hiding a book from the list.
 *
 * The outline entry count is shown only when there is one, rather than being
 * gated on a profile flag. `refs-only` ships no outline layer at all, so the
 * count is zero there and the phrase simply does not appear; that also holds
 * for any future book the outlines do not reach.
 */

import { useId, useMemo, useRef, useState } from 'react';

import { canonBooks } from '../app/data';
import { Link } from '../app/router';
import { Button, EmptyState, Field, LiveRegion } from '../components/ui';

/** A number is never shown without its noun, and never with the wrong one. */
function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Match on the display name and the id both, so "1 sam", "1sam" and "1-samuel"
 * all find 1 Samuel. Punctuation and spacing are stripped from both sides
 * because nobody types "song-of-solomon" the way the data spells it.
 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const TOTAL = canonBooks.length;

export default function BrowseView() {
  const [filter, setFilter] = useState('');
  const headingId = useId();
  const searchRef = useRef<HTMLDivElement>(null);

  const needle = normalize(filter);
  const matched = useMemo(
    () =>
      needle
        ? canonBooks.filter((book) => normalize(`${book.name} ${book.id}`).includes(needle))
        : canonBooks,
    [needle],
  );

  const sections = [
    { key: 'OT', label: 'Old Testament', books: matched.filter((book) => book.testament === 'OT') },
    { key: 'NT', label: 'New Testament', books: matched.filter((book) => book.testament === 'NT') },
  ];

  // Filtering a list is a silent change for anyone not watching it happen, so
  // the result is announced politely rather than left to be discovered.
  //
  // Keyed on the normalized needle, not on the raw text: "!!!" normalizes away
  // to nothing and every book is still shown, and announcing "66 books match
  // “!!!”" would describe a filter that never ran.
  const announcement = needle
    ? `${countLabel(matched.length, 'book matches', 'books match')} “${filter.trim()}”.`
    : `Showing all ${TOTAL} books.`;

  /**
   * Clearing unmounts the button that was just pressed, which drops focus to
   * the document body and loses a keyboard user's place entirely. Focus goes
   * back to the field the filter belongs to instead. `Field` owns its input's
   * id and forwards no ref, so the input is reached through the wrapper.
   */
  function clearFilter() {
    setFilter('');
    searchRef.current?.querySelector('input')?.focus();
  }

  return (
    <>
      <h1 className="font-serif text-2xl font-semibold sm:text-3xl">The Bible</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-300">
        All {TOTAL} books, in canonical order. Open a book to read a passage and write about it.
      </p>

      <div
        ref={searchRef}
        role="search"
        className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <Field
          label="Find a book"
          type="search"
          autoComplete="off"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="flex-1"
        />
        {filter ? <Button onClick={clearFilter}>Clear</Button> : null}
      </div>

      <LiveRegion message={announcement} />

      {matched.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={`No book matches “${filter.trim()}”.`}>
            <p>Try part of a book name, such as “john” or “1 sam”.</p>
          </EmptyState>
        </div>
      ) : (
        sections.map((section) =>
          section.books.length === 0 ? null : (
            <section
              key={section.key}
              aria-labelledby={`${headingId}-${section.key}`}
              className="mt-8"
            >
              <h2
                id={`${headingId}-${section.key}`}
                className="font-serif text-xl font-semibold text-slate-900 dark:text-slate-100"
              >
                {section.label}
                {/* The space is written out: Tailwind's margin is not read aloud. */}
                {needle ? (
                  <>
                    {' '}
                    <span className="text-sm font-normal text-slate-600 dark:text-slate-300">
                      ({countLabel(section.books.length, 'book', 'books')})
                    </span>
                  </>
                ) : null}
              </h2>

              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {section.books.map((book) => (
                  <li key={book.id}>
                    <Link
                      to={{ name: 'book', bookId: book.id }}
                      className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-slate-900 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:hover:bg-slate-700"
                    >
                      <span className="font-medium">{book.name}</span>
                      {/* Separates the name from the counts when the link is
                          read aloud as one string. `sr-only` is absolutely
                          positioned, so it does not sit in the flex row. */}
                      <span className="sr-only">, </span>
                      <span className="text-sm text-slate-600 dark:text-slate-300">
                        {countLabel(book.chapters, 'chapter', 'chapters')}
                        {book.entryCount > 0
                          ? `, ${countLabel(book.entryCount, 'outline entry', 'outline entries')}`
                          : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ),
        )
      )}
    </>
  );
}
