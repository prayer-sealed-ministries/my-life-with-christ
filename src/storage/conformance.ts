/**
 * The persistence contract, run under Vitest.
 *
 * This file is an adapter and nothing else. The contract itself lives in
 * `contract.ts` as plain data, because it has to run in two places that cannot
 * share a test runner: here, against Dexie, and inside a real iOS or Android
 * application, against SQLite. Two hand-maintained copies of "what persistence
 * means" would drift, and the drift would show up as a journal that reads
 * differently on a phone than on a laptop.
 *
 * So: no assertions are written here. If a behaviour is missing, it belongs in
 * `contract.ts`, where both runners get it.
 */

import { describe, expect, it } from 'vitest';

import { CONTRACT_CASES, CONTRACT_CASE_COUNT, contractEnv } from './contract';
import type { StorageProvider } from './StorageProvider';

export interface ConformanceOptions {
  /** An unopened provider backed by the named store. Same name, same data. */
  create: (storeId: string) => StorageProvider;
}

/**
 * Run the persistence contract against one implementation.
 *
 * @param name what to call it in the test output
 */
export function runStorageConformance(name: string, options: ConformanceOptions): void {
  const env = contractEnv(name, options.create);

  describe(`StorageProvider contract — ${name}`, () => {
    // A floor on the adapter itself. Every case below is generated from an
    // array, and an array that came back empty would report a clean, silent
    // pass — the exact failure this repository keeps rediscovering.
    it('has a contract to run', () => {
      expect(CONTRACT_CASE_COUNT).toBeGreaterThanOrEqual(47);
      expect(CONTRACT_CASES).toHaveLength(CONTRACT_CASE_COUNT);
      expect(new Set(CONTRACT_CASES.map((c) => `${c.group}/${c.name}`)).size).toBe(
        CONTRACT_CASE_COUNT,
      );
    });

    const groups = [...new Set(CONTRACT_CASES.map((testCase) => testCase.group))];
    for (const group of groups) {
      describe(group, () => {
        for (const testCase of CONTRACT_CASES.filter((c) => c.group === group)) {
          it(testCase.name, async () => {
            await testCase.run(env);
          });
        }
      });
    }
  });
}
