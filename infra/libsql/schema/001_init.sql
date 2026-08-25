-- Overlay Companion MCP — libSQL (Turso / SQLite) schema
--
-- The management server's app-data tables. Better Auth owns its own tables
-- (user, session, account, verification, twoFactor, passkey) through its Kysely
-- adapter migrations, so they are not defined here. Everything in this file is
-- idempotent (CREATE ... IF NOT EXISTS) and safe to re-run.

-- Saved remote-desktop connections (KasmVNC/VNC/RDP). Replaces the old
-- JSON-file store. Plaintext passwords are never stored; only an Argon2id
-- password hash (for server-side verification) is persisted alongside
-- non-secret metadata. `user_id` is a Better Auth user id (plain string).
CREATE TABLE IF NOT EXISTS connection (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  name           TEXT NOT NULL,
  host           TEXT NOT NULL,
  port           INTEGER NOT NULL,
  protocol       TEXT NOT NULL,          -- 'kasmvnc' | 'vnc' | 'rdp'
  username       TEXT,
  password_hash  TEXT,                    -- Argon2id
  ssl            INTEGER NOT NULL DEFAULT 0,
  description    TEXT,
  active         INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT,
  updated_at     TEXT,
  last_connected TEXT
);
CREATE INDEX IF NOT EXISTS idx_connection_user ON connection (user_id);

-- Audit log: security-relevant events (login, logout, failed login, account
-- deletion, config changes, connection tests). Append-only; no update/delete.
CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  timestamp  TEXT,
  user_id    TEXT,
  actor      TEXT NOT NULL,               -- 'user' | 'system' | 'admin'
  action     TEXT NOT NULL,               -- e.g. 'auth.login.success'
  ip_address TEXT,
  detail     TEXT,                        -- JSON object
  trace_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log (timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log (action);

-- Application configuration: GUI-first settings (§9). The dotted key
-- (e.g. 'auth.oidc.issuer') is the primary key `name`; `payload` holds the
-- settings object as a JSON string. Env vars are bootstrap defaults only.
CREATE TABLE IF NOT EXISTS app_config (
  name       TEXT PRIMARY KEY,
  payload    TEXT,
  category   TEXT,                        -- 'auth' | 'connection' | 'wazuh' | 'general' | 'tls' | ...
  updated_at TEXT,
  updated_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_app_config_category ON app_config (category);