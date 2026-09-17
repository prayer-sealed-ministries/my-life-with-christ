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
  | { name: 'newEntry'; anchor?: string }
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
        return anchor ? { name: 'newEntry', anchor } : { name: 'newEntry' };
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
    case 'newEntry':
      return route.anchor ? `#/entry/new?anchor=${encodeURIComponent(route.anchor)}` : '#/entry/new';
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
