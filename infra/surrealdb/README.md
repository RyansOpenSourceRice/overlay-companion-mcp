# Overlay Companion MCP — SurrealDB Schema

SurrealDB is the only database for this project (per Ryan's preferences §9). It
backs users, sessions, saved connections, the audit log, and GUI-first
application configuration for both the TypeScript management server
(`infra/server`) and the C# MCP server (`src/`).

## Files

- `001_init.surql` — idempotent schema. Defines tables, fields, indexes, and
  record-level permissions for `user`, `session`, `connection`, `audit_log`, and
  `app_config`.

## Applying the schema

The `surrealdb` service in `infra/compose.yml` mounts `./surrealdb/schema` at
`/schema:ro`. The schema is applied on first boot by an init step. To apply it
manually against a running SurrealDB:

```bash
surreal sql \
  --conn http://localhost:8000 \
  --namespace overlay --database companion \
  --user root --pass root \
  --file 001_init.surql
```

The schema is `OVERWRITE`-based and safe to re-run — it upgrades in place
without dropping existing rows.

## Decoupling

SurrealDB is a standalone service (not bundled into another container) so it
can migrate to K3S independently. The connection details are passed to every
service that needs them via the `SURREALDB_*` environment variables in
`infra/compose.yml`.
