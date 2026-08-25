/**
 * libSQL / Turso store for the management server.
 *
 * SurrealDB is replaced by libSQL (the engine that powers Turso) as the only
 * database. This module talks to libSQL via the official `@libsql/client`. The
 * same client works against:
 *   - embedded local file   `file:/data/companion.db`  (default, self-hosted)
 *   - Turso Cloud           `libsql://<db>.turso.io` + LIBSQL_AUTH_TOKEN
 *   - self-hosted server    `http(s)://host:8080` (libsql-server)
 * so every query here is engine-specific SQL in one place (the store boundary,
 * §9). Better Auth owns its own tables through its Kysely adapter.
 *
 * All queries are parameterized (positional `?` placeholders) to avoid
 * injection.
 */

import { createClient, type Client, type InStatement } from '@libsql/client';

export interface LibSqlOptions {
  url: string;
  authToken?: string;
}

export interface AuditEvent {
  action: string;
  userId?: string;
  actor?: string;
  ipAddress?: string;
  detail?: Record<string, unknown>;
  traceId?: string;
}

function envOrDefault(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

export function loadLibSqlOptions(): LibSqlOptions {
  return {
    url: envOrDefault('LIBSQL_URL', 'file:/data/companion.db'),
    authToken: envOrDefault('LIBSQL_AUTH_TOKEN', envOrDefault('TURSO_AUTH_TOKEN', '')),
  };
}

// A saved connection id may arrive as a bare uuid or as the legacy
// `connection:<uuid>` form; normalize to the bare id (the primary key shape).
// Better Auth user ids are plain strings (no `users:` prefix) under libSQL.
function bareId(id: string): string {
  return id.replace(/^connection:/, '');
}

function now(): string {
  return new Date().toISOString();
}

export class LibSqlStore {
  private readonly client: Client;

  constructor(opts: LibSqlOptions = loadLibSqlOptions()) {
    this.client = createClient({
      url: opts.url,
      authToken: opts.authToken ? opts.authToken : undefined,
    });
  }

  /**
   * Run a single parameterized statement and return the rows + affected count.
   */
  private async run<T = Record<string, unknown>>(
    stmt: InStatement,
  ): Promise<{ rows: T[]; rowsAffected: number }> {
    const res = await this.client.execute(stmt);
    const rowsAffected = Number(res.rowsAffected ?? 0);
    return { rows: res.rows as T[], rowsAffected };
  }

  /**
   * Apply the idempotent DDL schema on boot. The schema file uses
   * `CREATE ... IF NOT EXISTS` so re-running is safe.
   */
  async ensureSchema(schemaSql: string): Promise<void> {
    if (!schemaSql.trim()) return;
    // Strip `--` comment lines first, then split on statement terminators so a
    // leading comment block never swallows the first CREATE statement.
    const cleaned = schemaSql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    const statements = cleaned
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    try {
      for (const stmt of statements) {
        await this.client.execute(stmt);
      }
    } catch (err) {
      // Schema apply failure is non-fatal at boot; queries surface a clearer
      // error and the health check reports DB reachability.
      console.warn('[WARN] libSQL schema apply failed:', (err as Error).message);
    }
  }

  /**
   * Lightweight reachability probe for the health endpoint.
   */
  async ping(): Promise<boolean> {
    try {
      await this.client.execute('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // ---- App configuration (GUI-first) ------------------------------------

  private parsePayload(payload: string | null): unknown {
    if (payload == null) return null;
    try {
      return JSON.parse(payload);
    } catch {
      return payload;
    }
  }

  async getConfig(key: string): Promise<unknown | null> {
    const { rows } = await this.run<{ payload: string | null }>({
      sql: 'SELECT payload FROM app_config WHERE name = ? LIMIT 1;',
      args: [key],
    });
    if (!rows || rows.length === 0) return null;
    return this.parsePayload(rows[0].payload);
  }

  async setConfig(
    key: string,
    value: Record<string, unknown>,
    category: string,
    updatedBy?: string,
  ): Promise<void> {
    await this.run({
      sql: `INSERT INTO app_config (name, payload, category, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET
             payload = excluded.payload,
             category = excluded.category,
             updated_at = excluded.updated_at,
             updated_by = excluded.updated_by;`,
      args: [key, JSON.stringify(value), category, now(), updatedBy ?? null],
    });
  }

  async getConfigByCategory(category: string): Promise<Array<{ id: string; value: unknown }>> {
    const { rows } = await this.run<{ name: string; payload: string | null }>({
      sql: 'SELECT name, payload FROM app_config WHERE category = ?;',
      args: [category],
    });
    return (rows ?? []).map((r) => ({ id: r.name, value: this.parsePayload(r.payload) }));
  }

  // ---- Audit log --------------------------------------------------------

  async appendAudit(event: AuditEvent): Promise<void> {
    await this.run({
      sql: `INSERT INTO audit_log (id, timestamp, user_id, actor, action, ip_address, detail, trace_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      args: [
        cryptoRandomId(),
        now(),
        event.userId ?? null,
        event.actor ?? 'system',
        event.action,
        event.ipAddress ?? null,
        event.detail ? JSON.stringify(event.detail) : null,
        event.traceId ?? null,
      ],
    });
  }

  // ---- Connections -------------------------------------------------------

  // SQLite stores booleans as 0/1; normalize them before handing rows to the
  // route layer (whose DTO shape uses real booleans).
  private toConnection(row: ConnectionRow): DbConnection {
    return {
      ...row,
      ssl: Boolean(row.ssl),
      active: Boolean(row.active),
    };
  }

  async listConnections(userId: string): Promise<DbConnection[]> {
    const { rows } = await this.run<ConnectionRow>({
      sql: 'SELECT * FROM connection WHERE user_id = ? ORDER BY created_at DESC;',
      args: [userId],
    });
    return (rows ?? []).map((r) => this.toConnection(r));
  }

  async getConnectionsByIds(ids: string[]): Promise<DbConnection[]> {
    const clean = ids.map(bareId).filter((id) => id.length > 0);
    if (clean.length === 0) return [];
    const placeholders = clean.map(() => '?').join(', ');
    const { rows } = await this.run<ConnectionRow>({
      sql: `SELECT * FROM connection WHERE id IN (${placeholders}) ORDER BY created_at DESC;`,
      args: clean,
    });
    return (rows ?? []).map((r) => this.toConnection(r));
  }

  async getConnection(userId: string, id: string): Promise<DbConnection | null> {
    const { rows } = await this.run<ConnectionRow>({
      sql: 'SELECT * FROM connection WHERE id = ? AND user_id = ? LIMIT 1;',
      args: [bareId(id), userId],
    });
    return rows && rows.length > 0 ? this.toConnection(rows[0]) : null;
  }

  async upsertConnection(
    userId: string,
    input: ConnectionInput,
    passwordHash?: string,
  ): Promise<DbConnection> {
    const id = bareId(input.id ?? cryptoRandomId());
    await this.run({
      sql: `INSERT INTO connection
             (id, user_id, name, host, port, protocol, username, password_hash, ssl, description, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             host = excluded.host,
             port = excluded.port,
             protocol = excluded.protocol,
             username = excluded.username,
             password_hash = excluded.password_hash,
             ssl = excluded.ssl,
             description = excluded.description,
             updated_at = excluded.updated_at;`,
      args: [
        id,
        userId,
        input.name,
        input.host,
        input.port,
        input.protocol,
        input.username ?? null,
        passwordHash ?? null,
        input.ssl ? 1 : 0,
        input.description ?? null,
        now(),
        now(),
      ],
    });
    const saved = await this.getConnection(userId, id);
    if (!saved) throw new Error('Connection upsert failed');
    return saved;
  }

  async deleteConnection(userId: string, id: string): Promise<boolean> {
    const { rowsAffected } = await this.run({
      sql: 'DELETE FROM connection WHERE id = ? AND user_id = ?;',
      args: [bareId(id), userId],
    });
    return rowsAffected > 0;
  }

  async touchLastConnected(userId: string, id: string): Promise<void> {
    await this.run({
      sql: 'UPDATE connection SET last_connected = ?, updated_at = ? WHERE id = ? AND user_id = ?;',
      args: [now(), now(), bareId(id), userId],
    });
  }
}

// ---- Connections ---------------------------------------------------------

/** Raw `connection` row as stored by SQLite (booleans are 0/1). */
interface ConnectionRow {
  id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  username?: string | null;
  password_hash?: string | null;
  ssl?: number;
  description?: string | null;
  active?: number;
  created_at?: string;
  updated_at?: string;
  last_connected?: string | null;
}

/** A saved remote-desktop connection row. Mirrors the `connection` table. */
export interface DbConnection {
  id: string;
  user_id: string;
  name: string;
  host: string;
  port: number;
  protocol: string; // 'kasmvnc' | 'vnc' | 'rdp'
  username?: string | null;
  password_hash?: string | null;
  ssl?: boolean;
  description?: string | null;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
  last_connected?: string | null;
}

/** Data needed to create or update a connection (no password hash here). */
export interface ConnectionInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  protocol: string;
  username?: string | null;
  ssl?: boolean;
  description?: string | null;
}

function cryptoRandomId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}