/**
 * Minimal Kysely dialect over the official `@libsql/client`.
 *
 * Kysely ships SQLite's query compiler, adapter, and introspector; we only
 * supply the `Driver` + `DatabaseConnection` that speak to the top-level
 * `@libsql/client` instance (embedded file, Turso Cloud, or libsql-server).
 *
 * We do NOT use `@libsql/kysely-libsql`: that package bundles an old
 * `@libsql/client` (0.8.x) whose prebuilt musl binary fails to load on the
 * alpine runtime (`fcntl64: symbol not found`). Wiring the dialect to our own
 * client keeps a single, up-to-date native `libsql` dependency.
 */

import {
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type DialectAdapter,
  type Driver,
  type Kysely,
  type QueryResult,
  type TransactionSettings,
} from 'kysely';
import type { Client, InArgs } from '@libsql/client';

class LibSqlConnection implements DatabaseConnection {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.#client.execute({
      sql: compiledQuery.sql,
      args: compiledQuery.parameters as InArgs,
    });
    return {
      numAffectedRows: BigInt(result.rowsAffected),
      insertId: result.lastInsertRowid,
      rows: result.rows as R[],
    };
  }

  async *streamQuery<R>(compiledQuery: CompiledQuery): AsyncIterableIterator<QueryResult<R>> {
    // libSQL embedded has no row streaming; yield a single result set.
    yield await this.executeQuery<R>(compiledQuery);
  }

  async beginTransaction(): Promise<void> {
    await this.#client.execute('BEGIN');
  }

  async commitTransaction(): Promise<void> {
    await this.#client.execute('COMMIT');
  }

  async rollbackTransaction(): Promise<void> {
    await this.#client.execute('ROLLBACK');
  }
}

class LibSqlDriver implements Driver {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  async init(): Promise<void> {
    /* the client is already initialized */
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new LibSqlConnection(this.#client);
  }

  async beginTransaction(connection: DatabaseConnection, _settings: TransactionSettings): Promise<void> {
    await (connection as LibSqlConnection).beginTransaction();
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as LibSqlConnection).commitTransaction();
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await (connection as LibSqlConnection).rollbackTransaction();
  }

  async releaseConnection(_connection: DatabaseConnection): Promise<void> {
    /* single embedded connection; nothing to release */
  }

  async destroy(): Promise<void> {
    /* the store owns the client lifetime */
  }
}

export class LibSqlDialect implements Dialect {
  readonly #client: Client;

  constructor(client: Client) {
    this.#client = client;
  }

  createDriver(): Driver {
    return new LibSqlDriver(this.#client);
  }

  createQueryCompiler(): ReturnType<Dialect['createQueryCompiler']> {
    return new SqliteQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createIntrospector(db: Kysely<unknown>): ReturnType<Dialect['createIntrospector']> {
    return new SqliteIntrospector(db);
  }
}