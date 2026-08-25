# Design — Overlay Companion MCP

[![Vibe Coded: Disclosure](https://img.shields.io/badge/Vibe%20Coded-Disclosure-informational?style=flat-square)](https://github.com/danielrosehill/Vibe-Coded-Disclosure)

> This is the **why** document — design decisions, trade-offs, and rejected
> alternatives. For the **what** (behavior contracts), see
> `SPECIFICATION.md`. For the architecture analysis behind the
> container-vs-application decision, see
> `docs/CONTAINER_VS_APPLICATION.md`.

## Decision: container + web viewer (locked)

The project is the annotation layer, not the VM. Overlays render in a web
viewer (browser pane), not composited over the desktop. This works on **any**
VM reachable via browser tech, which is the portability requirement. See
`docs/CONTAINER_VS_APPLICATION.md` for the full analysis and the rejected
alternatives (wlroots host app, GNOME Shell extension, flatpak).

## Decision: AI is an annotation layer, not an autopilot

The absence of click/type/keyboard MCP tools is **intentional**. It avoids
duplicating an input MCP and makes the product safe to deploy. The "teach me
Blender materials" scenario means: AI takes a screenshot, analyzes it, draws
overlays, and **recommends** next steps. The human does the clicking and
typing. `take_screenshot` + `draw_overlay` + `set_clipboard` +
`get_display_info` are the intended tool surface. This safety-by-design is a
feature, not a gap.

## Decision: libSQL (Turso) is the only database (§9)

libSQL - the SQLite-compatible engine behind Turso - backs users, sessions,
connections, audit log, and app configuration. It is self-hosted as an embedded
local file by default (a named volume mounted at `/data`, opened by
`@libsql/client`); pointing `LIBSQL_URL` at Turso Cloud or a self-hosted
`libsql-server` moves the same engine off-box with no code change. The TS
management server is the sole DB consumer (the C# MCP server keeps its
in-process file storage). Rely on libSQL's embedded caching; no separate cache
unless benchmarked.

## Decision: Data-access layer — store boundary (§9)

All management-server data access goes through a single store boundary,
`LibSqlStore` (`infra/server/src/libsql-store.ts`). It is the only module
that runs SQL: route handlers, services, and managers never call the
driver or raw SQL directly — they depend on the store's typed methods
(`getConfig`, `setConfig`, `appendAudit`, `listConnections`, …). This keeps
engine-specific SQL in one place, makes the DB testable/swappable without
rewriting business logic, and gives a single spot for connection lifecycle,
transactions, and error mapping.

The one sanctioned exception is **Better Auth's storage adapter**. `better-auth.ts`
points Better Auth's Kysely adapter at the same libSQL engine (via
`@libsql/client` + `@libsql/kysely-libsql`) because Better Auth owns its own
user/session schema through the adapter, not through our store. It reuses the
same connection config though — `loadLibSqlOptions()` from the store is the
single source of `LIBSQL_*` defaults for both paths, so there is exactly one
place the DB connection is configured. Everything else must route through the
store boundary (per §9 data-access-layer rule).

## Decision: OpenFGA is the fine-grained authorization service (D-017)

OpenFGA is a **separate service** — like libSQL and Keycloak, it is never
embedded in the app (Ryan's preference: 3rd-party services run as fit, not
built in). The management server talks to it over HTTP via the official
`@openfga/sdk`. It is the authorization boundary for saved connections:

- **Model (schema 1.1):** `user` and `connection` types. `connection` has
  `owner` (direct), `operator` (direct or owner), and `viewer` (direct or
  operator) relations. Today only owner tuples are written (the creator owns
  the connection); operator/viewer are forward-looking for future
  sharing/delegation.
- **Enforcement:** on connection create the server writes the owner tuple; on
  read/update/delete/test/touch it runs `Check()` (viewer/operator/owner) and
  denies fail-closed. Listing uses `ListObjects(viewer)`.
- **GUI-first (§9):** OpenFGA is **opt-in** via Settings → Fine-grained
  authorization (category `openfga` in `app_config`, bootstrap env defaults).
  Disabled by default keeps the existing owner-scoped behavior with no OpenFGA
  calls; enabling it provisions the store + model and starts enforcing.

Better Auth remains the identity + RBAC layer (who you are, admin vs user);
OpenFGA adds relationship-based, per-object authorization on top. They are
complementary, not competing.

## Decision: Theme system — auto light/dark + manual toggle (D-018)

The web UI uses a design-token theme system (`infra/web/src/styles/theme.css`)
with light and dark palettes. **Default is auto-follow**: the app follows the
OS/browser `prefers-color-scheme` with no manual action (Ryan's preferences §4
Themes). A header toggle cycles auto → light → dark and persists the choice in
localStorage (`oc-theme`), applied before first paint to avoid a flash. The
login view is a modern split layout — a brand/artwork panel (with themed SVG
backgrounds `bg-light.svg` / `bg-dark.svg` showing miniature screens with
circles, dots, and arrows) plus a sign-in/register panel — replacing the old
single-column, unstyled login.

## Decision: Frontend AI chat UI — assistant-ui + Vercel AI SDK (D-019)

For in-app AI chat windows in TypeScript, the default stack is **assistant-ui**
(React, MIT) on top of the **Vercel AI SDK** — the standard conversation-UI
toolkit (ChatGPT-style UX, shadcn/ui, streaming/retries/scroll handled). This is
the "Better Auth of AI chat UI". The current in-app chat panel is plain
TypeScript and stays until a React chat surface is warranted; assistant-ui + AI
SDK is then the default (Ryan's preference).

## Decision: Every view gets its own URL — no silent single-page routing (D-020)

The web UI must expose a URL per view (e.g. `#/connections`, `#/settings`)
rather than a single silent-SPA URL with no addressable location. A view without
a URL is a navigation + deep-linking gap: users cannot bookmark, link, share, or
use back/forward reliably. (This is recorded as a decision now; the routing is
still to be implemented — see P-006.)

## Decision: OIDC via Keycloak + local fallback (§7, §8)

Never roll our own identity. Keycloak is self-hostable and admin-configurable;
passkeys/TOTP/backup codes are provided by the Keycloak realm. Local auth
(Argon2id-hashed passwords — OWASP-recommended) is the fallback when OIDC is
unavailable; legacy scrypt hashes verify during a transition window and are
auto-upgraded to Argon2id on next successful login. Sign-ups are locked by
default (admin opt-in). Sessions are signed cookies backed by libSQL rows
(token hashes only).

## Decision: Saved connections are server-persisted (§9)

The web UI's saved VM connections live in the libSQL `connection` table,
served through `/api/connections` on the management server and scoped to the
authenticated user (previously they were browser-`localStorage` only). Plaintext
passwords are never stored or returned; the server keeps an Argon2id hash and
the web UI holds the plaintext transiently in `sessionStorage` for the live VM
handshake. The Playwright suite asserts persistence across a page reload against a
a real libSQL database in CI.

## Decision: GUI-first config (§9)

Auth/connection/provider/Wazuh/TLS settings live in the web Settings UI, backed by
libSQL `app_config`. Env vars are bootstrap defaults only. The config model
is structured and validatable so both a human and an AI agent can configure it.

## Decision: HTTPS is ACME, terminated by Caddy or Traefik (§7)

The management server stays HTTP behind a terminator. The serving certificate
is the server's identity and is managed by the admin in Settings → "HTTPS &
Certificates": ACME public (Let's Encrypt) or private (step-ca) with automatic
renewal, an uploaded server cert + key, or a self-signed no-domain fallback
(generated with explicit admin permission). ACME is the protocol for
provisioning/renewal — a private step-ca is the same integration as a public CA,
just a different directory URL. The custom CA's trust anchor lives on client
devices (installed by the admin); client keys are never uploaded. Both Caddy
and Traefik are first-class terminators (managed and unmanaged modes), and the
TLS config is rendered by `infra/server/src/tls-manager.ts` into the terminator
volume. Ports are fully configurable so HTTPS never collides with other projects.

## Decision: Wazuh is external (§8)

Wazuh is an external compose the admin runs. The app ships log shipping
(Filebeat config) and Sigma-style rules; it does not build or bundle Wazuh. No
paywall — "enterprise tier" means features that help everyone.

## Decision: C# Playwright tests (§9)

Playwright is the web E2E framework, superseding Appium (this is a browser-based
product with first-class FireFox support and a trace viewer that is invaluable
in CI). C# remains the implementation language. The web suite lives in
`tests/playwright-csharp/` and runs FireFox in CI. Overlay annotations carry a
semantic layer (roles + accessible names + an ARIA live region) so both screen
reader users and CI (accessibility-tree assertions) can read them deterministically.
The Python `tests/ai-gui/` harness is legacy and being superseded.

## Decision: in-app chat is a second client to the same MCP tools (§B1)

The built-in chat panel is **not** a new agent surface — it is another consumer
of the existing C# MCP tools. It streams an OpenRouter completion and executes a
bounded tool allowlist (overlay, screenshot, display-actor) against the C#
`/mcp` endpoint. External MCP clients keep working unchanged, and the
"annotation, not autopilot" guarantee holds: neither client can click or type.

## Decision: display-ownership token prevents dual canvas ownership (§B2)

Two agents (the in-app "interior" assistant and an external "exterior" MCP
agent) could otherwise fight over the same overlay canvas. Only the **active
owner** may draw; the owner is tracked per-process by the C# MCP server (the
management server's `general.activeActor` config is the cross-server default),
switching releases the other actor's overlays, and
overlay-write tools are gated on it. The human decides who owns the display.

## Decision: templates and accessible semantics (§A2/A3)

The AI references named templates plus a small parameter set instead of
re-emitting SVG/geometry; raw SVG and opaque objects pass through. Overlays also
carry roles + accessible names in a queryable semantic tree, so CI asserts on
meaning, not pixels, and screen-reader users get a usable annotation surface.

## Decision: observability is glue for OTHERS (§D)

Like Wazuh, observability is **not** in this app's deploy stack. The project
ships compose + config so a deployer can point OpenRouter Broadcast (OTLP
traces) at their own self-hosted stack (OTel Collector, SigNoz, Grafana LGTM +
Alloy, Langfuse). See `docs/OBSERVABILITY_INTEGRATION.md`.

---

*Authored by an AI agent (OpenHands) on behalf of Ryan. This records analysis
and design decisions; the binding decisions are Ryan's.*
