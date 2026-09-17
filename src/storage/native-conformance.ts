/**
 * The persistence contract, run inside a real native application.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Dexie's conformance run happens under Vitest on a laptop. The SQLite one
 * cannot: the provider only exists when there is a Capacitor bridge, a native
 * plugin, and a real filesystem under an app sandbox. Node's SQLite is a
 * different engine reached a different way, and passing there says nothing
 * about the plugin, the database location, or whether an iOS app can reopen
 * what it wrote. So the identical `CONTRACT_CASES` array is executed here,
 * inside the app, against the real thing.
 *
 * THIS MODULE MUST NOT REACH A STORE BUILD
 *
 * It is imported only behind `import.meta.env.VITE_NATIVE_CONFORMANCE`, which
 * Vite substitutes at build time. In a production build that expression is
 * `undefined`, the branch is dead, and the chunk is never emitted — a policy
 * test asserts the marker string below is absent from the packaged assets.
 *
 * IT MUST NEVER TOUCH A REAL JOURNAL
 *
 * Every store it opens is named from a throwaway prefix, and `guardStoreName`
 * throws rather than letting anything near the production database name. The
 * harness deletes what it created when it finishes. A test harness that wiped
 * someone's journal while proving the journal works would be an unusually
 * cruel bug, so the guard is a hard failure rather than a convention.
 */

import { Capacitor } from '@capacitor/core';

import { CONTRACT_CASES, CONTRACT_CASE_COUNT, type ContractEnv } from './contract';
import { DATABASE_NAME, SCHEMA_VERSION, SqliteStorageProvider } from './sqlite';
import type { StorageProvider } from './StorageProvider';

/** Grepped from device logs, and asserted absent from production bundles. */
export const NATIVE_CONTRACT_MARKER = 'NATIVE_CONTRACT_RESULT';

/** Everything this harness creates starts with this. Nothing else may. */
const TEST_PREFIX = 'contract-test-';

function guardStoreName(storeId: string): string {
  if (storeId === DATABASE_NAME || !storeId.startsWith(TEST_PREFIX)) {
    throw new Error(
      `The native contract harness refused to open "${storeId}". ` +
        `It may only touch stores beginning with "${TEST_PREFIX}", never the real journal.`,
    );
  }
  return storeId;
}

interface CaseResult {
  group: string;
  name: string;
  ok: boolean;
  error?: string;
}

export interface NativeContractResult {
  marker: string;
  platform: string;
  native: boolean;
  pluginAvailable: boolean;
  providerClass: string;
  engine: string;
  sqliteVersion: string | null;
  databaseUrl: string | null;
  databaseName: string;
  schemaVersion: number | null;
  expectedCases: number;
  ranCases: number;
  passed: number;
  failed: number;
  reopenProved: boolean;
  failures: CaseResult[];
  floors: string[];
  ok: boolean;
}

/**
 * Run the contract and report a single machine-readable line.
 *
 * Never throws: a harness that died silently would be indistinguishable from a
 * harness that was never wired in, so failure is reported as data.
 */
export async function runNativeContract(): Promise<NativeContractResult> {
  const created = new Set<string>();
  const floors: string[] = [];

  const create = (storeId: string): StorageProvider => {
    created.add(guardStoreName(storeId));
    return new SqliteStorageProvider(storeId);
  };

  let counter = 0;
  const env: ContractEnv = {
    create,
    newStoreId: () => `${TEST_PREFIX}${Date.now().toString(36)}-${(counter += 1)}`,
    fresh: async () => {
      const provider = create(env.newStoreId());
      await provider.open();
      return provider;
    },
  };

  const result: NativeContractResult = {
    marker: NATIVE_CONTRACT_MARKER,
    platform: Capacitor.getPlatform(),
    native: Capacitor.isNativePlatform(),
    pluginAvailable: Capacitor.isPluginAvailable('CapacitorSQLite'),
    providerClass: '',
    engine: '',
    sqliteVersion: null,
    databaseUrl: null,
    databaseName: DATABASE_NAME,
    schemaVersion: null,
    expectedCases: CONTRACT_CASE_COUNT,
    ranCases: 0,
    passed: 0,
    failed: 0,
    reopenProved: false,
    failures: [],
    floors: [],
    ok: false,
  };

  try {
    // ---------------------------------------------------------------------
    // Floors, before any case runs.
    //
    // Each one exists because the corresponding mistake would otherwise report
    // a clean pass: a harness run on the web, a harness that quietly used
    // Dexie, or a harness whose case list came back empty.
    // ---------------------------------------------------------------------
    if (!result.native) floors.push('not running on a native platform');
    if (result.platform !== 'ios' && result.platform !== 'android') {
      floors.push(`unexpected platform "${result.platform}"`);
    }
    if (!result.pluginAvailable) floors.push('the CapacitorSQLite plugin is not available');
    if (CONTRACT_CASE_COUNT < 47) floors.push(`only ${CONTRACT_CASE_COUNT} contract cases exist`);

    const probeStore = env.newStoreId();
    const probe = new SqliteStorageProvider(guardStoreName(probeStore));
    created.add(probeStore);
    await probe.open();

    // `constructor.name` is reported for information only — a production build
    // mangles it to something like "er", so it can identify nothing. The engine
    // tag is the assertion: it is an ordinary property, the minifier leaves it
    // alone, and a Dexie provider would answer "indexeddb" here.
    result.providerClass = probe.constructor.name;
    result.engine = probe.engine;
    if (result.engine !== 'sqlite') {
      floors.push(`the provider under test reports engine "${result.engine}", not sqlite`);
    }

    result.schemaVersion = await probe.schemaVersion();
    if (result.schemaVersion !== SCHEMA_VERSION) {
      floors.push(`schema version ${result.schemaVersion}, expected ${SCHEMA_VERSION}`);
    }

    // Ask the engine what it is. A provider could in principle be backed by
    // anything; SQLite answering its own version is the direct evidence.
    result.sqliteVersion = await probe.sqliteVersion();
    // Reported so the ADR can record where the file really lives rather than
    // repeating what the plugin's documentation claims.
    result.databaseUrl = await probe.databaseUrl();
    if (!result.sqliteVersion) floors.push('the store did not identify itself as SQLite');

    // -----------------------------------------------------------------------
    // A real close and reopen, of a real file.
    //
    // The contract has its own durability case, but it opens a second provider
    // over the same store while the first is still alive. This closes the
    // connection completely first, which is the nearest an in-process harness
    // gets to the app being killed.
    // -----------------------------------------------------------------------
    const durableStore = env.newStoreId();
    created.add(durableStore);
    const before = new SqliteStorageProvider(guardStoreName(durableStore));
    await before.open();
    const written = await before.createEntry({
      title: 'Reopen proof',
      notes: 'Written before the connection was closed.',
    });
    await before.close();

    const after = new SqliteStorageProvider(durableStore);
    await after.open();
    const readBack = await after.getEntry(written.id);
    result.reopenProved =
      readBack?.notes === 'Written before the connection was closed.' &&
      (await after.schemaVersion()) === SCHEMA_VERSION;
    await after.close();
    if (!result.reopenProved) floors.push('a closed-and-reopened database did not return its data');

    // -----------------------------------------------------------------------
    // The contract itself.
    // -----------------------------------------------------------------------
    for (const testCase of CONTRACT_CASES) {
      result.ranCases += 1;
      try {
        await testCase.run(env);
        result.passed += 1;
      } catch (error) {
        result.failed += 1;
        result.failures.push({
          group: testCase.group,
          name: testCase.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (result.ranCases !== CONTRACT_CASE_COUNT) {
      floors.push(`ran ${result.ranCases} cases, expected ${CONTRACT_CASE_COUNT}`);
    }
    await probe.close();
  } catch (error) {
    floors.push(`the harness itself failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Clean up after ourselves. Best effort: a leftover test database is untidy,
  // not dangerous, and must never turn a real pass into a reported failure.
  for (const storeId of created) {
    try {
      await new SqliteStorageProvider(storeId).deleteStore();
    } catch {
      /* ignore */
    }
  }

  result.floors = floors;
  result.ok = floors.length === 0 && result.failed === 0 && result.ranCases === CONTRACT_CASE_COUNT;

  console.log(`${NATIVE_CONTRACT_MARKER} ${JSON.stringify(result)}`);
  return result;
}
