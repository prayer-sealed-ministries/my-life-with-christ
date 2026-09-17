/**
 * Native persistence, in SQLite.
 *
 * The journal on a phone is not a cache. It is the working copy of something a
 * person intends to hand to their grandchildren, so it lives in a file we chose,
 * at a path we chose, with transactional durability we can test — rather than in
 * a webview store the platform owns and may reclaim. See
 * `docs/ADR-NATIVE-APP-ARCHITECTURE.md`.
 *
 * WHAT THIS FILE IS NOT ALLOWED TO DECIDE
 *
 * Nothing about what the answers mean. Defaulting, ordering, the tie-break, the
 * query predicate and the derived anchor keys all come from `semantics.ts`,
 * shared with Dexie. This file decides only how rows reach a disk. That is the
 * mechanism that stops the two editions from disagreeing about the order of two
 * sermons written on the same Sunday.
 *
 * THE PLUGIN IS IMPORTED LAZILY, AND THAT IS DELIBERATE
 *
 * `@capacitor-community/sqlite` is imported inside `open()`, not at module load.
 * The web build reaches this module through the provider factory but never opens
 * it, so the native bridge never enters the web runtime. A static import would
 * put it in the main web bundle for no one's benefit.
 *
 * NO ENCRYPTION. The connection is opened `no-encryption` on purpose: the plugin
 * can do SQLCipher, and turning that on would mean owning a key, which means
 * owning Keychain/Keystore, which is a product decision this phase has not made.
 * The journal is protected by the OS sandbox and device encryption, and the app
 * must not claim more than that.
 */

import type { Entry, NewEntry, Settings } from '../types';
import {
  PLACES,
  SPEAKERS,
  TAGS,
  anchorKeys,
  anchorLookupKey,
  applyPatch,
  byDateDescending,
  chronologically,
  distinctValues,
  entryToCreate,
  indexed,
  matches,
} from './semantics';
import type { AnchorLookup, EntryQuery, StorageProvider } from './StorageProvider';

/**
 * The logical database name.
 *
 * Boring and brand-independent on purpose: it is a machine identifier, it is
 * written into a file path on someone's phone, and renaming it later would
 * orphan every existing journal for a cosmetic gain. It carries no version
 * number — the schema version lives inside the file, where a migration can read
 * it. See the naming table in CLAUDE.md.
 *
 * The plugin appends its own suffix when it creates the file; the actual
 * on-disk name is recorded in the ADR from an observed device rather than
 * guessed here.
 */
export const DATABASE_NAME = 'journey';

/** What this build of the app understands. */
export const SCHEMA_VERSION = 1;

const SETTINGS_KEY = 'singleton';

/**
 * Raised when the file was written by a newer version of the app.
 *
 * Opening it read-write would mean writing a schema we do not understand, and
 * the likeliest outcome is a journal that the newer version can no longer read.
 * Refusing is the conservative answer: the data is intact and the person is told
 * to update rather than silently losing fields.
 */
export class SchemaTooNewError extends Error {
  constructor(found: number, understood: number) {
    super(
      `This journal was written by a newer version of Life With Christ ` +
        `(database version ${found}; this app understands ${understood}). ` +
        `Nothing has been changed. Update the app to open it.`,
    );
    this.name = 'SchemaTooNewError';
  }
}

/**
 * One step of schema evolution.
 *
 * `to` is the version the database is at once every statement has run. The
 * runner applies steps in ascending order inside a transaction and records the
 * new version in the same transaction, so a failure leaves the old version
 * authoritative rather than claiming an upgrade that did not happen.
 */
export interface Migration {
  to: number;
  statements: string[];
}

/**
 * The schema, as an ordered ledger rather than a single CREATE script.
 *
 * Version 1 is the first native schema and there is nothing to migrate from,
 * but the machinery is real and exercised: a fresh install runs this exactly as
 * a v1 -> v2 upgrade would run later. Building the ledger after users exist is
 * how journals get lost.
 *
 * `data` holds the canonical `Entry` JSON and is the authority on read. The
 * columns beside it are derived on write, for ordering, identity and so a human
 * with a SQLite browser can see what is in the file. They are never read back
 * into an entry, so they cannot drift into being a second source of truth.
 *
 * The entry is stored as JSON rather than spread across columns because the
 * domain object is the export format: it carries optional fields, nested anchors
 * and links, and `_unmigrated` — fields written by a FUTURE version that this
 * build must preserve verbatim without knowing their names. A column-per-field
 * schema cannot round-trip a field it has no column for, and dropping those
 * fields would silently damage a journal on its way through this version.
 */
const MIGRATIONS: Migration[] = [
  {
    to: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_meta (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         version INTEGER NOT NULL
       );`,
      `CREATE TABLE IF NOT EXISTS entries (
         id         TEXT PRIMARY KEY NOT NULL,
         kind       TEXT NOT NULL,
         title      TEXT NOT NULL,
         date       TEXT NOT NULL,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         data       TEXT NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS entries_order ON entries (date, created_at);`,
      `CREATE INDEX IF NOT EXISTS entries_updated_at ON entries (updated_at);`,
      // The multi-valued index behind findEntriesForAnchor. Dexie expresses this
      // as a multi-entry index; in SQL it is the row-per-key child table, which
      // is the same idea and the reason anchors are not searched by scanning.
      `CREATE TABLE IF NOT EXISTS entry_anchor_keys (
         entry_id   TEXT NOT NULL,
         anchor_key TEXT NOT NULL,
         PRIMARY KEY (entry_id, anchor_key),
         FOREIGN KEY (entry_id) REFERENCES entries (id) ON DELETE CASCADE
       );`,
      `CREATE INDEX IF NOT EXISTS entry_anchor_keys_key ON entry_anchor_keys (anchor_key);`,
      `CREATE TABLE IF NOT EXISTS settings (
         key  TEXT PRIMARY KEY NOT NULL,
         data TEXT NOT NULL
       );`,
    ],
  },
];

/** The subset of the Capacitor plugin this provider uses. */
interface SqlitePlugin {
  createConnection(options: {
    database: string;
    encrypted: boolean;
    mode: string;
    version: number;
    readonly: boolean;
  }): Promise<void>;
  closeConnection(options: { database: string; readonly: boolean }): Promise<void>;
  open(options: { database: string; readonly?: boolean }): Promise<void>;
  close(options: { database: string; readonly?: boolean }): Promise<void>;
  isDBOpen(options: { database: string; readonly?: boolean }): Promise<{ result?: boolean }>;
  /** The database's path on the device. Used for reporting, never for logic. */
  getUrl(options: { database: string; readonly?: boolean }): Promise<{ url?: string }>;
  execute(options: {
    database: string;
    statements: string;
    transaction?: boolean;
    readonly?: boolean;
  }): Promise<unknown>;
  run(options: {
    database: string;
    statement: string;
    values?: unknown[];
    transaction?: boolean;
    readonly?: boolean;
  }): Promise<unknown>;
  query(options: {
    database: string;
    statement: string;
    values?: unknown[];
    readonly?: boolean;
  }): Promise<{ values?: unknown[] }>;
  deleteDatabase(options: { database: string; readonly?: boolean }): Promise<void>;
  beginTransaction(options: { database: string }): Promise<unknown>;
  commitTransaction(options: { database: string }): Promise<unknown>;
  rollbackTransaction(options: { database: string }): Promise<unknown>;
}

/** Injectable so tests can drive the provider without a device. */
export type SqlitePluginLoader = () => Promise<SqlitePlugin>;

const loadCapacitorSqlite: SqlitePluginLoader = async () => {
  const { CapacitorSQLite } = await import('@capacitor-community/sqlite');
  const plugin = CapacitorSQLite as unknown as SqlitePlugin;

  // Handed back as a plain object, and that is not a style choice.
  //
  // Capacitor's plugin object is a Proxy that answers EVERY property access
  // with a callable, `then` included. Returning it from an `async` function
  // therefore makes the runtime believe it is a thenable and call `.then()` on
  // it, which the bridge dispatches as a native method and rejects with
  //   "CapacitorSQLite.then()" is not implemented on android
  // before a single statement runs. Delegating through an ordinary object keeps
  // the proxy out of any position where it could be awaited.
  //
  // Found on a device, not in a unit test: the Node stand-in is a plain object
  // and has no proxy to trip over.
  return {
    createConnection: (options) => plugin.createConnection(options),
    closeConnection: (options) => plugin.closeConnection(options),
    open: (options) => plugin.open(options),
    close: (options) => plugin.close(options),
    isDBOpen: (options) => plugin.isDBOpen(options),
    getUrl: (options) => plugin.getUrl(options),
    execute: (options) => plugin.execute(options),
    run: (options) => plugin.run(options),
    query: (options) => plugin.query(options),
    deleteDatabase: (options) => plugin.deleteDatabase(options),
    beginTransaction: (options) => plugin.beginTransaction(options),
    commitTransaction: (options) => plugin.commitTransaction(options),
    rollbackTransaction: (options) => plugin.rollbackTransaction(options),
  };
};

export interface SqliteProviderOptions {
  /** Defaults to the real plugin; replaced in tests. */
  loadPlugin?: SqlitePluginLoader;
  /**
   * The schema ledger. Defaults to the real one.
   *
   * Overridable so the migration machinery can be tested for real — applying
   * two steps in order, and refusing to advance the version when a step fails.
   * Version 1 is the first native schema, so without this seam the only thing
   * provable would be "a fresh database gets version 1", which is the one case
   * that says nothing about upgrades.
   */
  migrations?: Migration[];
}

export class SqliteStorageProvider implements StorageProvider {
  /**
   * What is actually underneath, in a form that survives minification.
   *
   * The native harness asserts on this. It used to read `constructor.name`,
   * which reported `"er"` in a production build because the minifier mangles
   * class names — a floor that could never have caught a Dexie substitution
   * because it could not identify anything. Property names are not mangled.
   */
  readonly engine = 'sqlite' as const;

  private readonly database: string;
  private readonly loadPlugin: SqlitePluginLoader;
  private readonly migrations: Migration[];
  private readonly targetVersion: number;
  private plugin: SqlitePlugin | null = null;
  private opening: Promise<void> | null = null;

  constructor(database: string = DATABASE_NAME, options: SqliteProviderOptions = {}) {
    this.database = database;
    this.loadPlugin = options.loadPlugin ?? loadCapacitorSqlite;
    this.migrations = options.migrations ?? MIGRATIONS;
    // Derived rather than declared, so a ledger and its version cannot disagree.
    this.targetVersion = this.migrations.reduce((high, m) => Math.max(high, m.to), 0);
  }

  // -------------------------------------------------------------------------
  // Opening and schema
  // -------------------------------------------------------------------------

  /**
   * Open the database and bring the schema up to date.
   *
   * Safe to call more than once, and concurrently: the application's effects can
   * run twice, and two overlapping opens that both ran the migrations would
   * deadlock on the same transaction. The in-flight promise is shared.
   */
  async open(): Promise<void> {
    if (this.plugin) return;
    if (this.opening) return this.opening;

    this.opening = this.openOnce().finally(() => {
      this.opening = null;
    });
    return this.opening;
  }

  private async openOnce(): Promise<void> {
    const plugin = await this.loadPlugin();

    // `isConnection` is JS-side bookkeeping in the plugin's optional wrapper
    // class, NOT a bridge method — asking for it on Android fails with
    // "CapacitorSQLite.isConnection() is not implemented". So the connection is
    // simply requested, and an existing one is not an error: two providers over
    // the same database is the ordinary reopen case, and the contract requires
    // `open()` to be safe to call twice.
    await plugin
      .createConnection({
        database: this.database,
        encrypted: false,
        mode: 'no-encryption',
        version: 1,
        readonly: false,
      })
      .catch((cause: unknown) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (!/already exist|connection.*exist/i.test(message)) throw cause;
      });

    const open = await plugin.isDBOpen({ database: this.database });
    if (!open?.result) await plugin.open({ database: this.database });

    this.plugin = plugin;

    // Needed for the ON DELETE CASCADE on entry_anchor_keys: SQLite enforces
    // foreign keys only when asked, per connection, and without this a deleted
    // entry would leave its anchor rows behind to match future lookups.
    await plugin.execute({
      database: this.database,
      statements: 'PRAGMA foreign_keys = ON;',
      transaction: false,
    });

    await this.migrate();
  }

  /** Release the connection. Used by tests and by a controlled shutdown. */
  async close(): Promise<void> {
    if (!this.plugin) return;
    const plugin = this.plugin;
    this.plugin = null;
    await plugin.close({ database: this.database }).catch(() => undefined);
    await plugin.closeConnection({ database: this.database, readonly: false }).catch(() => undefined);
  }

  /** Where the database file actually lives, as the plugin reports it. */
  async databaseUrl(): Promise<string | null> {
    try {
      const result = await (this.plugin ?? (await this.loadPlugin())).getUrl({
        database: this.database,
      });
      return result?.url ?? null;
    } catch {
      return null;
    }
  }

  /**
   * What the engine says it is.
   *
   * Used by the native harness as direct evidence that the store really is
   * SQLite rather than something standing in for it. Returns null if the
   * question cannot be answered.
   */
  async sqliteVersion(): Promise<string | null> {
    try {
      const rows = await this.select<Record<string, string>>(`SELECT sqlite_version() AS version;`);
      return rows[0]?.version ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Delete the database file. Test harnesses only.
   *
   * Destructive by definition, which is why the native harness refuses to name
   * anything but its own throwaway stores before it gets here.
   */
  async deleteStore(): Promise<void> {
    const plugin = this.plugin ?? (await this.loadPlugin());
    this.plugin = null;
    await plugin.close({ database: this.database }).catch(() => undefined);
    await plugin.deleteDatabase({ database: this.database }).catch(() => undefined);
    await plugin
      .closeConnection({ database: this.database, readonly: false })
      .catch(() => undefined);
  }

  /** The schema version recorded in the file, or 0 for a database with none. */
  async schemaVersion(): Promise<number> {
    const tables = await this.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta';`,
    );
    if (tables.length === 0) return 0;

    const rows = await this.select<{ version: number }>(
      `SELECT version FROM schema_meta WHERE id = 1;`,
    );
    return rows[0]?.version ?? 0;
  }

  private async migrate(): Promise<void> {
    const current = await this.schemaVersion();

    if (current > this.targetVersion) throw new SchemaTooNewError(current, this.targetVersion);
    if (current === this.targetVersion) return;

    for (const migration of this.migrations
      .filter((m) => m.to > current)
      .sort((a, b) => a.to - b.to)) {
      // One transaction per step, with the version bump inside it. A failure
      // half way through rolls the whole step back, and the database still
      // reports the version it genuinely has — never the one we hoped for.
      await this.inTransaction(async () => {
        for (const statement of migration.statements) {
          await this.exec(statement);
        }
        await this.write(
          `INSERT INTO schema_meta (id, version) VALUES (1, ?)
             ON CONFLICT(id) DO UPDATE SET version = excluded.version;`,
          [migration.to],
        );
      });
    }
  }

  // -------------------------------------------------------------------------
  // Statement plumbing
  // -------------------------------------------------------------------------

  private get db(): SqlitePlugin {
    if (!this.plugin) throw new Error('The journal database is not open.');
    return this.plugin;
  }

  /**
   * Run a statement with no parameters.
   *
   * `transaction: false` throughout, and it matters: the plugin wraps every
   * `execute`/`run` in its own transaction by default, and SQLite has no nested
   * transactions — so leaving the default on inside an explicit transaction
   * fails. Atomicity here is owned by `inTransaction`, not by the bridge.
   */
  private async exec(statement: string): Promise<void> {
    await this.db.execute({ database: this.database, statements: statement, transaction: false });
  }

  private async write(statement: string, values: unknown[] = []): Promise<void> {
    await this.db.run({ database: this.database, statement, values, transaction: false });
  }

  /**
   * Read rows, normalising a platform difference in the bridge.
   *
   * iOS prepends a descriptor row naming the columns:
   *
   *   android  [{ data: '...' }]
   *   ios      [{ ios_columns: ['data'] }, { data: '...' }]
   *
   * Android returns only the data. Taken at face value, every iOS read would
   * have had one phantom row at the front — `getEntry` would `JSON.parse`
   * `undefined`, and a list would carry a junk entry. Found by running the
   * contract on a simulator; neither Android nor a Node SQLite stand-in shows
   * it, because neither has this behaviour.
   *
   * `values` is always passed, even when empty: iOS rejects a query without it
   * ("Must provide an Array of value") while Android tolerates its absence.
   */
  private async select<T>(statement: string, values: unknown[] = []): Promise<T[]> {
    const result = await this.db.query({ database: this.database, statement, values });
    const rows = (result?.values ?? []) as unknown[];
    return rows.filter(
      (row) => !(row !== null && typeof row === 'object' && 'ios_columns' in row),
    ) as T[];
  }

  /**
   * Run a unit of work atomically.
   *
   * Everything a caller is told succeeded has committed by the time the promise
   * resolves. Nothing is queued for a lifecycle callback to flush later — an
   * app that is killed between "Saved" and a callback that never came would owe
   * the user an explanation nobody could give them.
   */
  private async inTransaction<T>(work: () => Promise<T>): Promise<T> {
    await this.db.beginTransaction({ database: this.database });
    try {
      const result = await work();
      await this.db.commitTransaction({ database: this.database });
      return result;
    } catch (cause) {
      await this.db.rollbackTransaction({ database: this.database }).catch(() => undefined);
      throw cause;
    }
  }

  // -------------------------------------------------------------------------
  // Rows
  // -------------------------------------------------------------------------

  /** Write one entry and its derived anchor index. Caller owns the transaction. */
  private async writeEntry(entry: Entry): Promise<void> {
    await this.write(
      `INSERT INTO entries (id, kind, title, date, created_at, updated_at, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind, title = excluded.title, date = excluded.date,
         created_at = excluded.created_at, updated_at = excluded.updated_at,
         data = excluded.data;`,
      [
        entry.id,
        entry.kind,
        entry.title,
        entry.date,
        entry.createdAt,
        entry.updatedAt,
        JSON.stringify(entry),
      ],
    );

    await this.write(`DELETE FROM entry_anchor_keys WHERE entry_id = ?;`, [entry.id]);
    for (const key of anchorKeys(entry)) {
      await this.write(
        `INSERT OR IGNORE INTO entry_anchor_keys (entry_id, anchor_key) VALUES (?, ?);`,
        [entry.id, key],
      );
    }
  }

  private async allEntries(): Promise<Entry[]> {
    const rows = await this.select<{ data: string }>(`SELECT data FROM entries;`);
    return rows.map((row) => JSON.parse(row.data) as Entry);
  }

  // -------------------------------------------------------------------------
  // StorageProvider
  // -------------------------------------------------------------------------

  async getEntry(id: string): Promise<Entry | undefined> {
    const rows = await this.select<{ data: string }>(`SELECT data FROM entries WHERE id = ?;`, [id]);
    return rows.length ? (JSON.parse(rows[0].data) as Entry) : undefined;
  }

  async listEntries(query: EntryQuery = {}): Promise<Entry[]> {
    const entries = await this.listEntriesChronological(query);
    return entries.reverse();
  }

  async listEntriesChronological(query: EntryQuery = {}): Promise<Entry[]> {
    // Filtered and ordered by the shared semantics rather than in SQL. The
    // predicate is the product's, it already exists, and a WHERE clause that
    // reimplemented it would be a second opinion about what a query means.
    const entries = await this.allEntries();
    return entries
      .map(indexed)
      .filter((row) => matches(row, query))
      .map((row) => row.entry)
      .sort(chronologically);
  }

  async createEntry(input: NewEntry): Promise<Entry> {
    const entry = entryToCreate(input);
    await this.inTransaction(() => this.writeEntry(entry));
    return entry;
  }

  async updateEntry(id: string, patch: Partial<Entry>): Promise<Entry> {
    const existing = await this.getEntry(id);
    if (!existing) throw new Error(`No entry with id ${id}`);
    const updated = applyPatch(existing, patch);
    await this.inTransaction(() => this.writeEntry(updated));
    return updated;
  }

  async deleteEntry(id: string): Promise<void> {
    // The anchor rows go with it, via ON DELETE CASCADE.
    await this.inTransaction(() => this.write(`DELETE FROM entries WHERE id = ?;`, [id]));
  }

  async findEntriesForAnchor(anchor: AnchorLookup): Promise<Entry[]> {
    const rows = await this.select<{ data: string }>(
      `SELECT e.data FROM entries e
         JOIN entry_anchor_keys k ON k.entry_id = e.id
        WHERE k.anchor_key = ?;`,
      [anchorLookupKey(anchor)],
    );
    return rows.map((row) => JSON.parse(row.data) as Entry).sort(byDateDescending);
  }

  async putEntries(entries: Entry[]): Promise<void> {
    if (entries.length === 0) return;
    // One transaction for the whole batch. Import depends on it: a journal must
    // not be able to end up half restored.
    await this.inTransaction(async () => {
      for (const entry of entries) await this.writeEntry(entry);
    });
  }

  async clearEntries(): Promise<void> {
    // Settings are a different table and are deliberately untouched — a
    // replace-mode import must not forget when the reader last exported.
    await this.inTransaction(() => this.write(`DELETE FROM entries;`));
  }

  async getSettings(): Promise<Settings> {
    const rows = await this.select<{ data: string }>(`SELECT data FROM settings WHERE key = ?;`, [
      SETTINGS_KEY,
    ]);
    return rows.length ? (JSON.parse(rows[0].data) as Settings) : {};
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.getSettings();
    const next = { ...current, ...patch };
    // JSON.stringify drops keys whose value is undefined, which is exactly the
    // documented way to clear one: patching `reminderDismissedAt: undefined`
    // must un-dismiss the export reminder rather than storing a null.
    await this.inTransaction(() =>
      this.write(
        `INSERT INTO settings (key, data) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET data = excluded.data;`,
        [SETTINGS_KEY, JSON.stringify(next)],
      ),
    );
    return next;
  }

  async listTags(): Promise<string[]> {
    return distinctValues(await this.allEntries(), TAGS);
  }

  async listSpeakers(): Promise<string[]> {
    return distinctValues(await this.allEntries(), SPEAKERS);
  }

  async listPlaces(): Promise<string[]> {
    return distinctValues(await this.allEntries(), PLACES);
  }
}
