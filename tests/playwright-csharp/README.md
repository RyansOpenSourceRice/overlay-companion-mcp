# Overlay Companion MCP — C# Playwright Tests

Playwright is the web E2E framework (plan §A1), superseding the former Appium
suite. C# is the implementation language (preferences §9). The tested engine is
**FireFox**, headless in CI.

## What is covered

- `WebSmokeTests` — home page loads, `/health` responds, `/auth/status` reports
  the auth configuration.
- `LoginFlowTests` — local auth registration, login, `/auth/me` session check,
  and logout.
- `ConnectionFlowTests` — the full "configure a VM connection" flow through the
  real UI: Add Connection modal, card rendering, **reload + persistence**
  (server-side in SurrealDB), edit, delete, and the Test Connection button.
- `TlsSettingsTests` — the HTTPS & Certificates admin flow (§7): the Settings
  card renders, generating a self-signed cert through the GUI updates status,
  and the terminator/mode controls are present.

The Python harness in `tests/ai-gui/` exercises the MCP tool surface; this suite
is the CI test job for the web layer.

## Why Playwright (and FireFox)

- This is a **browser-based product** (web viewer over KasmVNC). Playwright is
  purpose-built for web E2E: single API, auto-waiting, web-first assertions,
  trace viewer (invaluable for CI debugging), and first-class FireFox support.
- FireFox avoids Chrome-only lock-in and matches the project's portability/
  privacy ethos.
- Overlay annotations carry a **semantic layer** (roles + accessible names + an
  ARIA live region) so CI can assert on the accessibility tree rather than pixel
  coordinates — deterministic, non-flaky — and screen reader users get a usable
  annotation surface.

## Running locally

1. Boot the stack with local auth enabled: `cd infra && podman-compose up`
   (`LOCAL_AUTH_ENABLED=true`, `SIGNUP_ALLOWED=true`), so SurrealDB persistence
   and local auth are real.
2. Install the pinned FireFox browser revision:
   ```bash
   cd tests/playwright-csharp
   dotnet build -c Release
   ~/.dotnet/tools/playwright install firefox   # or: pwsh bin/Release/net8.0/playwright.ps1 install firefox
   ```
3. Run the suite:
   ```bash
   APP_TARGET_URL=http://localhost:8080 dotnet test -c Release
   ```

## CI

`.github/workflows/playwright-tests.yml` boots the web + C# MCP servers and a
SurrealDB container, installs the FireFox revision, and runs the suite against
`http://localhost:8080`. On the shared GitHub runner it opts into a graceful skip
(`PLAYWRIGHT_PROVISION_MODE=skip`); a self-hosted/local runner leaves that unset
so the suite **fails hard** on provisioning problems rather than silently
passing with unrun tests. The workflow surfaces any skip explicitly.