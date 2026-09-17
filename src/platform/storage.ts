/**
 * Where the application gets its journal database.
 *
 * Today there is one answer and it is Dexie. This module exists anyway, because
 * of what the second answer will be and what must never happen when it fails.
 *
 * THE FAIL-CLOSED RULE
 *
 * A native edition will store the journal in SQLite (see
 * `docs/ADR-NATIVE-APP-ARCHITECTURE.md`). If that native store cannot be opened
 * — a plugin missing, a permission refused, a corrupt file — the tempting
 * behaviour is to fall back to the webview's IndexedDB so the app still starts.
 *
 * That must never happen, and the reason is worth stating plainly rather than
 * leaving to judgement:
 *
 *   A paid user would write months of journal entries into a store they were
 *   never told about, which we cannot hand to them, which does not appear in
 *   their archive, and which the next successful launch would silently stop
 *   reading. They would lose the record and we would have reported success the
 *   whole time.
 *
 * An app that will not start is a bug report. An app that quietly writes to the
 * wrong place is a lost inheritance. So selection fails closed: if the edition's
 * required provider cannot be obtained, `selectStorageProvider` throws and the
 * shell shows the failure. It does not substitute.
 *
 * The policy is encoded here, now, while there is only one provider — because
 * the moment there are two is the moment somebody adds the fallback in a hurry.
 */

import { DexieStorageProvider } from '../storage/db';
import { SqliteStorageProvider } from '../storage/sqlite';
import type { StorageProvider } from '../storage/StorageProvider';

/**
 * Which persistence an edition requires.
 *
 * Not a platform flag — this says what the build needs, not what device it is
 * on. A view never reads it; only the composition root does.
 */
export type StorageKind = 'indexeddb' | 'sqlite';

export interface StorageSelection {
  kind: StorageKind;
  provider: StorageProvider;
}

/**
 * Raised when the required store cannot be opened.
 *
 * A distinct type so the shell can say "your journal could not be opened"
 * rather than showing a generic failure — and so nothing can catch it by
 * accident and carry on with a different provider.
 */
export class StorageUnavailableError extends Error {
  readonly kind: StorageKind;

  constructor(kind: StorageKind, detail: string) {
    super(
      `The journal could not be opened on this device (${kind}). ${detail} ` +
        'Nothing has been written. Your exported archives are unaffected.',
    );
    this.name = 'StorageUnavailableError';
    this.kind = kind;
  }
}

/**
 * How a provider of a given kind is built.
 *
 * Injectable so tests can assert the fail-closed rule without a native plugin,
 * and so Phase 2 registers SQLite here rather than editing call sites.
 */
export type ProviderFactories = Partial<Record<StorageKind, () => StorageProvider>>;

const defaultFactories: ProviderFactories = {
  indexeddb: () => new DexieStorageProvider(),
  // Registered in Phase 2. Constructing one is cheap and does nothing: the
  // Capacitor plugin is imported lazily inside `open()`, so the native bridge
  // never enters the web bundle even though the factory is declared here.
  //
  // The web edition still asks for `indexeddb` and gets Dexie. Registering
  // SQLite does NOT make it reachable from the web — `requiredStorageKind()`
  // decides, and it answers by edition, not by what happens to be available.
  sqlite: () => new SqliteStorageProvider(),
};

/**
 * Obtain the journal database for this edition.
 *
 * @param required the storage this edition is built to use
 * @param factories how to build each kind; defaults to the web set
 *
 * @throws StorageUnavailableError when the required kind cannot be built. It
 *   never returns a different kind than the one asked for.
 */
export function selectStorageProvider(
  required: StorageKind = 'indexeddb',
  factories: ProviderFactories = defaultFactories,
): StorageSelection {
  const build = factories[required];

  if (!build) {
    throw new StorageUnavailableError(
      required,
      'This build has no implementation for that storage.',
    );
  }

  let provider: StorageProvider;
  try {
    provider = build();
  } catch (cause) {
    throw new StorageUnavailableError(
      required,
      cause instanceof Error ? cause.message : 'The store could not be created.',
    );
  }

  // Deliberately no `catch` that reaches for another kind. See the rule above.
  return { kind: required, provider };
}
