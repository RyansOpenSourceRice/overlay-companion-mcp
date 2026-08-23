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

## Decision: SurrealDB is the only database (§9)

SurrealDB backs users, sessions, connections, audit log, and app
configuration. It is a **decoupled** service in `infra/compose.yml` so it can
migrate to K3S independently. Both the TS management server (over HTTP `/sql`)
and the C# MCP server (via the SurrealDb.Net SDK) read/write it. Rely on
SurrealDB's built-in caching; no separate cache unless benchmarked. Services
fall back to file storage when the DB is unreachable so the app keeps working
during a DB outage.

## Decision: Data-access layer — store boundary (§9)

All management-server data access goes through a single store boundary,
`SurrealDbStore` (`infra/server/src/surreal-store.ts`). It is the only module
that runs SurrealQL: route handlers, services, and managers never call the
driver or raw SQL directly — they depend on the store's typed methods
(`getConfig`, `setConfig`, `upsertUser`, `findSessionByTokenHash`,
`appendAudit`, `listConnections`, …). This keeps engine-specific SQL in one
place, makes the DB testable/swappable without rewriting business logic, and
gives a single spot for connection lifecycle, transactions, and error mapping.

The one sanctioned exception is **Better Auth's storage adapter**. `better-auth.ts`
uses the `surreal-better-auth` adapter (its `Surreal` WebSocket driver) because
Better Auth owns its own user/session schema through the adapter, not through
our store. It reuses the same connection config though — `loadSurrealOptions()`
from the store is the single source of `SURREALDB_*` defaults for both paths, so
there is exactly one place the DB connection is configured. Everything else must
route through the store boundary (per §9 data-access-layer rule).

## Decision: OpenFGA is the fine-grained authorization service (D-017)

OpenFGA is a **separate service** — like SurrealDB and Keycloak, it is never
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

## Decision: OIDC via Keycloak + local fallback (§7, §8)

Never roll our own identity. Keycloak is self-hostable and admin-configurable;
passkeys/TOTP/backup codes are provided by the Keycloak realm. Local auth
(Argon2id-hashed passwords — OWASP-recommended) is the fallback when OIDC is
unavailable; legacy scrypt hashes verify during a transition window and are
auto-upgraded to Argon2id on next successful login. Sign-ups are locked by
default (admin opt-in). Sessions are signed cookies backed by SurrealDB rows
(token hashes only).

## Decision: Saved connections are server-persisted (§9)

The web UI's saved VM connections live in the SurrealDB `connection` table,
served through `/api/connections` on the management server and scoped to the
authenticated user (previously they were browser-`localStorage` only). Plaintext
passwords are never stored or returned; the server keeps an Argon2id hash and
the web UI holds the plaintext transiently in `sessionStorage` for the live VM
handshake. The Playwright suite asserts persistence across a page reload against a
real SurrealDB in CI.

## Decision: GUI-first config (§9)

Auth/connection/provider/Wazuh/TLS settings live in the web Settings UI, backed by
SurrealDB `app_config`. Env vars are bootstrap defaults only. The config model
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
owner** may draw; the owner is persisted in SurrealDB `general.activeActor`
(both servers agree), switching releases the other actor's overlays, and
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
