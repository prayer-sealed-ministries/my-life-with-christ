/**
 * Dexie against the persistence contract.
 *
 * The suite itself lives in `conformance.ts` so a second implementation runs
 * the identical assertions. When SQLite arrives in Phase 2 it gets a file just
 * like this one — three lines — and nothing else changes.
 */

import { runStorageConformance } from './conformance';
import { DexieStorageProvider } from './db';

runStorageConformance('DexieStorageProvider', {
  create: (storeId) => new DexieStorageProvider(storeId),
});
