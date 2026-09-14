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

import { DexieStorageProvider } from '../storage/db';
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
  const storage = useMemo(() => provider ?? new DexieStorageProvider(), [provider]);
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState<Settings>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
      setSettings(await storage.updateSettings(patch));
    },
    [storage],
  );

  const value = useMemo(
    () => ({ storage, revision, touch, settings, updateSettings, ready, error }),
    [storage, revision, touch, settings, updateSettings, ready, error],
  );

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
