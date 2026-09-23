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
import { editorSessionKey } from './app/editor-session';
import { Spinner } from './components/ui';
import { BOOK_NAMES } from './lib/canon';
import { topicsById } from './app/data';

const HomeView = lazy(() => import('./views/HomeView'));
const BrowseView = lazy(() => import('./views/BrowseView'));
const BookView = lazy(() => import('./views/BookView'));
const PassageView = lazy(() => import('./views/PassageView'));
const PassageHistoryView = lazy(() => import('./views/PassageHistoryView'));
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
// The application pages: reached from the menu rather than the primary nav, and
// lazy like every other route so the journal does not pay for them at startup.
const SettingsView = lazy(() => import('./views/SettingsView'));
const HelpView = lazy(() => import('./views/HelpView'));
const AboutView = lazy(() => import('./views/AboutView'));

/** The document title for a route, also announced after navigation. */
function titleFor(route: ReturnType<typeof useRouter>['route']): string {
  switch (route.name) {
    case 'home':
      return 'My Life With Christ';
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
    case 'settings':
      return 'Settings';
    case 'help':
      return 'Help';
    case 'about':
      return 'About';
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
    case 'passageHistory':
      // Keyed by the reference so moving between two passages remounts rather
      // than reusing an instance whose canonicalisation effect has already run
      // for a different one.
      return (
        <PassageHistoryView key={`history:${route.reference}`} reference={route.reference} />
      );
    case 'topics':
      return <TopicsView />;
    case 'topic':
      return <TopicView topicId={route.topicId} />;
    case 'timeline':
      return <TimelineView />;
    case 'search':
      return <SearchView query={route.query} kinds={route.kinds} />;
    // Keyed by target so React remounts rather than reusing the instance.
    // The editor holds transient state — a primed delete confirmation, a save
    // error — that must never survive a move to a different entry.
    case 'entry':
      // Keyed by `editorSessionKey`, which focus mode reads too: one answer to
      // "which editor is this", so a remount and the end of focus mode cannot
      // disagree about what counts as a different one.
      return <EntryEditor key={editorSessionKey(route)!} entryId={route.id} />;
    case 'newEntry':
      // The kind is part of the key as well as a prop. Without it, moving from
      // `#/entry/new` to `#/entry/new?kind=prayer` would reuse the instance
      // that had already seeded a blank sermon, and the card would open the
      // wrong thing while the URL said otherwise.
      return (
        <EntryEditor
          key={editorSessionKey(route)!}
          draftParam={route.draft}
          anchorParam={route.anchor}
          kindParam={route.kind}
        />
      );
    case 'data':
      return <DataView />;
    case 'import':
      return <ImportView />;
    case 'legacy':
      return <LegacyView />;
    case 'settings':
      return <SettingsView />;
    case 'help':
      return <HelpView />;
    case 'about':
      return <AboutView />;
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
