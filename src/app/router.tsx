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

import { isEntryKind } from '../lib/entry-kinds';
import type { EntryKind } from '../types';

export type Route =
  | { name: 'home' }
  | { name: 'browse' }
  | { name: 'book'; bookId: string }
  | { name: 'passage'; bookId: string; segmentId: string }
  | { name: 'topics' }
  | { name: 'topic'; topicId: string }
  | { name: 'timeline' }
  | { name: 'search'; query: string }
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
    case 'topics':
      return { name: 'topics' };
    case 'topic':
      return parts[1] ? { name: 'topic', topicId: parts[1] } : { name: 'topics' };
    case 'timeline':
      return { name: 'timeline' };
    case 'search':
      return { name: 'search', query: params.get('q') ?? '' };
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
    case 'topics':
      return '#/topics';
    case 'topic':
      return `#/topic/${encodeURIComponent(route.topicId)}`;
    case 'timeline':
      return '#/timeline';
    case 'search':
      return route.query ? `#/search?q=${encodeURIComponent(route.query)}` : '#/search';
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
