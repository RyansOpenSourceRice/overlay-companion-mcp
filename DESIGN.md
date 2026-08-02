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
handshake. The Appium suite asserts persistence across a page reload against a
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

## Decision: C# Appium tests (§9)

Appium is the preferred unified testing framework; C# Selenium/Appium is the
implementation language. The web suite lives in `tests/appium-csharp/` and runs
in CI. The Python `tests/ai-gui/` harness is legacy and being superseded.

---

*Authored by an AI agent (OpenHands) on behalf of Ryan. This records analysis
and design decisions; the binding decisions are Ryan's.*
