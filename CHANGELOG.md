# Changelog

All notable changes to Overlay Companion MCP are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is CalVer
(`YYYY.MM.DD.N`).

## [Unreleased]

### Added
- **Real login flow + identity (§7, §8).** OIDC auth-code+PKCE via Keycloak
  with session cookies, local auth fallback (hashed+salted via scrypt),
  sign-ups locked by default, rate-limited auth endpoints, delete-account,
  `/auth/me`, logout. Wires the existing OIDC middleware in
  `infra/server/src/server.ts` to the Keycloak service in `infra/compose.yml`.
- **SurrealDB as the only database (§9).** Decoupled `surrealdb` service in
  `infra/compose.yml` (so it can migrate to K3S later). SurrealQL schema for
  `user`, `session`, `connection`, `audit_log`, `app_config`. TS store
  (`infra/server/src/surreal-store.ts`) and C# store (`src/Services/SurrealStore.cs`
  via the SurrealDb.Net SDK) back users, sessions, connections, audit, config.
- **GUI-first configuration (§9).** Auth/connection/provider/Wazuh settings
  move into the web Settings UI (`/api/settings`), backed by SurrealDB
  `app_config`. Env vars are bootstrap defaults only.
- **C# Appium tests + CI (§9).** New `tests/appium-csharp/` project
  (WebSmokeTests, LoginFlowTests) using the official Appium chromium driver.
  `.github/workflows/appium-tests.yml` runs the suite on every push/PR.
- **Wazuh / SIEM integration (§8).** `docs/WAZUH_INTEGRATION.md`,
  `infra/wazuh/filebeat-overlay-companion.yml` shipper template, and three
  Sigma-style detection rules. Admin-enabled toggle in Settings; no paywall.
  Wazuh itself is an external compose the admin runs.
- **Required owned-repo files (§29).** `AGENTS.md`, `CHANGELOG.md`,
  `MAINTAINERS.md`, `DESIGN.md`, `SPECIFICATION.md` at root.

### Changed
- `infra/compose.yml`: added `surrealdb` service + volume; `overlay-web` and
  `mcp-server` now depend on it; Keycloak admin password is env-configurable.
- `infra/Caddyfile`: routes `/auth/idp/*` to Keycloak so the OIDC login flow
  stays on one origin.
- `infra/server/src/server.ts`: added cookie-parser, SurrealDB store, auth
  routes, settings API, SurrealDB/auth status in `/health`.
- `src/Program.cs`: registers `ISurrealStore` and initializes it on startup.
- `infra/.env.example`: added SurrealDB, Keycloak, session, local-auth, Wazuh,
  and public-base-url bootstrap defaults.

### Security
- Session cookies are signed with `SESSION_SECRET` and backed by SurrealDB
  rows (token hashes only, never raw tokens). CSRF tokens on mutating routes.
- Local passwords hashed with scrypt (salted). Secrets redacted in settings API.
- Rate limit of 10/min on login + register endpoints.

---

*This changelog was authored by an AI agent (OpenHands) on behalf of Ryan.*
