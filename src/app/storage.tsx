/**
 * The storage seam, wired into React.
 *
 * Everything the UI does to entries goes through the StorageProvider interface,
 * never Dexie directly, so v2 can swap the implementation without touching a
 * view. `revision` bumps on every write; views depending on entry data re-read
 * when it changes. Crude compared to a query cache, and entirely adequate for a
 * single-user local database.
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

import { selectStorageProvider } from '../platform/storage';
import { requiredStorageKind } from '../platform/runtime';
import { StorageUnavailable } from './StorageUnavailable';
import type { StorageProvider } from '../storage/StorageProvider';
import type { Settings } from '../types';

interface StorageValue {
  storage: StorageProvider;
  /** Increments after every write. Depend on it to re-read. */
  revision: number;
  /** Call after any write so dependent views refresh. */
  touch: () => void;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  ready: boolean;
  error: string | null;
}

const StorageContext = createContext<StorageValue | null>(null);

export function StorageContextProvider({
  children,
  provider,
}: {
  children: ReactNode;
  provider?: StorageProvider;
}) {
  // Obtained through the platform seam rather than constructed here.
  //
  // Today that seam returns Dexie and nothing else can happen. It exists for
  // what comes next: a native edition requires SQLite, and if SQLite cannot be
  // opened the selection THROWS rather than quietly handing back IndexedDB. A
  // silent fallback would put months of someone's journal in a store they were
  // never told about, that we cannot hand them, and that the next successful
  // launch would stop reading. See src/platform/storage.ts.
  //
  // `requiredStorageKind()` answers `sqlite` on native and `indexeddb` on web.
  // In Phase 1 no SQLite provider is registered, so a native build throws here
  // and the shell shows the blocked state below — which is the intended
  // outcome, not a defect to work around.
  //
  // `requiredStorageKind()` answers `sqlite` on native and `indexeddb` on web.
  // In Phase 1 no SQLite provider is registered, so a native build cannot obtain
  // one and this resolves to a failure rather than to a provider. That is the
  // intended outcome, not a defect: a native shell showing a working journal
  // backed by webview IndexedDB would be demonstrating something we are
  // deliberately not building.
  //
  // Computed as a value rather than through setState-in-render: the outcome is
  // a pure function of the edition, and storing it in state would mean one
  // render where the app believed it had storage that it did not.
  const selection = useMemo((): { provider: StorageProvider } | { failure: Error } => {
    if (provider) return { provider };
    try {
      return { provider: selectStorageProvider(requiredStorageKind()).provider };
    } catch (cause) {
      return { failure: cause instanceof Error ? cause : new Error(String(cause)) };
    }
  }, [provider]);

  const storage = 'provider' in selection ? selection.provider : null;
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState<Settings>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!storage) return;
    let cancelled = false;
    storage
      .open()
      .then(() => storage.getSettings())
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        setReady(true);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Private browsing and blocked site data both land here. Say so plainly
        // rather than presenting an empty journal as if it were the real one.
        setError(
          cause instanceof Error
            ? `Your journal could not be opened: ${cause.message}`
            : 'Your journal could not be opened.',
        );
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storage]);

  const touch = useCallback(() => setRevision((value) => value + 1), []);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      if (!storage) return;
      setSettings(await storage.updateSettings(patch));
    },
    [storage],
  );

  const value = useMemo(
    () => ({ storage: storage as StorageProvider, revision, touch, settings, updateSettings, ready, error }),
    [storage, revision, touch, settings, updateSettings, ready, error],
  );

  // No provider means no journal, so the journal UI never mounts. Every view
  // below can therefore keep assuming `storage` is real, which is why this is
  // an early return rather than a nullable value threaded through the app.
  if ('failure' in selection) return <StorageUnavailable reason={selection.failure} />;

  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>;
}

export function useStorage(): StorageValue {
  const value = useContext(StorageContext);
  if (!value) throw new Error('useStorage must be used inside a StorageContextProvider');
  return value;
}

/** Read something from storage, re-reading whenever an entry is written. */
export function useStorageQuery<T>(
  read: (storage: StorageProvider) => Promise<T>,
  deps: unknown[],
  initial: T,
): { data: T; loading: boolean } {
  const { storage, revision, ready } = useStorage();
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    // Flip to loading asynchronously: setting state synchronously inside an
    // effect makes React re-render before paint, cascading on every dependency
    // change. The read below is async anyway, so nothing is lost by waiting.
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    read(storage)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        // A failed read leaves the previous value in place; the error surfaced
        // at open time already told the user storage is unavailable.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, revision, ready, ...deps]);

  return { data, loading };
}
