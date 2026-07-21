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

## CI

`.github/workflows/appium-tests.yml` runs this suite on every push and pull
request. It installs Appium + Chrome, boots the compose stack with local auth
enabled, and runs `dotnet test`.
