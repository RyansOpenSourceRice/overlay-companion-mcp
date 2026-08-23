# Changelog

All notable changes to Overlay Companion MCP are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versioning is CalVer
(`YYYY.MM.DD.N`).

## [Unreleased]

### Added
- **Overlay templates (§A3).** New `template_overlay` MCP tool lets the AI draw
  named templates with a small parameter set (`template="text", text="yada",
  color="red", x=43, y=32, size=23`) instead of re-emitting geometry/SVG.
  Registry: `text`, `button`, `region`, `rectangle`, `circle`, `highlight`,
  `arrow`, plus raw **SVG** and opaque **object** passthrough. Text supports
  multi-line + centered-in-box layout. Catalog advertised via
  `GetOverlayCapabilities`.
- **Accessible overlay semantics (§A2).** Every overlay maps to a hidden
  `#overlay-companion-a11y` semantic tree (`role` + `aria-label` + bounds) with
  an `aria-live="polite"` announcer — screen-reader usable and CI-assertable by
  accessible name instead of pixel coordinates.
- **Playwright E2E (FireFox) supersedes Appium (§A1).** `tests/playwright-csharp`
  (13 tests across WebSmoke, LoginFlow, ConnectionFlow, TlsSettings) replaces
  `tests/appium-csharp`; `.github/workflows/playwright-tests.yml` replaces the
  Appium job. No Appium/chromedriver dependency; trace-viewer ready.
- **In-app chat assistant (§B1).** Built-in chat panel is a **second client to
  the same C# MCP tools**. Server streams an OpenRouter completion
  (`POST /api/chat`, SSE) and executes a bounded tool allowlist
  (`draw_overlay`, `template_overlay`, `take_screenshot`, `get_display_info`,
  `set_display_actor`, `get_overlay_capabilities`) against the C# `/mcp`
  endpoint. Never an input tool.
- **Display-ownership token (§B2).** Only one agent owns the overlay canvas:
  `interior` (in-app assistant) vs `exterior` (external MCP agent). Persisted in
  SurrealDB `general.activeActor`; switching releases the other actor's
  overlays. Overlay-write tools are gated on the active owner; new
  `set_display_actor` MCP tool.
- **Config-via-chat (§B3).** Admin users can configure the app through the
  chat panel (`get_config`/`set_config` allowlisted tools, role-enforced
  server-side). GUI-first Settings adds Provider, Display ownership, and Voice
  cards.
- **Voice & transcription (§C).** Optional STT/TTS for the chat panel (default
  OFF). Provider abstraction: cloud (**OpenRouter fish-audio**:
  `fish-audio/transcribe-1` STT + `fish-audio/s1` TTS) or **local**
  (whisper.cpp / faster-whisper OpenAI-compatible). GUI toggle + mic button in
  the panel.
- **Observability glue for deployers (§D).** `infra/observability/` ships a
  compose + config so OTHERS can point **OpenRouter Broadcast** (OTLP traces)
  at a self-hosted stack: OpenTelemetry Collector, SigNoz, Grafana LGTM + Alloy,
  Langfuse. Not part of this app's deploy stack. See
  `docs/OBSERVABILITY_INTEGRATION.md`.
- **Container-desktop test target (§E1).** Kasm-reuse container desktop doubles
  as the Playwright E2E target; no nested VM/KVM. See
  `docs/CONTAINER_DESKTOP_TEST_TARGET.md`.
- **Bidirectional clipboard + hardened bridge (§E2/E3).** Copy in/out of the
  VM via the Rust bridge. The bridge now **requires** a strong
  `CLIPBOARD_BRIDGE_API_KEY` (fail-fast; legacy default rejected) and restricts
  CORS to `CLIPBOARD_BRIDGE_ALLOWED_ORIGIN` (never `*`).

### Changed
- **Data-access layer: store boundary (§9).** All management-server data access
  routes through the single `SurrealDbStore` boundary (`surreal-store.ts`); no
  raw SurrealQL/driver calls outside it. Better Auth's `surreal-better-auth`
  adapter is the sanctioned exception and now reuses `loadSurrealOptions()` from
  the store, so DB connection config has a single source of truth. Documented in
  `DESIGN.md` and the per-repo ontology (D-016).
- **Optional passkeys + TOTP via Better Auth plugins (§7).** The management
  server now wires Better Auth's `passkey` (WebAuthn / hardware keys) and
  `two-factor` (TOTP) plugins, serving `/api/auth/passkey/*` and
  `/api/auth/two-factor/*`. Both are optional per-account opt-ins — nothing is
  forced at sign-up, and password + passkey + TOTP can combine for a self-hosted
  defense-in-depth posture. `/auth/status` now reports `passkey` and `totp`
  availability, and the SPA Settings gains a "Two-factor security" card that
  reflects it. Configurable via `BETTER_AUTH_PASSKEY_RP_ID` (and the existing
  `BETTER_AUTH_URL` / `BETTER_AUTH_TRUSTED_ORIGINS`).
- `docs/CLIPBOARD_BRIDGE.md` documents the hardened env surface.
- `DESIGN.md` and `SPECIFICATION.md` updated for Playwright + templates.
- **HTTPS & Certificates management (§7, admin GUI + API).** The root admin can
  configure the app's serving certificate for the Caddy/Traefik terminator:
  ACME public (Let's Encrypt) or private (step-ca) with automatic renewal,
  upload of a server certificate + private key (validated key match, PEM),
  and self-signed generation for no-domain/`localhost`/LAN HTTPS (explicit
  admin permission required). The certificate is the server's identity; client
  trust anchors are installed on end devices; client keys are never uploaded.
  GUI: Settings → "HTTPS & Certificates" with mode/terminator/managed/redirect,
  upload + generate buttons, and live cert status (subject/issuer/expiry).
  API: `GET /api/tls/status`, `GET /api/tls/config`, `POST /api/tls/cert`,
  `POST /api/tls/self-signed` (admin-only, CSRF-protected, audit-logged).
- **Caddy + Traefik both first-class.** The terminator config renderer emits a
  Caddy `tls` directive or a Traefik `certificatesResolvers`, in managed and
  unmanaged (external proxy) modes. Compose exposes Caddy and an optional
  Traefik service with fully custom ports (`CADDY_HTTP/HTTPS`,
  `TRAEFIK_HTTP/HTTPS`) and a mounted certs volume.
- **Appium TLS GUI E2E.** `TlsSettingsTests` drives Settings → HTTPS &
  Certificates end-to-end in Chrome: card renders, self-signed generate updates
  the status, and the ACME/mode form is present. `AssemblyInit` registers a
  shared admin once and reuses its session cookie so a full-suite run never
  exhausts the login rate limit.

### Changed
- **Session cookie (earlier fix, doc note).** `Secure` flag is opt-in via
  `COOKIE_SECURE=true` for HTTPS deployments; off by default for the plain-HTTP
  LAN deployments this app targets.

### Fixed
- **Pre-existing Appium flakiness under full-suite load.** `WaitForConnectionCard`
  and card-button clicks now tolerate `StaleElementReferenceException` (the SPA
  re-renders the list mid-poll), and the `EditConnection` name is set via JS to
  avoid stale-input races.
- **markdown-toc-check CI failure.** Removed the auto-TOC markers from
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
