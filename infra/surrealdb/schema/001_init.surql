-- Overlay Companion MCP — SurrealDB schema
-- SurrealDB is the only database (per Ryan's preferences §9).
-- This file defines the tables that back users, sessions, connections,
-- audit log, and GUI-first application configuration. It is idempotent:
-- re-running it upgrades the schema in place without dropping data.

-- Users: identity records mirrored from the IdP (Keycloak) plus the local
-- auth fallback. The `provider` field records where the identity originates.
DEFINE TABLE OVERWRITE user SCHEMAFULL PERMISSIONS
    -- A user may read and update only their own record.
    FOR select, update WHERE id = $auth.id,
    FOR create, delete NONE;

DEFINE FIELD OVERWRITE id           ON user TYPE string;
DEFINE FIELD OVERWRITE provider     ON user TYPE string;            -- 'oidc' | 'local'
DEFINE FIELD OVERWRITE subject      ON user TYPE option<string>;    -- IdP subject (OIDC)
DEFINE FIELD OVERWRITE username     ON user TYPE string;
DEFINE FIELD OVERWRITE email        ON user TYPE option<string>;
DEFINE FIELD OVERWRITE display_name ON user TYPE option<string>;
DEFINE FIELD OVERWRITE roles        ON user TYPE array<string> DEFAULT [];
DEFINE FIELD OVERWRITE active       ON user TYPE bool DEFAULT true;
DEFINE FIELD OVERWRITE created_at   ON user TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_at   ON user TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE last_login   ON user TYPE option<datetime>;

-- For local-auth users only: a salted hash of the password. Never store
-- plaintext. Never populated for OIDC users.
DEFINE FIELD OVERWRITE password_hash ON user TYPE option<string>;

DEFINE INDEX OVERWRITE user_subject_idx  ON user FIELDS provider, subject UNIQUE;
DEFINE INDEX OVERWRITE user_username_idx ON user FIELDS username UNIQUE;

-- Sessions: server-side session records backing the signed cookies issued by
-- the management server. Token hashes are stored, never the raw token.
DEFINE TABLE OVERWRITE session SCHEMAFULL PERMISSIONS NONE;

DEFINE FIELD OVERWRITE id           ON session TYPE string;
DEFINE FIELD OVERWRITE user_id      ON session TYPE record<user>;
DEFINE FIELD OVERWRITE token_hash   ON session TYPE string;
DEFINE FIELD OVERWRITE csrf_token   ON session TYPE option<string>;
DEFINE FIELD OVERWRITE ip_address   ON session TYPE option<string>;
DEFINE FIELD OVERWRITE user_agent   ON session TYPE option<string>;
DEFINE FIELD OVERWRITE created_at   ON session TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE expires_at   ON session TYPE datetime;
DEFINE FIELD OVERWRITE revoked      ON session TYPE bool DEFAULT false;

DEFINE INDEX OVERWRITE session_token_idx  ON session FIELDS token_hash UNIQUE;
DEFINE INDEX OVERWRITE session_user_idx   ON session FIELDS user_id;
DEFINE INDEX OVERWRITE session_expires_idx ON session FIELDS expires_at;

-- Connections: saved remote-desktop connections (KasmVNC/VNC/RDP). Replaces the
-- JSON-file store previously in ConnectionManagementService. Secrets (passwords)
-- are never stored here; the UI keeps credentials in browser storage or the IdP
-- holds them. Only non-secret connection metadata is persisted.
DEFINE TABLE OVERWRITE connection SCHEMAFULL PERMISSIONS
    FOR select, update, delete WHERE user_id = $auth.id,
    FOR create WHERE user_id = $auth.id;

DEFINE FIELD OVERWRITE id           ON connection TYPE string;
DEFINE FIELD OVERWRITE user_id      ON connection TYPE record<user>;
DEFINE FIELD OVERWRITE name         ON connection TYPE string;
DEFINE FIELD OVERWRITE host         ON connection TYPE string;
DEFINE FIELD OVERWRITE port         ON connection TYPE int;
DEFINE FIELD OVERWRITE protocol     ON connection TYPE string;      -- 'kasmvnc' | 'vnc' | 'rdp'
DEFINE FIELD OVERWRITE username     ON connection TYPE option<string>;
DEFINE FIELD OVERWRITE active       ON connection TYPE bool DEFAULT false;
DEFINE FIELD OVERWRITE created_at   ON connection TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_at   ON connection TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE last_connected ON connection TYPE option<datetime>;

DEFINE INDEX OVERWRITE connection_user_idx ON connection FIELDS user_id;

-- Audit log: security-relevant events (login, logout, failed login, account
-- deletion, config changes, connection tests). Append-only; no update/delete.
DEFINE TABLE OVERWRITE audit_log SCHEMAFULL PERMISSIONS NONE;

DEFINE FIELD OVERWRITE id           ON audit_log TYPE string;
DEFINE FIELD OVERWRITE timestamp    ON audit_log TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE user_id      ON audit_log TYPE option<record<user>>;
DEFINE FIELD OVERWRITE actor        ON audit_log TYPE string;        -- 'user' | 'system' | 'admin'
DEFINE FIELD OVERWRITE action       ON audit_log TYPE string;        -- e.g. 'auth.login.success'
DEFINE FIELD OVERWRITE ip_address   ON audit_log TYPE option<string>;
DEFINE FIELD OVERWRITE detail       ON audit_log TYPE option<object>;
DEFINE FIELD OVERWRITE trace_id     ON audit_log TYPE option<string>;

DEFINE INDEX OVERWRITE audit_time_idx  ON audit_log FIELDS timestamp;
DEFINE INDEX OVERWRITE audit_user_idx  ON audit_log FIELDS user_id;
DEFINE INDEX OVERWRITE audit_action_idx ON audit_log FIELDS action;

-- Application configuration: GUI-first settings (per §9 "Configuration:
-- GUI-first"). Env vars are bootstrap defaults only; the GUI is the source of
-- truth. `key` is a dotted path (e.g. 'auth.oidc.issuer'); `value` is a flex
-- object so the GUI can store structured, machine-readable defaults.
DEFINE TABLE OVERWRITE app_config SCHEMAFULL PERMISSIONS
    -- Readable by any authenticated user (settings UI); writable only by admins.
    FOR select WHERE $auth,
    FOR create, update, delete WHERE $auth IN (SELECT id FROM user WHERE 'admin' IN roles);

DEFINE FIELD OVERWRITE id           ON app_config TYPE string;       -- the dotted key
DEFINE FIELD OVERWRITE value        ON app_config TYPE object;
DEFINE FIELD OVERWRITE category     ON app_config TYPE string;       -- 'auth' | 'connection' | 'wazuh' | 'general'
DEFINE FIELD OVERWRITE updated_at   ON app_config TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_by   ON app_config TYPE option<record<user>>;

DEFINE INDEX OVERWRITE app_config_category_idx ON app_config FIELDS category;
