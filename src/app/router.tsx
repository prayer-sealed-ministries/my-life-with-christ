/**
 * A hash router, written here rather than pulled in.
 *
 * The project takes no runtime dependencies beyond React, Dexie and Tailwind,
 * and this app's routing needs are small: a handful of static and parameterised
 * paths, no nesting, no loaders. Hash routing specifically, so the app works
 * from a file:// URL or any static host without server rewrite rules.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ENTRY_KINDS, isEntryKind } from '../lib/entry-kinds';
import type { EntryKind } from '../types';

export type Route =
  | { name: 'home' }
  | { name: 'browse' }
  | { name: 'book'; bookId: string }
  | { name: 'passage'; bookId: string; segmentId: string }
  /**
   * A reader's own history with a Scripture passage.
   *
   * The reference travels as the text a person would write — "John 15",
   * "John 15:5", "Jn 15" — and is parsed by the view with the one Scripture
   * parser the rest of the app uses. It is NOT pre-parsed here: `parseHash`
   * runs in the main bundle, and resolving a reference needs versification and
   * the book aliases, which are the lazy chunks this route exists to avoid
   * loading until someone asks for a passage.
   *
   * So the route carries an unvalidated string, exactly as `book` and
   * `passage` carry unvalidated ids, and the view is responsible for refusing
   * what does not resolve. A separate name from `passage` because that route
   * is the Bible text itself; this one is the journal.
   */
  | { name: 'passageHistory'; reference: string }
  | { name: 'topics' }
  | { name: 'topic'; topicId: string }
  | { name: 'timeline' }
  /**
   * A search, and anything narrowing it.
   *
   * `kinds` rides in the URL beside `q` because it is part of what the reader
   * is looking at: open a result, press Back, and the filtered list has to be
   * the thing they come back to. Held in component state instead, it would
   * survive typing and nothing else.
   */
  | { name: 'search'; query: string; kinds?: EntryKind[] }
  | { name: 'entry'; id: string }
  /**
   * A blank entry, optionally opened as a particular kind.
   *
   * `kind` is a request, not a record: it seeds the editor's Kind field and
   * nothing else. The reader can change it before saving, and what reaches
   * storage is whatever the field says at that moment — the parameter is gone
   * by then, because saving navigates to `#/entry/<id>`.
   *
   * A query parameter rather than a path segment, for the same reason `anchor`
   * and `q` are: it is optional, it does not name a resource, and `#/entry/new`
   * has to keep meaning exactly what it has always meant.
   */
  | { name: 'newEntry'; anchor?: string; kind?: EntryKind; draft?: string }
  | { name: 'data' }
  | { name: 'import' }
  | { name: 'legacy' }
  | { name: 'settings' }
  | { name: 'help' }
  | { name: 'about' }
  | { name: 'notFound'; path: string };

/** Parse a location hash into a route. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const params = new URLSearchParams(query);

  if (parts.length === 0) return { name: 'home' };

  switch (parts[0]) {
    case 'browse':
      return { name: 'browse' };
    case 'book':
      return parts[1] ? { name: 'book', bookId: parts[1] } : { name: 'browse' };
    case 'passage':
      return parts[1] && parts[2]
        ? { name: 'passage', bookId: parts[1], segmentId: parts[2] }
        : { name: 'browse' };
    case 'history':
      // Everything after /history/ is the reference, already decoded above.
      // An empty one is not a passage, so it goes where an unknown path goes.
      return parts[1]
        ? { name: 'passageHistory', reference: parts.slice(1).join('/') }
        : { name: 'notFound', path };
    case 'topics':
      return { name: 'topics' };
    case 'topic':
      return parts[1] ? { name: 'topic', topicId: parts[1] } : { name: 'topics' };
    case 'timeline':
      return { name: 'timeline' };
    case 'search': {
      const route: Route = { name: 'search', query: params.get('q') ?? '' };
      // Anything this build does not recognise is dropped, exactly as
      // `?kind=` is for a new entry: a hash is the one input a person can
      // type, and `?kinds=sermon,garbage` must narrow to sermons rather than
      // to a kind no entry can have — which would look identical to "you have
      // written none of those".
      const asked = new Set((params.get('kinds') ?? '').split(',').map((part) => part.trim()));
      // Rebuilt in canonical order, which also removes duplicates: two links
      // selecting the same kinds must be the same link.
      const kinds = ENTRY_KINDS.filter((kind) => asked.has(kind));
      if (kinds.length > 0) route.kinds = [...kinds];
      return route;
    }
    case 'entry':
      if (parts[1] === 'new') {
        const anchor = params.get('anchor');
        const kind = params.get('kind');
        const route: Route = { name: 'newEntry' };
        if (anchor) route.anchor = anchor;
        // Anything this build does not recognise is dropped here rather than
        // carried into the editor. A hash is the one input a person can type,
        // and `?kind=garbage` must open the ordinary blank entry, not a broken
        // one — the route simply does not have a way to express a kind that
        // does not exist.
        if (isEntryKind(kind)) route.kind = kind;
        // Which unfinished piece of work this is. An id rather than a flag,
        // because someone may have two started notes and resuming the wrong one
        // would be worse than not offering to resume at all.
        const draft = params.get('draft');
        if (draft) route.draft = draft;
        return route;
      }
      return parts[1] ? { name: 'entry', id: parts[1] } : { name: 'timeline' };
    case 'data':
      return { name: 'data' };
    case 'import':
      return { name: 'import' };
    case 'legacy':
      return { name: 'legacy' };
    case 'settings':
      return { name: 'settings' };
    case 'help':
      return { name: 'help' };
    case 'about':
      return { name: 'about' };
    default:
      return { name: 'notFound', path };
  }
}

/** Build the hash for a route. The inverse of parseHash. */
export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'browse':
      return '#/browse';
    case 'book':
      return `#/book/${encodeURIComponent(route.bookId)}`;
    case 'passage':
      return `#/passage/${encodeURIComponent(route.bookId)}/${encodeURIComponent(route.segmentId)}`;
    case 'passageHistory':
      return `#/history/${encodeURIComponent(route.reference)}`;
    case 'topics':
      return '#/topics';
    case 'topic':
      return `#/topic/${encodeURIComponent(route.topicId)}`;
    case 'timeline':
      return '#/timeline';
    case 'search': {
      // Built rather than concatenated, for the same reason `newEntry` is:
      // two optional parameters is where a hand-rolled `?a=` + `&b=` gets the
      // first separator wrong.
      const params = new URLSearchParams();
      if (route.query) params.set('q', route.query);
      if (route.kinds?.length) params.set('kinds', route.kinds.join(','));
      const query = params.toString();
      return query ? `#/search?${query}` : '#/search';
    }
    case 'entry':
      return `#/entry/${encodeURIComponent(route.id)}`;
    case 'newEntry': {
      // Built rather than concatenated: two optional parameters is where a
      // hand-rolled `?a=` + `&b=` starts getting the first separator wrong.
      const params = new URLSearchParams();
      if (route.anchor) params.set('anchor', route.anchor);
      if (route.kind) params.set('kind', route.kind);
      if (route.draft) params.set('draft', route.draft);
      const query = params.toString();
      return query ? `#/entry/new?${query}` : '#/entry/new';
    }
    case 'data':
      return '#/data';
    case 'import':
      return '#/import';
    case 'legacy':
      return '#/legacy';
    case 'settings':
      return '#/settings';
    case 'help':
      return '#/help';
    case 'about':
      return '#/about';
    default:
      return '#/';
  }
}

interface RouterValue {
  route: Route;
  navigate: (route: Route, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((route: Route, options?: { replace?: boolean }) => {
    const target = href(route);
    if (options?.replace) window.location.replace(target);
    else window.location.hash = target;

    /*
     * Adopt the new hash now, rather than waiting to be told about it.
     *
     * `hashchange` is dispatched asynchronously, so until it arrives the tree
     * still renders the previous route. For a navigation that is invisible —
     * the page is being left anyway. For a control that reads the route,
     * changes it, and can be used again immediately, it is a lost input: two
     * search filters ticked in quick succession would both compute from the
     * pre-click set, and the second would silently undo the first.
     *
     * Read back from `window.location` rather than trusting `target`, so this
     * holds whatever normalisation the browser applied. The `hashchange` that
     * follows sets the same value and React drops the redundant render.
     */
    setHash(window.location.hash);
  }, []);

  const value = useMemo(() => ({ route: parseHash(hash), navigate }), [hash, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter must be used inside a RouterProvider');
  return value;
}

/**
 * An anchor to a route.
 *
 * A real <a href> on purpose: middle-click, open-in-new-tab, and the browser's
 * own focus and keyboard handling all work without reimplementation.
 */
export function Link({
  to,
  children,
  className,
  ...rest
}: { to: Route; children: ReactNode; className?: string } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
>) {
  return (
    <a href={href(to)} className={className} {...rest}>
      {children}
    </a>
  );
}
