/**
 * Route switch.
 *
 * Views are lazily loaded so a first paint does not pull the editor, the export
 * machinery, and the print view along with it. The shell renders around every
 * route and owns navigation, landmarks and post-navigation focus.
 */

import { Suspense, lazy } from 'react';

import { Shell } from './app/Shell';
import { Link, useRouter } from './app/router';
import { Spinner } from './components/ui';
import { BOOK_NAMES } from './lib/canon';
import { topicsById } from './app/data';

const HomeView = lazy(() => import('./views/HomeView'));
const BrowseView = lazy(() => import('./views/BrowseView'));
const BookView = lazy(() => import('./views/BookView'));
const PassageView = lazy(() => import('./views/PassageView'));
const TopicsView = lazy(() => import('./views/TopicsView'));
const TopicView = lazy(() => import('./views/TopicView'));
const TimelineView = lazy(() => import('./views/TimelineView'));
const SearchView = lazy(() => import('./views/SearchView'));
const EntryEditor = lazy(() => import('./views/EntryEditor'));
const DataView = lazy(() => import('./views/DataView'));
// Its own chunk: the document parsers, and the PDF engine behind them, are
// downloaded only by someone who actually opens Import.
const ImportView = lazy(() => import('./views/ImportView'));
const LegacyView = lazy(() => import('./views/LegacyView'));

/** The document title for a route, also announced after navigation. */
function titleFor(route: ReturnType<typeof useRouter>['route']): string {
  switch (route.name) {
    case 'home':
      return 'Life With Christ';
    case 'browse':
      return 'The Bible';
    case 'book':
      return BOOK_NAMES[route.bookId] ?? 'Book';
    case 'passage':
      return `${BOOK_NAMES[route.bookId] ?? 'Passage'} — reading`;
    case 'topics':
      return 'Topics';
    case 'topic':
      return topicsById.get(route.topicId)?.name ?? 'Topic';
    case 'timeline':
      return 'My journey';
    case 'search':
      return 'Search';
    case 'entry':
      return 'Entry';
    case 'newEntry':
      return 'New entry';
    case 'data':
      return 'Your journal';
    case 'import':
      return 'Import notes';
    case 'legacy':
      return 'My Journey With Christ';
    default:
      return 'Not found';
  }
}

function NotFound({ path }: { path: string }) {
  return (
    <>
      <h1 className="font-serif text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-ink-soft">
        There is nothing at <code className="rounded bg-raised px-1">{path}</code>.
      </p>
      <p className="mt-4">
        <Link to={{ name: 'home' }} className="underline focus-visible:outline-2">
          Go back to the start
        </Link>
      </p>
    </>
  );
}

function CurrentView() {
  const { route } = useRouter();

  switch (route.name) {
    case 'home':
      return <HomeView />;
    case 'browse':
      return <BrowseView />;
    case 'book':
      return <BookView bookId={route.bookId} />;
    case 'passage':
      return <PassageView bookId={route.bookId} segmentId={route.segmentId} />;
    case 'topics':
      return <TopicsView />;
    case 'topic':
      return <TopicView topicId={route.topicId} />;
    case 'timeline':
      return <TimelineView />;
    case 'search':
      return <SearchView query={route.query} />;
    // Keyed by target so React remounts rather than reusing the instance.
    // The editor holds transient state — a primed delete confirmation, a save
    // error — that must never survive a move to a different entry.
    case 'entry':
      return <EntryEditor key={`entry:${route.id}`} entryId={route.id} />;
    case 'newEntry':
      return <EntryEditor key={`new:${route.anchor ?? ''}`} anchorParam={route.anchor} />;
    case 'data':
      return <DataView />;
    case 'import':
      return <ImportView />;
    case 'legacy':
      return <LegacyView />;
    default:
      return <NotFound path={route.path} />;
  }
}

export default function App() {
  const { route } = useRouter();

  return (
    <Shell title={titleFor(route)}>
      <Suspense fallback={<Spinner label="Loading" />}>
        <CurrentView />
      </Suspense>
    </Shell>
  );
}
