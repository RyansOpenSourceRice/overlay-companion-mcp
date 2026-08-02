# Overlay Companion MCP — C# Appium Tests

Appium is the preferred unified testing framework (Ryan's preferences §9), with
C# Selenium/Appium as the implementation language. This project covers the web
UI and the login flow.

## What is covered

- `WebSmokeTests` — home page loads, `/health` responds, `/auth/status` reports
  the auth configuration.
- `LoginFlowTests` — local auth registration, login, `/auth/me` session check,
  and logout. OIDC is exercised only in a full Keycloak stack.
- `ConnectionFlowTests` — the full "configure a VM connection" flow through the
  real UI: Add Connection modal, card rendering, **reload + persistence** (the
  connection survives a page reload because it is stored server-side in
  SurrealDB), edit, delete, and the Test Connection button.
- `TlsSettingsTests` — the HTTPS & Certificates admin flow (§7): the Settings
  card renders, generating a self-signed server cert through the GUI updates
  the status, and the ACME/mode/terminator controls are present.

These complement the Python AI-GUI harness in `tests/ai-gui/` (which exercises
the MCP tools). The Appium suite is the CI test job for the web layer.

> **Connections are server-persisted.** The management server stores saved
> connections in SurrealDB (`/api/connections`). Passwords are Argon2id-hashed
> server-side and never stored or returned in plaintext; the web UI keeps the
> plaintext only transiently in `sessionStorage` for the live VM handshake.
> The CI job runs a SurrealDB container so the persistence assertions are real.

## Running locally

Prerequisites:

1. The management server + web frontend running (`cd infra && podman-compose
   up`), with `LOCAL_AUTH_ENABLED=true` and `SIGNUP_ALLOWED=true` in `.env`.
   The connection tests need SurrealDB reachable (the compose stack includes
   it) so persistence assertions are real.
2. Node.js + Appium: `npm install -g appium` and `appium driver install chromium`.
   The tests spawn their own Appium server, so do not start one manually.
3. **A Chromium-family browser + driver.** Either:
   - **Google Chrome**: install the official `.rpm`/package, or
   - **Chromium + chromedriver** at the same version (e.g. from EPEL).
   The Appium chromium driver auto-downloads a matching chromedriver
   (`autodownloadEnabled`), but a system browser must be present.
4. **HTTP stack**: when the server runs with `NODE_ENV=production` over plain
   `http://`, the session cookie must not be `Secure` or the browser will refuse
   to store it and the SPA will stay on the login view. `auth.ts` defaults the
   cookie `Secure` flag **off**; set `COOKIE_SECURE=true` only for HTTPS
   deployments. The CI workflow sets `COOKIE_SECURE=false` explicitly.

Then:

```bash
cd tests/appium-csharp
dotnet test
```

To point at a non-local target:

```bash
APP_TARGET_URL=https://my-stack.example.com dotnet test
```

> **Known WebDriver gotchas (fixed in this repo):**
> - `platformName` must be lowercase (`"linux"`); chromedriver rejects a
>   capitalized value with "No matching capabilities found".
> - Relative `fetch()` calls in test helper scripts need a loaded origin first,
>   so helpers navigate to `/` before registering.
> - `AssemblyInit` registers a shared admin once at assembly start and reuses
>   its session cookie across admin-gated tests, so a full-suite run does not
>   exhaust the server's login rate limit (10/min/IP).
> - SPA re-renders can stale `WebElement` references mid-poll; the connection
>   card helpers tolerate `StaleElementReferenceException` and retry.

## Runner strategy: graceful skip on shared CI, hard fail everywhere else

The suite treats a Chrome-session provisioning failure differently depending on
where it runs, so a green result can never silently mean "tests didn't run".

- **Shared GitHub runner** (`APPIUM_PROVISION_MODE=skip`): if the
  chromedriver/Chrome version can't be matched, the tests report **Inconclusive**
  and the workflow passes, but `.github/workflows/appium-tests.yml` emits an
  explicit `::warning::` annotation ("Appium suite was SKIPPED") so the skip is
  never invisible. continue-on-error keeps the shared-forge job fast (§9
  capacity awareness).
- **Local / self-hosted runner** (`APPIUM_PROVISION_MODE` **unset**, the
  default): a provisioning failure **fails hard** — no silent pass. This is
  where the real suite must run green.

To force the hard-fail behavior locally:

```bash
cd tests/appium-csharp
dotnet test
```

(no `APPIUM_PROVISION_MODE` set → provisioning failures fail the run).

## CI

`.github/workflows/appium-tests.yml` runs this suite on every push and pull
request. It installs Appium + Chrome, boots the compose stack with local auth
enabled, runs `dotnet test`, and reports whether the suite actually executed or
was skipped (never silently).
