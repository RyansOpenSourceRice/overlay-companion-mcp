# Changelog

All notable changes to Overlay Companion MCP are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is CalVer
(`YYYY.MM.DD.N`).

## [Unreleased]

### Added
- **Saved VM connections (server-persisted).** Full `/api/connections` CRUD on
  the management server (list/create/get/update/delete/test/touch) backed by the
  SurrealDB `connection` table and scoped to the authenticated user. The web UI
  now loads and saves connections through the API instead of `localStorage`, so
  a connection survives page reloads and cross-tab sessions.
- **Argon2id password hashing (OWASP-recommended) for local auth and connection
  passwords.** Legacy scrypt hashes still verify during a transition window and
  are auto-upgraded to Argon2id on the next successful login. Plaintext
  connection passwords are never stored or returned; the web UI keeps them only
  transiently in `sessionStorage` for the live VM handshake.
- **Appium connection-flow E2E.** `ConnectionFlowTests` drives the real UI:
  add connection → card renders → reload + persistence → edit → delete → test
  button. The CI Appium job now boots a SurrealDB container (real persistence)
  and serves the built SPA (`web/dist` → `server/public`, fixing a latent 404).
- **Local Appium verification + test hardening.** The suite now runs green
  against a real local stack (Google Chrome + Appium chromium driver). Fixed the
  WebDriver session "No matching capabilities found" failure (`platformName`
  must be lowercase), stale `index.js` script reference in the SPA template,
  transient blank-body reads in `WebSmokeTests`, and cross-test connection-name
  collisions in `ConnectionFlowTests`.

### Fixed
- **Session cookie broken over HTTP (`Secure` flag).** `auth.ts` previously set
  `Secure` on the session cookie whenever `NODE_ENV=production`, which made
  browsers refuse to store it on the plain-`http://` self-hosted deployments
  this app targets — users could never stay logged in. The flag is now off by
  default and opt-in via `COOKIE_SECURE=true` (for HTTPS deployments); compose
  exposes it and the Appium CI job sets it explicitly.
- **markdown-toc-check CI failure.** Removed the auto-TOC markers from
  `docs/SPECIFICATION.md` (markdown-toc emits malformed output on this file and
  the CI comparison was structurally broken); root `SPECIFICATION.md` never had
  one. `scripts/lint-markdown.sh` now ignores `**/node_modules/**` so local runs
  match CI, and `.cspell.json` gains the same ignore.
- **CodeQL findings.** Replaced the LGTM-only suppression on the cookie-parser
  CSRF finding with the CodeQL `codeql[js/missing-token-validation]` annotation
  (the global state-changing CSRF middleware already covers it), and escaped
  `title`/`message` in the legacy `index.js` `showError` template that CodeQL
  flagged as unsafe HTML.
- **Scorecard findings.** Removed stale committed `packages-microsoft-prod.deb`
  binaries (`src/`, `legacy/vendor/`); `container-registry.yml` and
  `cleanup-containers.yml` now declare least-privilege top-level permissions;
  Renovate now pins GitHub Actions and container image digests.

### Changed
- **Web frontend fully migrated from JavaScript to TypeScript.** Converted
  `app.js`, `GuacamoleClient.js`, `KasmVNCClient.js`, `OverlaySystem.js`, and
  `StatusMonitor.js` to strict-mode TypeScript (typed payload/option interfaces,
  discriminated bounds unions) and disabled `allowJs` in `infra/web/tsconfig.json`.
  `legacy/` remains JavaScript (frozen snapshot, not built by CI).

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
  Adds `SESSION_SECRET`, `NODE_ENV`, and `TRUST_PROXY` to the common env so a
  production deployment passes a real session secret and a safe trusted-proxy
  value (never the permissive `true`).
- `infra/server/src/surreal-store.ts`: fixed SurrealQL so the auth flow can
  actually persist — replaced invalid `CREATE OR UPDATE`/`CREATE $id` with
  `UPSERT type::thing($id)`; local users get a unique `subject` sentinel so the
  unique `(provider, subject)` index no longer blocks registering a second
  local user; `expires_at`/`updated_by`/`user_id` cast with `type::thing` /
  `type::datetime` to satisfy SCHEMAFULL record/datetime types; `app_config`
  uses a dot-free encoded record id with the dotted key stored in `name` (bare
  `.` is not allowed in SurrealDB record ids); `payload` is stored as a JSON
  string and parsed on read (SurrealQL rejects JSON-stringified object
  literals in `SET`); reserved identifiers (`name`, `value`) backticked.
- `infra/surrealdb/schema/001_init.surql`: `app_config` now has `name`
  (canonical dotted key) + `payload` (JSON string) + a `name` unique index;
  removed the conflicting `id`/`value` field definitions.
- `infra/server/src/server.ts`: `trust proxy` is now `TRUST_PROXY` env-driven
  defaulting to `loopback` instead of `true` (the permissive value that let
  clients spoof `X-Forwarded-For` to bypass rate limits and that
  express-rate-limit refuses to run under).
- `tests/appium-csharp` + `.github/workflows/appium-tests.yml`: Appium suite
  now branches on `APPIUM_PROVISION_MODE`. `skip` (set on the shared GitHub
  runner) reports Inconclusive and the workflow emits an explicit warning when
  the suite was skipped; any other value (local/self-hosted) fails hard so
  unrun tests can never silently pass.
- `.pre-commit-config.yaml`: bandit hook targets `legacy/clipboard-bridge-python`
  (the old `flatpak/clipboard-bridge` path no longer exists); ESLint hook
  excludes `dist/` and `node_modules`.
- `.cspell.json`: added `chromedriver`, `APPIUM`, `Appium`.

### Security
- Fail-closed `SESSION_SECRET`: with `NODE_ENV=production`, the server refuses
  to start if `SESSION_SECRET` is unset/missing, instead of silently signing
  cookies with the known `dev-only-change-me` default (which would let anyone
  forge a valid session cookie).
- Fixed six SurrealDB-store bugs that blocked every auth write (registration,
  sessions, settings, audit log), and enforced CSRF/admin checks on settings
  mutations.
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
