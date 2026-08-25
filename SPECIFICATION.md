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

- Sessions: signed cookies (`SESSION_SECRET`), backed by libSQL `session`
  rows (owned by Better Auth). Token hashes only; never raw tokens. CSRF token
  per session.
- Rate limit: 10/min per IP on login + register.

## Configuration API (build scope B/C)

| Endpoint                         | Method | Behavior                                                                  |
| -------------------------------- | ------ | ------------------------------------------------------------------------- |
| `/api/settings`                  | GET    | All config grouped by category (auth, connection, wazuh, general). Secrets redacted. Authenticated. |
| `/api/settings/:category/:key`   | GET    | Single config value. Secrets redacted.                                    |
| `/api/settings/:category/:key`   | PUT    | Create/update a setting. Admin + CSRF. Hot-applies auth changes. Audited. |

- Storage: libSQL `app_config`. Env vars are bootstrap defaults merged into
  the GET response.

## libSQL schema (build scope C)

Tables (see `infra/libsql/schema/001_init.sql`): `connection`, `audit_log`,
`app_config`. Idempotent `CREATE ... IF NOT EXISTS` schema; safe to re-run.
Better Auth owns `user`/`session`/`account`/`verification`/`twoFactor` through
its own Kysely migrations. User-scoped access is enforced in the store queries.

## Wazuh / SIEM (build scope E)

- Admin toggle in Settings → "Wazuh / SIEM log shipping".
- Shipper: `infra/wazuh/filebeat-overlay-companion.yml` (JSONL → Wazuh).
- Rules: `infra/wazuh/rules/*.yml` (Sigma-style).
- Wazuh is external; the app only ships logs. No paywall.

## Web interface (build scope B)

- **Frontend AI chat UI**: any first-class AI chat window in TypeScript uses
  assistant-ui + Vercel AI SDK as the default stack (D-019); the current chat
  panel is plain TypeScript.
- **Per-view URLs**: every view has its own addressable URL (hash routes such as
  `#/home`, `#/connections`, `#/settings`, `#/vm-view`) — no silent single-page
  routing (D-020; implemented as hash routing in `infra/web/src/app.ts`).
- **Theming**: light/dark with auto-follow of `prefers-color-scheme` plus a
  manual toggle (D-018).

## Playwright tests (build scope D)

- `tests/playwright-csharp/`: `WebSmokeTests`, `LoginFlowTests`,
  `ConnectionFlowTests`, `TlsSettingsTests`.
- CI: `.github/workflows/playwright-tests.yml` (FireFox).

## Security tooling & CI posture

- **Static analysis (SAST)**: OpenGrep (`.github/workflows/sast-opengrep.yml`)
  is the open-source static scanner; results are uploaded as SARIF to code
  scanning. GitHub CodeQL also runs for C# and Rust.
- **Dependency updates**: Renovate (`renovate.json`) with `pinDigests: true` for
  the `github-actions`, `dockerfile`, and `docker-compose` managers — pins
  actions to commit SHAs and images to content digests, which satisfies the
  OpenSSF Scorecard `Pinned-Dependencies` check.
- **Least-privilege CI permissions**: every workflow sets `contents: read` at
  the top level; `write` is granted only to the one job that needs it (SARIF
  upload, GHCR push, release/asset creation, branch push), satisfying the
  Scorecard `Token-Permissions` check.
- **Secret scanning**: gitleaks, detect-secrets, and detect-private-key run in
  the pre-commit suite (`.pre-commit-config.yaml`).
- **StepSecurity stance**: `step-security/harden-runner` is Apache-2.0 and free,
  but its "Global Block List" is fetched at runtime from StepSecurity's hosted
  24/7 SOC (a third-party service), and the Secure Workflows generator is a
  hosted web app. It is therefore an optional add-on, not a default; the
  self-contained Renovate pinning + least-privilege permissions above are
  preferred.

---

*Authored by an AI agent (OpenHands) on behalf of Ryan.*
