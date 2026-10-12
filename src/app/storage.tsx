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
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { selectStorageProvider, type StorageKind } from '../platform/storage';
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
  /** Report/clear a post-open read failure without conflating it with empty data. */
  reportReadError: (source: string, message: string | null) => void;
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
  // `requiredStorageKind()` answers `sqlite` on native and `indexeddb` on web,
  // and the seam returns that kind or THROWS. It never quietly hands back a
  // different one. A silent fallback would put months of someone's journal in a
  // store they were never told about, that we cannot hand them, and that the
  // next successful launch would stop reading. See src/platform/storage.ts.
  //
  // Computed as a value rather than through setState-in-render: the outcome is
  // a pure function of the edition, and storing it in state would mean one
  // render where the app believed it had storage that it did not.
  const selection = useMemo(():
    | { provider: StorageProvider; kind: StorageKind | null }
    | { failure: Error } => {
    if (provider) return { provider, kind: null };
    try {
      const selected = selectStorageProvider(requiredStorageKind());
      return { provider: selected.provider, kind: selected.kind };
    } catch (cause) {
      return { failure: cause instanceof Error ? cause : new Error(String(cause)) };
    }
  }, [provider]);

  const storage = 'provider' in selection ? selection.provider : null;
  const kind = 'provider' in selection ? selection.kind : null;
  const [revision, setRevision] = useState(0);
  const [settings, setSettings] = useState<Settings>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
  // A failure to OPEN the journal, as opposed to a failure to select one.
  // Fatal only where the store is the whole product; see the effect below.
  const [openFailure, setOpenFailure] = useState<Error | null>(null);

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
        const failure = cause instanceof Error ? cause : new Error(String(cause));

        // Two different failures, and they deserve different answers.
        //
        // On the web, a blocked IndexedDB (private browsing, blocked site data)
        // is a partial loss: Scripture, topics and the book still work, and a
        // banner that says the journal is unavailable is more useful than a
        // dead app. That is the existing behaviour and it stays.
        //
        // On a native edition the store IS the product, and a SQLite that will
        // not open must fail closed. Carrying on would leave an app that looks
        // ready, accepts an entry, and loses it — while Dexie sits one line
        // away as the tempting repair. Refusing is the answer that cannot
        // quietly become the wrong one.
        if (kind === 'sqlite') {
          setOpenFailure(failure);
          setReady(true);
          return;
        }

        setError(`Your journal could not be opened: ${failure.message}`);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [storage, kind]);

  const touch = useCallback(() => setRevision((value) => value + 1), []);

  const reportReadError = useCallback((source: string, message: string | null) => {
    setReadErrors((current) => {
      if (message === null) {
        if (!(source in current)) return current;
        const next = { ...current };
        delete next[source];
        return next;
      }
      if (current[source] === message) return current;
      return { ...current, [source]: message };
    });
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      if (!storage) return;
      setSettings(await storage.updateSettings(patch));
    },
    [storage],
  );

  const readError = Object.values(readErrors)[0] ?? null;
  const visibleError = error ?? readError;
  const value = useMemo(
    () => ({
      storage: storage as StorageProvider,
      revision,
      touch,
      settings,
      updateSettings,
      ready,
      error: visibleError,
      reportReadError,
    }),
    [storage, revision, touch, settings, updateSettings, ready, visibleError, reportReadError],
  );

  // No provider means no journal, so the journal UI never mounts. Every view
  // below can therefore keep assuming `storage` is real, which is why this is
  // an early return rather than a nullable value threaded through the app.
  if ('failure' in selection) return <StorageUnavailable reason={selection.failure} />;
  // The store was obtained but would not open. On a native edition that is
  // fatal, and nothing below this line may mount — including anything that
  // could accept a keystroke it would be unable to save.
  if (openFailure) return <StorageUnavailable reason={openFailure} />;

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
): { data: T; loading: boolean; error: string | null; complete: boolean } {
  const { storage, revision, ready, reportReadError } = useStorage();
  const source = useId();
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

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
        if (!cancelled) {
          setData(result);
          setQueryError(null);
          setComplete(true);
          reportReadError(source, null);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const detail = cause instanceof Error ? cause.message : String(cause);
        const message = `Your journal could not be read: ${detail}`;
        // Keep the last known value, but mark it incomplete. Callers must never
        // mistake the initial value for a successful empty result.
        setQueryError(message);
        setComplete(false);
        reportReadError(source, message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      reportReadError(source, null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, revision, ready, reportReadError, source, ...deps]);

  return {
    data,
    // Failure is a settled result with `complete: false`, not an endless load.
    // Consumers can show the explicit error while refusing empty-state claims.
    loading,
    error: queryError,
    complete,
  };
}
