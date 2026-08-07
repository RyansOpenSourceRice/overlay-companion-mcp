# Specification — Overlay Companion MCP

[![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

> This is the **what** document — the behavioral contract. For the **why**
> (design decisions), see `DESIGN.md`. The detailed MCP tool contracts live in
> `docs/SPECIFICATION.md`.

## Identity & sessions (build scope A)

| Endpoint                   | Method | Behavior                                                                                                                              |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/status`             | GET    | Reports enabled auth methods (OIDC config, local, signup). Public.                                                                    |
| `/auth/login`              | GET    | Begins OIDC auth-code+PKCE; redirects to Keycloak. `?redirect=` preserved. Falls back to local form when OIDC unconfigured.           |
| `/auth/callback`           | GET    | Exchanges the OIDC code for tokens, upserts the user, sets a signed session cookie, redirects to the original target.                 |
| `/auth/local/login`        | POST   | Local auth fallback. Body `{username, password}`. Sets session cookie; returns `{user, csrfToken}`. Rate-limited 10/min.             |
| `/auth/local/register`     | POST   | Local sign-up. Locked unless `signup.allowed`. First user becomes admin. Body `{username, password, email?}`. Password ≥ 12 chars.    |
| `/auth/logout`             | POST   | Revokes the session, clears the cookie.                                                                                               |
| `/auth/me`                 | GET    | Returns the current user + CSRF token, or 401.                                                                                         |
| `/auth/delete-account`     | POST   | Deletes the signed-in user + revokes all sessions. Requires CSRF.                                                                     |

- Sessions: signed cookies (`SESSION_SECRET`), backed by SurrealDB `session`
  rows. Token hashes only; never raw tokens. CSRF token per session.
- Rate limit: 10/min per IP on login + register.

## Configuration API (build scope B/C)

| Endpoint                         | Method | Behavior                                                                  |
| -------------------------------- | ------ | ------------------------------------------------------------------------- |
| `/api/settings`                  | GET    | All config grouped by category (auth, connection, wazuh, general). Secrets redacted. Authenticated. |
| `/api/settings/:category/:key`   | GET    | Single config value. Secrets redacted.                                    |
| `/api/settings/:category/:key`   | PUT    | Create/update a setting. Admin + CSRF. Hot-applies auth changes. Audited. |

- Storage: SurrealDB `app_config`. Env vars are bootstrap defaults merged into
  the GET response.

## SurrealDB schema (build scope C)

Tables (see `infra/surrealdb/schema/001_init.surql`): `user`, `session`,
`connection`, `audit_log`, `app_config`. Idempotent `OVERWRITE` schema; safe to
re-run. Record-level permissions enforce user-scoped access.

## Wazuh / SIEM (build scope E)

- Admin toggle in Settings → "Wazuh / SIEM log shipping".
- Shipper: `infra/wazuh/filebeat-overlay-companion.yml` (JSONL → Wazuh).
- Rules: `infra/wazuh/rules/*.yml` (Sigma-style).
- Wazuh is external; the app only ships logs. No paywall.

## Playwright tests (build scope D)

- `tests/playwright-csharp/`: `WebSmokeTests`, `LoginFlowTests`,
  `ConnectionFlowTests`, `TlsSettingsTests`.
- CI: `.github/workflows/playwright-tests.yml` (FireFox).

---

*Authored by an AI agent (OpenHands) on behalf of Ryan.*
