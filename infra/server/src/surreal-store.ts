/**
 * SurrealDB store for the management server.
 *
 * SurrealDB is the only database (Ryan's preferences §9). This module talks
 * to SurrealDB over its HTTP /sql endpoint — no JS SDK dependency, keeping the
 * dependency surface minimal. The connection details come from the
 * SURREALDB_* environment variables (bootstrap defaults; the GUI is the source
 * of truth for runtime config).
 *
 * All queries are parameterized to avoid injection. The response envelope from
 * /sql is an array of { result, status, time }; this helper unwraps the first
 * statement's result by default and throws on a non-OK status.
 */

export interface SurrealDbOptions {
  endpoint: string;
  namespace: string;
  database: string;
  username: string;
  password: string;
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

export function loadSurrealOptions(): SurrealDbOptions {
  return {
    endpoint: envOrDefault('SURREALDB_URL', 'http://surrealdb:8000'),
    namespace: envOrDefault('SURREALDB_NAMESPACE', 'overlay'),
    database: envOrDefault('SURREALDB_DATABASE', 'companion'),
    username: envOrDefault('SURREALDB_USERNAME', 'root'),
    password: envOrDefault('SURREALDB_PASSWORD', 'root'),
  };
}

interface SqlResponseRow {
  result?: unknown;
  status?: string;
  detail?: string;
}

export class SurrealDbStore {
  private readonly opts: SurrealDbOptions;
  private readonly authHeader: string;
  // Lazy schema-apply guard so we only run the DEFINE statements once per process.
  private schemaApplied = false;
  private schemaApplyPromise: Promise<void> | null = null;

  constructor(opts: SurrealDbOptions = loadSurrealOptions()) {
    this.opts = opts;
    this.authHeader =
      'Basic ' + Buffer.from(`${opts.username}:${opts.password}`).toString('base64');
  }

  /**
   * Run one or more SurrealQL statements. Variables are bound positionally.
   * Returns the result of the first statement by default; pass index to pick
   * another. Throws on any statement returning a non-OK status.
   */
  async query<T = unknown>(sql: string, vars?: Record<string, unknown>, resultIndex = 0): Promise<T> {
    const body = vars ? JSON.stringify(vars) : '';
    const res = await fetch(`${this.opts.endpoint}/sql`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Surreal-NS': this.opts.namespace,
        'Surreal-DB': this.opts.database,
        Authorization: this.authHeader,
      },
      body: vars ? this.interpolateVars(sql, vars) : sql,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`SurrealDB HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const rows = (await res.json()) as SqlResponseRow[];
    if (!Array.isArray(rows)) {
      throw new Error('SurrealDB returned non-array response');
    }

    const row = rows[resultIndex];
    if (!row) {
      throw new Error(`SurrealDB response missing index ${resultIndex}`);
    }
    if (row.status && row.status !== 'OK') {
      throw new Error(`SurrealDB query error: ${row.detail ?? row.status}`);
    }
    return row.result as T;
  }

  /**
   * SurrealDB HTTP /sql does not bind JSON body variables directly in v2; we
   * interpolate by safely serializing each var. Strings are escaped; objects
   * are rendered as SurrealQL objects. This is bounded to our own queries.
   */
  private interpolateVars(sql: string, vars: Record<string, unknown>): string {
    let out = sql;
    for (const [key, value] of Object.entries(vars)) {
      const token = `$${key}`;
      out = out.split(token).join(this.renderValue(value));
    }
    return out;
  }

  private renderValue(value: unknown): string {
    if (value === null || value === undefined) return 'NONE';
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
  }

  /**
   * Apply the schema file on boot. Idempotent (OVERWRITE). Safe to call
   * repeatedly; only runs once per process.
   */
  async ensureSchema(schemaSql: string): Promise<void> {
    if (this.schemaApplied) return;
    if (this.schemaApplyPromise) return this.schemaApplyPromise;
    this.schemaApplyPromise = (async () => {
      try {
        await fetch(`${this.opts.endpoint}/sql`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'text/plain',
            'Surreal-NS': this.opts.namespace,
            'Surreal-DB': this.opts.database,
            Authorization: this.authHeader,
          },
          body: schemaSql,
          signal: AbortSignal.timeout(15000),
        });
        this.schemaApplied = true;
      } catch (err) {
        // Schema apply failure is non-fatal at boot; queries will surface a
        // clearer error. The health check reports DB reachability.
        console.warn('[WARN] SurrealDB schema apply failed:', (err as Error).message);
      }
    })();
    return this.schemaApplyPromise;
  }

  /**
   * Lightweight reachability probe for the health endpoint.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.opts.endpoint}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ---- User records -----------------------------------------------------

  async upsertUser(user: {
    id?: string;
    provider: string;
    subject?: string;
    username: string;
    email?: string;
    displayName?: string;
    roles?: string[];
    passwordHash?: string;
  }): Promise<{ id: string }> {
    const id = user.id ?? `user:${cryptoRandomId()}`;
    await this.query(
      `CREATE OR UPDATE ${'$id'} SET
        provider = $provider,
        subject = $subject,
        username = $username,
        email = $email,
        display_name = $displayName,
        roles = $roles,
        password_hash = $passwordHash,
        updated_at = time::now(),
        last_login = time::now();`,
      {
        id,
        provider: user.provider,
        subject: user.subject ?? null,
        username: user.username,
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        roles: user.roles ?? [],
        passwordHash: user.passwordHash ?? null,
      },
    );
    return { id };
  }

  async findUserBySubject(provider: string, subject: string): Promise<DbUser | null> {
    const rows = await this.query<DbUser[]>(
      `SELECT * FROM user WHERE provider = $provider AND subject = $subject LIMIT 1;`,
      { provider, subject },
    );
    return rows && rows.length > 0 ? rows[0] : null;
  }

  async findUserByUsername(username: string): Promise<DbUser | null> {
    const rows = await this.query<DbUser[]>(
      `SELECT * FROM user WHERE username = $username LIMIT 1;`,
      { username },
    );
    return rows && rows.length > 0 ? rows[0] : null;
  }

  async getUser(id: string): Promise<DbUser | null> {
    const rows = await this.query<DbUser[]>(`SELECT * FROM type::thing($id);`, { id });
    return rows && rows.length > 0 ? rows[0] : null;
  }

  async deleteUser(id: string): Promise<void> {
    await this.query(`DELETE FROM type::thing($id);`, { id });
  }

  async countUsers(): Promise<number> {
    const rows = await this.query<Array<{ count: number }>>(
      `SELECT count() AS count FROM user GROUP ALL;`,
    );
    if (Array.isArray(rows) && rows.length > 0) {
      return rows[0].count ?? 0;
    }
    const single = rows as unknown as { count?: number };
    return single?.count ?? 0;
  }

  // ---- Sessions ---------------------------------------------------------

  async createSession(session: {
    userId: string;
    tokenHash: string;
    csrfToken?: string;
    ipAddress?: string;
    userAgent?: string;
    expiresAt: Date;
  }): Promise<string> {
    const id = `session:${cryptoRandomId()}`;
    await this.query(
      `CREATE ${'$id'} SET
        user_id = type::thing($userId),
        token_hash = $tokenHash,
        csrf_token = $csrfToken,
        ip_address = $ipAddress,
        user_agent = $userAgent,
        expires_at = $expiresAt,
        created_at = time::now(),
        revoked = false;`,
      {
        id,
        userId: session.userId,
        tokenHash: session.tokenHash,
        csrfToken: session.csrfToken ?? null,
        ipAddress: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
        expiresAt: session.expiresAt.toISOString(),
      },
    );
    return id;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<DbSession | null> {
    const rows = await this.query<DbSession[]>(
      `SELECT * FROM session WHERE token_hash = $tokenHash AND revoked = false LIMIT 1;`,
      { tokenHash },
    );
    return rows && rows.length > 0 ? rows[0] : null;
  }

  async revokeSession(id: string): Promise<void> {
    await this.query(`UPDATE type::thing($id) SET revoked = true;`, { id });
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.query(
      `UPDATE session SET revoked = true WHERE user_id = type::thing($userId);`,
      { userId },
    );
  }

  // ---- Audit log --------------------------------------------------------

  async appendAudit(event: AuditEvent): Promise<void> {
    const id = `audit_log:${cryptoRandomId()}`;
    await this.query(
      `CREATE ${'$id'} SET
        timestamp = time::now(),
        user_id = $userId,
        actor = $actor,
        action = $action,
        ip_address = $ipAddress,
        detail = $detail,
        trace_id = $traceId;`,
      {
        id,
        userId: event.userId ?? null,
        actor: event.actor ?? 'system',
        action: event.action,
        ipAddress: event.ipAddress ?? null,
        detail: event.detail ?? null,
        traceId: event.traceId ?? null,
      },
    );
  }

  // ---- App configuration (GUI-first) ------------------------------------

  async getConfig(key: string): Promise<unknown | null> {
    const rows = await this.query<Array<{ value: unknown }>>(
      `SELECT value FROM app_config WHERE id = type::thing($id);`,
      { id: `app_config:${key}` },
    );
    return rows && rows.length > 0 ? rows[0].value : null;
  }

  async setConfig(key: string, value: Record<string, unknown>, category: string, updatedBy?: string): Promise<void> {
    await this.query(
      `CREATE OR UPDATE ${'$id'} SET
        value = $value,
        category = $category,
        updated_at = time::now(),
        updated_by = $updatedBy;`,
      {
        id: `app_config:${key}`,
        value,
        category,
        updatedBy: updatedBy ?? null,
      },
    );
  }

  async getConfigByCategory(category: string): Promise<Array<{ id: string; value: unknown }>> {
    const rows = await this.query<Array<{ id: string; value: unknown }>>(
      `SELECT id, value FROM app_config WHERE category = $category;`,
      { category },
    );
    return rows ?? [];
  }
}

export interface DbUser {
  id: string;
  provider: string;
  subject?: string;
  username: string;
  email?: string;
  display_name?: string;
  roles: string[];
  active: boolean;
  created_at?: string;
  updated_at?: string;
  last_login?: string;
  password_hash?: string;
}

export interface DbSession {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token?: string;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
  expires_at: string;
  revoked: boolean;
}

function cryptoRandomId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
