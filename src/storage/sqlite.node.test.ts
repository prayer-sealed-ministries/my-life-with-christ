// @vitest-environment node
/**
 * The SQLite provider's SQL, against a real SQLite engine.
 *
 * WHAT THIS PROVES, AND WHAT IT EXPLICITLY DOES NOT
 *
 * It proves the SQL is valid SQL and that the schema, the transactions and the
 * statements satisfy the persistence contract when a real SQLite executes them.
 * That is worth having: a typo in a CREATE TABLE or a mis-ordered transaction
 * should fail here in a second, not twenty minutes later on a simulator.
 *
 * It is **not** evidence that the native provider works. Node's SQLite is a
 * different engine reached through a different bridge, in a different process,
 * writing to a different filesystem. The plugin, the connection lifecycle, the
 * database location, the iOS sandbox and the Android app-data directory are all
 * untested here, and those are exactly the parts most likely to be wrong.
 *
 * The native proof is the on-device conformance run, which executes the SAME
 * `CONTRACT_CASES` inside the real application against `@capacitor-community/sqlite`.
 * This file is a fast check on the way there, and the ADR reports the two
 * separately for that reason.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { CONTRACT_CASES, CONTRACT_CASE_COUNT, contractEnv } from './contract';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  SchemaTooNewError,
  SqliteStorageProvider,
  type Migration,
} from './sqlite';

const root = mkdtempSync(join(tmpdir(), 'journey-sqlite-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/**
 * A stand-in for the Capacitor plugin, backed by node:sqlite.
 *
 * Deliberately faithful to the bridge's shape rather than convenient: databases
 * are files on disk, so reopening the same store really does reopen the same
 * bytes — an in-memory map would make the durability case pass while proving
 * nothing.
 */
function nodeSqlitePlugin() {
  const open = new Map<string, DatabaseSync>();
  const known = new Set<string>();
  const fileFor = (database: string) => join(root, `${database}.sqlite`);

  const db = (database: string): DatabaseSync => {
    const handle = open.get(database);
    if (!handle) throw new Error(`database ${database} is not open`);
    return handle;
  };

  // The bridge cannot carry `undefined`; the real plugin marshals through JSON.
  const bind = (values: unknown[] = []) =>
    values.map((value) => (value === undefined ? null : value)) as never[];

  return {
    async createConnection({ database }: { database: string }) {
      known.add(database);
    },
    async closeConnection({ database }: { database: string }) {
      known.delete(database);
    },
    async isConnection({ database }: { database: string }) {
      return { result: known.has(database) };
    },
    async open({ database }: { database: string }) {
      if (!open.has(database)) open.set(database, new DatabaseSync(fileFor(database)));
    },
    async close({ database }: { database: string }) {
      open.get(database)?.close();
      open.delete(database);
    },
    async isDBOpen({ database }: { database: string }) {
      return { result: open.has(database) };
    },
    async execute({ database, statements }: { database: string; statements: string }) {
      db(database).exec(statements);
      return {};
    },
    async run({
      database,
      statement,
      values,
    }: {
      database: string;
      statement: string;
      values?: unknown[];
    }) {
      db(database).prepare(statement).run(...bind(values));
      return {};
    },
    async query({
      database,
      statement,
      values,
    }: {
      database: string;
      statement: string;
      values?: unknown[];
    }) {
      return { values: db(database).prepare(statement).all(...bind(values)) };
    },
    async beginTransaction({ database }: { database: string }) {
      db(database).exec('BEGIN');
      return {};
    },
    async commitTransaction({ database }: { database: string }) {
      db(database).exec('COMMIT');
      return {};
    },
    async rollbackTransaction({ database }: { database: string }) {
      db(database).exec('ROLLBACK');
      return {};
    },
  };
}

const plugin = nodeSqlitePlugin();
const loadPlugin = async () => plugin as never;

const createProvider = (storeId: string) =>
  new SqliteStorageProvider(storeId, { loadPlugin });

describe('SqliteStorageProvider — SQL against a real SQLite engine (not a native proof)', () => {
  const env = contractEnv('sqlite-node', createProvider);

  it('has a contract to run', () => {
    expect(CONTRACT_CASE_COUNT).toBeGreaterThanOrEqual(57);
    expect(CONTRACT_CASES).toHaveLength(CONTRACT_CASE_COUNT);
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

describe('the schema and its migrations', () => {
  const fresh = (name: string) => new SqliteStorageProvider(name, { loadPlugin });

  it('creates the current schema on a fresh database', async () => {
    const provider = fresh('schema-fresh');
    await provider.open();
    expect(await provider.schemaVersion()).toBe(SCHEMA_VERSION);
  });

  it('creates the tables the provider actually reads', async () => {
    const provider = fresh('schema-tables');
    await provider.open();

    const names = plugin
      .query({
        database: 'schema-tables',
        statement: `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;`,
      })
      .then((result) => (result.values as { name: string }[]).map((row) => row.name));

    expect(await names).toEqual(
      expect.arrayContaining(['drafts', 'entries', 'entry_anchor_keys', 'schema_meta', 'settings']),
    );
  });

  /**
   * The upgrade, run on a database that already holds someone's journal.
   *
   * A migration proven only on a fresh database is not proven at all: the
   * thing that can go wrong is doing it to a file with years of entries in it.
   * So this stands a real v1 database up — the v1 ledger, nothing more — writes
   * an entry through it, and then opens the same file with the current build.
   */
  it('upgrades a v1 journal to v2 without disturbing it', async () => {
    const V1_ONLY = MIGRATIONS.filter((migration) => migration.to <= 1);
    expect(V1_ONLY, 'the v1 ledger should exist to migrate from').toHaveLength(1);

    const before = new SqliteStorageProvider('schema-v1-upgrade', {
      loadPlugin,
      migrations: V1_ONLY,
    });
    await before.open();
    expect(await before.schemaVersion()).toBe(1);
    const written = await before.createEntry({ title: 'Written under v1', notes: 'Years of this.' });
    await before.updateSettings({ lastExportAt: '2026-01-01T00:00:00.000Z' });
    await before.close();

    // The same file, opened by this build.
    const after = new SqliteStorageProvider('schema-v1-upgrade', { loadPlugin });
    await after.open();

    expect(await after.schemaVersion()).toBe(SCHEMA_VERSION);
    const entries = await after.listEntries();
    expect(entries, 'the journal survived the upgrade').toHaveLength(1);
    expect(entries[0].id).toBe(written.id);
    expect(entries[0].notes).toBe('Years of this.');
    expect((await after.getSettings()).lastExportAt).toBe('2026-01-01T00:00:00.000Z');

    // And the new table is usable, which is the point of the step.
    await after.putDraft({
      id: 'd-after-upgrade',
      form: {
        kind: 'sermon',
        title: '',
        date: '2026-03-01',
        place: '',
        speaker: '',
        sermonSeries: '',
        notes: 'Typed after the upgrade.',
        reflection: '',
        prayer: '',
        tagsText: '',
        links: [],
        anchors: [],
        forDescendants: false,
        scriptureRefs: [],
        sourceMaterial: null,
      },
      createdAt: '2026-03-01T09:00:00.000Z',
      updatedAt: '2026-03-01T09:00:00.000Z',
    });
    expect((await after.getDraft('d-after-upgrade'))?.form.notes).toBe('Typed after the upgrade.');
  });

  it('reopening an existing database does not re-run the migration', async () => {
    const first = fresh('schema-reopen');
    await first.open();
    await first.createEntry({ notes: 'Still here.' });
    await first.close();

    const second = fresh('schema-reopen');
    await second.open();
    expect(await second.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(await second.listEntries()).toHaveLength(1);
  });

  it('refuses a database written by a newer version, without touching it', async () => {
    const provider = fresh('schema-too-new');
    await provider.open();
    await provider.createEntry({ notes: 'Written by a future version.' });
    await provider.close();

    // Claim a version this build does not understand.
    await plugin.open({ database: 'schema-too-new' });
    await plugin.run({
      database: 'schema-too-new',
      statement: `UPDATE schema_meta SET version = ? WHERE id = 1;`,
      values: [SCHEMA_VERSION + 5],
    });
    await plugin.close({ database: 'schema-too-new' });

    const reopened = fresh('schema-too-new');
    await expect(reopened.open()).rejects.toBeInstanceOf(SchemaTooNewError);

    // And the journal is intact: refusing must not be destructive.
    await plugin.open({ database: 'schema-too-new' });
    const rows = await plugin.query({
      database: 'schema-too-new',
      statement: `SELECT count(*) AS n FROM entries;`,
    });
    expect((rows.values as { n: number }[])[0].n).toBe(1);
    await plugin.close({ database: 'schema-too-new' });
  });
});

describe('destructive operations are transactional', () => {
  it('rolls a failed bulk write back entirely, leaving the journal as it was', async () => {
    const provider = new SqliteStorageProvider('bulk-rollback', { loadPlugin });
    await provider.open();
    await provider.createEntry({ title: 'Already here' });

    const good = {
      id: 'good-1',
      kind: 'sermon' as const,
      title: 'Good',
      date: '2025-01-01',
      anchors: [],
      scriptureRefs: [],
      notes: '',
      reflection: '',
      links: [],
      tags: [],
      forDescendants: false,
      visibility: 'private' as const,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    // A circular object cannot be serialised: the failure lands mid-batch, after
    // the first entry has already been written inside the transaction.
    const poison = { ...good, id: 'poison' } as Record<string, unknown>;
    poison.self = poison;

    await expect(
      provider.putEntries([good, poison] as never),
    ).rejects.toThrow();

    // The good entry from the failed batch must be gone, and the pre-existing
    // entry untouched. A half-written import is the failure this guards.
    expect(await provider.getEntry('good-1')).toBeUndefined();
    expect(await provider.listEntries()).toHaveLength(1);
  });

  it('deleting an entry takes its anchor index rows with it', async () => {
    const provider = new SqliteStorageProvider('cascade', { loadPlugin });
    await provider.open();
    await provider.putEntries([
      {
        id: 'anchored',
        kind: 'sermon',
        title: 'Anchored',
        date: '2025-01-01',
        anchors: [{ kind: 'topic', topicId: 'grief' }],
        scriptureRefs: [],
        notes: '',
        reflection: '',
        links: [],
        tags: [],
        forDescendants: false,
        visibility: 'private',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ]);

    expect(await provider.findEntriesForExactAnchor({ kind: 'topic', topicId: 'grief' })).toHaveLength(1);
    await provider.deleteEntry('anchored');

    const orphans = await plugin.query({
      database: 'cascade',
      statement: `SELECT count(*) AS n FROM entry_anchor_keys;`,
    });
    expect((orphans.values as { n: number }[])[0].n, 'anchor rows outlived their entry').toBe(0);
    expect(await provider.findEntriesForExactAnchor({ kind: 'topic', topicId: 'grief' })).toEqual([]);
  });

  it('clearing entries leaves the settings table alone', async () => {
    const provider = new SqliteStorageProvider('clear-settings', { loadPlugin });
    await provider.open();
    await provider.updateSettings({ lastExportAt: '2026-01-01T00:00:00.000Z' });
    await provider.createEntry({ title: 'Doomed' });

    await provider.clearEntries();

    expect(await provider.listEntries()).toEqual([]);
    expect((await provider.getSettings()).lastExportAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('the migration machinery, proven on a ledger with two steps', () => {
  // Version 1 is the first native schema, so "a fresh database reaches v1" is
  // the only thing the real ledger can demonstrate — and it is the one case
  // that says nothing about upgrading an existing journal. These run the same
  // runner over a synthetic ledger, which is what makes v1 -> v2 -> v3 real
  // rather than promised.
  const V1: Migration = {
    to: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL);`,
      `CREATE TABLE IF NOT EXISTS kept (id TEXT PRIMARY KEY NOT NULL, note TEXT NOT NULL);`,
    ],
  };
  const V2: Migration = {
    to: 2,
    statements: [`ALTER TABLE kept ADD COLUMN added_in_v2 TEXT;`],
  };
  const V2_BROKEN: Migration = {
    to: 2,
    statements: [
      `ALTER TABLE kept ADD COLUMN added_before_the_failure TEXT;`,
      `THIS IS NOT SQL;`,
    ],
  };

  const at = (name: string, migrations: Migration[]) =>
    new SqliteStorageProvider(name, { loadPlugin, migrations });

  const versionOf = async (name: string) => {
    const rows = await plugin.query({ database: name, statement: `SELECT version FROM schema_meta WHERE id = 1;` });
    return (rows.values as { version: number }[])[0]?.version;
  };
  const columnsOf = async (name: string) => {
    const rows = await plugin.query({ database: name, statement: `PRAGMA table_info(kept);` });
    return (rows.values as { name: string }[]).map((r) => r.name);
  };

  it('C. upgrades an existing older database in order, keeping its data', async () => {
    const name = 'migrate-upgrade';
    const v1 = at(name, [V1]);
    await v1.open();
    await plugin.run({ database: name, statement: `INSERT INTO kept (id, note) VALUES (?, ?);`, values: ['k1', 'written under v1'] });
    expect(await versionOf(name)).toBe(1);
    await v1.close();

    // The same database, opened by a build that knows one more step.
    const v2 = at(name, [V1, V2]);
    await v2.open();

    expect(await versionOf(name), 'the version advanced').toBe(2);
    expect(await columnsOf(name), 'the v2 column was added').toContain('added_in_v2');

    const rows = await plugin.query({ database: name, statement: `SELECT note FROM kept WHERE id = 'k1';` });
    expect((rows.values as { note: string }[])[0].note, 'v1 data survived the upgrade').toBe('written under v1');
    await v2.close();
  });

  it('D. a failed migration leaves the OLD version authoritative and changes nothing', async () => {
    const name = 'migrate-failure';
    const v1 = at(name, [V1]);
    await v1.open();
    await plugin.run({ database: name, statement: `INSERT INTO kept (id, note) VALUES (?, ?);`, values: ['k1', 'must survive'] });
    await v1.close();

    const broken = at(name, [V1, V2_BROKEN]);
    await expect(broken.open(), 'a broken migration must not resolve').rejects.toThrow();

    // The whole point: no false advancement, and no half-applied step.
    expect(await versionOf(name), 'the version must not advance past a failed step').toBe(1);
    expect(
      await columnsOf(name),
      'the column added before the failure must have been rolled back',
    ).not.toContain('added_before_the_failure');

    const rows = await plugin.query({ database: name, statement: `SELECT note FROM kept WHERE id = 'k1';` });
    expect((rows.values as { note: string }[])[0].note, 'journal data survived a failed migration').toBe('must survive');
  });

  it('E. refuses a database whose version is beyond what the ledger understands', async () => {
    const name = 'migrate-too-new';
    const ahead = at(name, [V1, V2]);
    await ahead.open();
    expect(await versionOf(name)).toBe(2);
    await ahead.close();

    // A build that only knows v1 meets a v2 file.
    const older = at(name, [V1]);
    await expect(older.open()).rejects.toBeInstanceOf(SchemaTooNewError);
  });

  it('A/B. a fresh database reaches the real schema version, and reopening does not re-migrate', async () => {
    const name = 'migrate-fresh';
    const first = new SqliteStorageProvider(name, { loadPlugin });
    await first.open();
    expect(await first.schemaVersion()).toBe(SCHEMA_VERSION);
    await first.createEntry({ notes: 'kept across reopen' });
    await first.close();

    const second = new SqliteStorageProvider(name, { loadPlugin });
    await second.open();
    expect(await second.schemaVersion()).toBe(SCHEMA_VERSION);
    expect(await second.listEntries()).toHaveLength(1);
    await second.close();
  });
});
