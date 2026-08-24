# Vendored SurrealDB Better Auth adapter (fork of `surreal-better-auth`)

This directory is a vendored fork of `surreal-better-auth` `1.0.0`
(https://github.com/oskar-gmerek/surreal-better-auth), imported into this repo
instead of depending on the npm package, with two changes required to run
against `better-auth` `1.7.x`:

1. **Query-side reference conversion (bug fix).** Upstream applied the
   special-case field mappings (`FIELD_MAPPING_RULES`, e.g.
   `account.accountId` → `user` for credential accounts) only on the *write*
   path (`serializeRecordIdFields`). The *query* path
   (`buildWhereClauseParts`) did not, so `findCredentialAccount` compared
   `accountId` as a plain string against a record-id and always returned
   `null`. That broke password re-authentication for account deletion,
   `enableTwoFactor`, and `changePassword`. `helpers.ts` now builds a flat
   view of the WHERE conditions and resolves the reference table through the
   same special-case rules used on write.

2. **`consumeOne` / `incrementOne` (newer Better Auth API).** `better-auth`
   `1.7.x` requires adapters to implement atomic `consumeOne` (single-use
   credential consumption) and `incrementOne` (guarded counter updates, used
   by the two-factor lockout). These are now implemented with
   `DELETE ... LIMIT 1 RETURN BEFORE` and `UPDATE ... SET field = field + n
   ... LIMIT 1 RETURN AFTER` in `surreal-adapter.ts`.

**Reconciliation note:** to return to the upstream package, upgrade to
`surreal-better-auth@2.0.0-beta.x` (targets `better-auth@^1.5.2`) and verify it
implements `consumeOne`/`incrementOne` and the query-side reference handling;
otherwise keep this fork. The import in `infra/server/src/better-auth.ts` is
the only consumer.