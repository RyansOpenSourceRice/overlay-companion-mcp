# libSQL (Turso) database

This directory holds the libSQL schema for the Overlay Companion management
server. libSQL — the SQLite-compatible engine that powers Turso — is the
project's only database (it replaced SurrealDB).

## Schema

`schema/001_init.sql` defines the app-data tables (`connection`, `audit_log`,
`app_config`). It is idempotent (`CREATE ... IF NOT EXISTS`) and applied at
server boot. Better Auth owns its own tables (`user`, `session`, `account`,
`verification`, `twoFactor`, `passkey`) through its Kysely adapter migrations,
so those are not defined here.

## Backend options (one client, no code changes)

`@libsql/client` speaks to all three transparently; pick via `LIBSQL_URL`:

| Mode | `LIBSQL_URL` | Notes |
| --- | --- | --- |
| Embedded (default, self-hosted) | `file:/data/companion.db` | Local file on the `overlay-data` volume. No credentials. |
| Turso Cloud | `libsql://<db>.turso.io` | Also set `LIBSQL_AUTH_TOKEN` (the Turso auth token). |
| Self-hosted libsql-server | `http(s)://host:8080` | Run `ghcr.io/tursodatabase/libsql-server`; hrana over HTTP. |

## Demo seed

Set `SEED_DEMO=true` to provision a demo account (default
`demo@overlay.local` / `demo-password-1234`) with a pre-connected VM pointing at
the KasmVNC desktop named by the `KASMVNC_ALLOWLIST_JSON` target id (default
`sample`, port 6901, TLS). Idempotent — it never overwrites the demo user's own
computers. See `.env.example` for `DEMO_*` overrides.