import { DATA_PROFILE, hasOutlineTitles, outlines } from 'virtual:journey-data';

/**
 * Placeholder shell. The browse, journal, search, timeline and export views
 * land on top of this; it exists now so the data pipeline and the DATA_PROFILE
 * gate can be built and verified end to end.
 */
export default function App() {
  const entryCount = outlines.reduce((sum, book) => sum + book.entries.length, 0);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Journey</h1>
      <p className="mt-2 text-sm opacity-70">
        {outlines.length} books, {entryCount} outline entries. Data profile:{' '}
        <code>{DATA_PROFILE}</code>
        {hasOutlineTitles ? '' : ' (outline titles and intros excluded)'}
      </p>
      <ul className="mt-6 space-y-1">
        {outlines.slice(0, 5).map((book) => (
          <li key={book.id} className="text-sm">
            <span className="font-medium">{book.name}</span>{' '}
            <span className="opacity-60">
              {book.entries.length} entries
              {book.entries[0] && hasOutlineTitles ? ` — e.g. ${book.entries[0].displayTitle}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
