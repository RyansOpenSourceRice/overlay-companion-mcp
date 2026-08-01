# Overlay Companion MCP — C# Appium Tests

Appium is the preferred unified testing framework (Ryan's preferences §9), with
C# Selenium/Appium as the implementation language. This project covers the web
UI and the login flow.

## What is covered

- `WebSmokeTests` — home page loads, `/health` responds, `/auth/status` reports
  the auth configuration.
- `LoginFlowTests` — local auth registration, login, `/auth/me` session check,
  and logout. OIDC is exercised only in a full Keycloak stack.

These complement the Python AI-GUI harness in `tests/ai-gui/` (which exercises
the MCP tools). The Appium suite is the CI test job for the web layer.

## Running locally

Prerequisites:

1. The management server + web frontend running (`cd infra && podman-compose
   up`), with `LOCAL_AUTH_ENABLED=true` and `SIGNUP_ALLOWED=true` in `.env`.
2. Node.js + Appium: `npm install -g appium` then `appium` (the server must be
   running on the default port 4723).
3. Chrome installed.

Then:

```bash
cd tests/appium-csharp
dotnet test
```

To point at a non-local target:

```bash
APP_TARGET_URL=https://my-stack.example.com dotnet test
```

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
